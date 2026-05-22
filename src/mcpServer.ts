import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import {
  describeActions,
  describeContact,
  describeContactSearch,
  describeCreatedAction,
  describeDoneAction,
  describeNote,
  errorResult,
  successResult
} from "./formatters.js";
import { OnePageCrmClient } from "./onePageCrmClient.js";

const idSchema = z.string().trim().min(1).max(100);
const pageSchema = z.number().int().min(1).max(10000).optional();
const perPageSchema = z.number().int().min(1).max(100).optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD, for example 2026-05-22");
const actionStatusSchema = z.enum(["asap", "date", "date_time", "waiting", "queued", "queued_with_date", "done"]);
const createActionStatusSchema = z.enum(["asap", "date", "date_time", "waiting", "queued", "queued_with_date"]);

export function createMcpServer(config: AppConfig): McpServer {
  const client = new OnePageCrmClient(config);
  const server = new McpServer({ name: "onepagecrm-mcp-server", version: "0.1.0" });

  server.registerTool(
    "search_contacts",
    {
      title: "Search Contacts",
      description: "Search OnePage CRM contacts by name, company, or email.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().trim().min(1).max(100),
        email: z.string().trim().email().optional(),
        includeTeam: z.boolean().optional(),
        page: pageSchema,
        perPage: perPageSchema
      }
    },
    async (input) => {
      try {
        const response = await client.searchContacts({ ...input, page: input.page ?? 1, perPage: input.perPage ?? 10 });
        return successResult(describeContactSearch(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get Contact",
      description: "Fetch one OnePage CRM contact by ID.",
      annotations: { readOnlyHint: true },
      inputSchema: { contactId: idSchema }
    },
    async (input) => {
      try {
        const response = await client.getContact(input.contactId);
        return successResult(describeContact(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description: "List open OnePage CRM tasks / next actions. In the OnePage CRM API these are called actions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.optional(),
        companyId: idSchema.optional(),
        assigneeId: idSchema.optional(),
        status: actionStatusSchema.optional(),
        includeDone: z.boolean().optional(),
        fromDate: dateSchema.optional(),
        toDate: dateSchema.optional(),
        page: pageSchema,
        perPage: perPageSchema
      }
    },
    async (input) => {
      try {
        if (input.contactId && input.companyId) throw new Error("Use either contactId or companyId, not both.");
        const response = await client.listActions({ ...input, page: input.page ?? 1, perPage: input.perPage ?? 20 });
        return successResult(describeActions(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description: "Create a follow-up / next action task in OnePage CRM. A contact ID is required.",
      inputSchema: {
        contactId: idSchema,
        text: z.string().trim().min(1).max(140),
        dueDate: dateSchema.optional(),
        status: createActionStatusSchema.optional(),
        exactTime: z.number().int().positive().optional(),
        assigneeId: idSchema.optional(),
        position: z.number().int().positive().optional()
      }
    },
    async (input) => {
      try {
        const response = await client.createAction(input);
        return successResult(describeCreatedAction(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "add_note",
    {
      title: "Add Note",
      description: "Add a note to a OnePage CRM contact.",
      inputSchema: {
        contactId: idSchema,
        text: z.string().trim().min(1).max(7168),
        date: dateSchema.optional(),
        linkedDealId: idSchema.optional(),
        userIdsToNotify: z.array(idSchema).max(20).optional()
      }
    },
    async (input) => {
      try {
        const response = await client.addNote(input);
        return successResult(describeNote(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "mark_task_done",
    {
      title: "Mark Task Done",
      description: "Mark a OnePage CRM task / action as complete.",
      inputSchema: { taskId: idSchema }
    },
    async (input) => {
      try {
        const response = await client.markActionDone(input.taskId);
        return successResult(describeDoneAction(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
