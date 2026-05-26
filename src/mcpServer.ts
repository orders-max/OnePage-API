import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import {
  describeActions,
  describeContact,
  describeContactSearch,
  describeCalls,
  describeCreatedAction,
  describeDeal,
  describeDeals,
  describeDoneAction,
  describeEmails,
  describeNote,
  describeNotes,
  describeUsers,
  errorResult,
  structuredActions,
  structuredCalls,
  structuredCreatedNote,
  structuredDeal,
  structuredDeals,
  structuredEmails,
  structuredNotes,
  structuredUsers,
  successResult
} from "./formatters.js";
import { OnePageCrmClient } from "./onePageCrmClient.js";

const idSchema = z.string().trim().min(1).max(100);
const pageSchema = z.number().int().min(1).max(10000).optional();
const perPageSchema = z.number().int().min(1).max(100).optional();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD, for example 2026-05-21");
const actionStatusSchema = z.enum(["asap", "date", "date_time", "waiting", "queued", "queued_with_date", "done"]);
const actionDateFilterSchema = z.enum(["created_at", "modified_at", "updated_at", "date", "close_date"]);
const optionalDateSchema = z.union([dateSchema, z.null()]).optional();
const dealStatusSchema = z.enum(["open", "won", "lost"]);

export function createMcpServer(config: AppConfig): McpServer {
  const client = new OnePageCrmClient(config);
  const server = new McpServer({
    name: "onepagecrm-mcp-server",
    version: "0.1.0"
  });

  server.registerTool(
    "search_contacts",
    {
      title: "Search Contacts",
      description:
        "Use this to search OnePage CRM contacts by name, company, or email. Returns a short contact list with IDs for follow-up calls.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().trim().min(1).max(100).describe("Name, company, or email address to search for."),
        email: z.string().trim().email().optional().describe("Optional exact email filter."),
        includeTeam: z.boolean().optional().describe("Include contacts owned by other users on the account."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of contacts to return. Maximum 100.")
      }
    },
    async (input) => {
      try {
        const response = await client.searchContacts({
          query: input.query,
          email: input.email,
          includeTeam: input.includeTeam,
          page: input.page ?? 1,
          perPage: input.perPage ?? 10
        });
        return successResult(describeContactSearch(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_contact",
    {
      title: "Get Contact",
      description: "Use this to fetch one OnePage CRM contact by ID.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.describe("The OnePage CRM contact ID.")
      }
    },
    async (input) => {
      try {
        const response = await client.getContact(input.contactId);
        return successResult(describeContact(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_contact",
    {
      title: "Create Contact",
      description: "Create a new contact in OnePage CRM.",
      inputSchema: {
        firstName: z.string().trim().min(1).max(100).describe("Contact's first name."),
        lastName: z.string().trim().min(1).max(100).optional().describe("Contact's last name."),
        companyName: z.string().trim().min(1).max(100).optional().describe("Company or organization name."),
        email: z.string().trim().email().optional().describe("Contact's email address."),
        phone: z.string().trim().min(1).max(50).optional().describe("Contact's phone number."),
        jobTitle: z.string().trim().min(1).max(100).optional().describe("Contact's job title."),
        background: z.string().trim().min(1).max(7168).optional().describe("Background notes about the contact."),
        ownerId: z.string().trim().min(1).max(100).optional().describe("OnePage CRM user ID to assign the contact to.")
      }
    },
    async (input) => {
      try {
        const response = await client.createContact(input);
        return successResult(describeContact(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "Use this to list open OnePage CRM tasks / next actions. In the OnePage CRM API these are called actions.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.optional().describe("Only show tasks linked to this contact ID."),
        companyId: z.string().trim().min(1).max(100).optional().describe("Only show tasks linked to this company/organization ID."),
        assigneeId: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("Only show tasks assigned to this OnePage CRM user ID."),
        status: actionStatusSchema.optional().describe("Optional task status filter."),
        includeDone: z.boolean().optional().describe("Set true to include completed tasks."),
        dateFilter: actionDateFilterSchema
          .optional()
          .describe("Optional OnePage CRM date field filter. Leave empty when using fromDate or toDate for due-date ranges."),
        fromDate: optionalDateSchema.describe("Only tasks due on or after this date. Sent to OnePage CRM as date_from."),
        toDate: optionalDateSchema.describe("Only tasks due on or before this date. Sent to OnePage CRM as date_to."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of tasks to return. Maximum 100."),
        fetchAll: z
          .boolean()
          .optional()
          .describe("Set true to fetch every page of matching tasks in one tool call. Uses perPage, up to 100, for each API request.")
      }
    },
    async (input) => {
      try {
        if (input.contactId && input.companyId) {
          throw new Error("Use either contactId or companyId, not both.");
        }
        const response = await client.listActions({
          contactId: input.contactId,
          companyId: input.companyId,
          assigneeId: input.assigneeId,
          status: input.status,
          includeDone: input.includeDone,
          dateFilter: input.dateFilter ?? undefined,
          fromDate: input.fromDate ?? undefined,
          toDate: input.toDate ?? undefined,
          page: input.page ?? 1,
          perPage: input.perPage ?? (input.fetchAll ? 100 : 20),
          fetchAll: input.fetchAll
        });
        return successResult(describeActions(response), structuredActions(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Use this to create a follow-up / next action task in OnePage CRM. A contact ID is required because OnePage CRM actions belong to contacts.",
      inputSchema: {
        contactId: idSchema.describe("The contact ID to link this task to."),
        text: z.string().trim().min(1).max(140).describe("Task text. Maximum 140 characters."),
        dueDate: dateSchema.optional().describe("Optional due date in YYYY-MM-DD format."),
        status: actionStatusSchema
          .exclude(["done"])
          .optional()
          .describe("Optional status. If omitted, the server chooses asap, date, or date_time."),
        exactTime: z.number().int().positive().optional().describe("Optional UNIX timestamp in seconds for exact due time."),
        assigneeId: z
          .string()
          .trim()
          .min(1)
          .max(100)
          .optional()
          .describe("Optional OnePage CRM user ID to assign the task to."),
        position: z.number().int().positive().optional().describe("Optional position for queued tasks.")
      }
    },
    async (input) => {
      try {
        const response = await client.createAction(input);
        return successResult(describeCreatedAction(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_notes",
    {
      title: "List Notes",
      description: "List notes for a OnePage CRM contact. Optionally omit contactId to get recent notes across all contacts.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.optional().describe("Optional OnePage CRM contact ID. If omitted, returns notes from all contacts."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of notes to return. Maximum 100.")
      }
    },
    async (input) => {
      try {
        const response = await client.listNotes({
          contactId: input.contactId,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20
        });
        return successResult(describeNotes(response), structuredNotes(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "add_note",
    {
      title: "Add Note",
      description: "Use this to add a note to a OnePage CRM contact.",
      inputSchema: {
        contactId: idSchema.describe("The contact ID to add the note to."),
        text: z.string().trim().min(1).max(7168).describe("Note text. Maximum 7168 characters."),
        date: dateSchema.optional().describe("Optional note date in YYYY-MM-DD format."),
        linkedDealId: idSchema.optional().describe("Optional deal ID to link the note to."),
        userIdsToNotify: z.array(idSchema).max(20).optional().describe("Optional OnePage CRM user IDs to notify.")
      }
    },
    async (input) => {
      try {
        const response = await client.addNote(input);
        return successResult(describeNote(response), structuredCreatedNote(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_deals",
    {
      title: "List Deals",
      description: "List OnePage CRM deals, optionally filtered by contact and status. Status open maps to OnePage CRM pending deals.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.optional().describe("Only show deals linked to this contact ID."),
        status: dealStatusSchema.optional().describe("Deal status: open, won, or lost."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of deals to return. Maximum 100.")
      }
    },
    async (input) => {
      try {
        const response = await client.listDeals({
          contactId: input.contactId,
          status: input.status,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20
        });
        return successResult(describeDeals(response), structuredDeals(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "get_deal",
    {
      title: "Get Deal",
      description: "Fetch one OnePage CRM deal by ID.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        dealId: idSchema.describe("The OnePage CRM deal ID.")
      }
    },
    async (input) => {
      try {
        const response = await client.getDeal(input.dealId);
        return successResult(describeDeal(response), structuredDeal(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "update_deal",
    {
      title: "Update Deal",
      description: "Update a OnePage CRM deal stage or status. Status open maps to OnePage CRM pending deals.",
      inputSchema: {
        dealId: idSchema.describe("The OnePage CRM deal ID."),
        stage: z.number().int().min(0).max(99).optional().describe("Deal stage from 0 to 99."),
        status: dealStatusSchema.optional().describe("Deal status: open, won, or lost.")
      }
    },
    async (input) => {
      try {
        const response = await client.updateDeal(input);
        return successResult(describeDeal(response), structuredDeal(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_users",
    {
      title: "List Users",
      description: "List OnePage CRM users/team members so IDs can be resolved to names.",
      annotations: { readOnlyHint: true },
      inputSchema: {}
    },
    async () => {
      try {
        const response = await client.listUsers();
        return successResult(describeUsers(response), structuredUsers(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_calls",
    {
      title: "List Calls",
      description: "List call logs for a OnePage CRM contact.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.describe("The OnePage CRM contact ID."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of calls to return. Maximum 100.")
      }
    },
    async (input) => {
      try {
        const response = await client.listCalls({
          contactId: input.contactId,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20
        });
        return successResult(describeCalls(response), structuredCalls(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_emails",
    {
      title: "List Emails",
      description: "List email history for a OnePage CRM contact.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        contactId: idSchema.describe("The OnePage CRM contact ID."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of emails to return. Maximum 100.")
      }
    },
    async (input) => {
      try {
        const response = await client.listEmails({
          contactId: input.contactId,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20
        });
        return successResult(describeEmails(response), structuredEmails(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "mark_task_done",
    {
      title: "Mark Task Done",
      description:
        "Use this to mark a OnePage CRM task / action as complete. The server first reads the task, then sends OnePage CRM the documented done=true update.",
      inputSchema: {
        taskId: idSchema.describe("The OnePage CRM action/task ID.")
      }
    },
    async (input) => {
      try {
        const response = await client.markActionDone(input.taskId);
        return successResult(describeDoneAction(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
