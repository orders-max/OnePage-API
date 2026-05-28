import { readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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
const optionalDateSchema = dateSchema.optional();
const dealStatusSchema = z.enum(["open", "won", "lost"]);

const IDENTITY_FILE = join(homedir(), ".onepagecrm-mcp-identity.json");

function loadSavedUserId(): string | null {
  if (process.env.ONEPAGECRM_CURRENT_USER_ID?.trim()) {
    return process.env.ONEPAGECRM_CURRENT_USER_ID.trim();
  }
  try {
    const data = JSON.parse(readFileSync(IDENTITY_FILE, "utf-8")) as { userId?: unknown };
    return typeof data.userId === "string" && data.userId.trim() ? data.userId.trim() : null;
  } catch {
    return null;
  }
}

function persistUserId(userId: string): void {
  try {
    writeFileSync(IDENTITY_FILE, JSON.stringify({ userId }), "utf-8");
  } catch {
    // Non-fatal — in-memory identity still works for this session.
  }
}

function noIdentityPrompt(teamList: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: `Identity not set. I need to know which team member you are before making any changes.\n\n${teamList}\n\nCall identify_me with your user ID to proceed.`
      }
    ]
  };
}

function extractUserList(response: unknown): Array<{ id: string; firstName: string; lastName: string }> {
  const record = typeof response === "object" && response !== null ? (response as Record<string, unknown>) : {};
  const data = record.data ?? response;
  const arr = Array.isArray(data) ? data : (typeof data === "object" && data !== null && Array.isArray((data as Record<string, unknown>).users)) ? (data as Record<string, unknown>).users as unknown[] : [];
  return (arr as unknown[]).flatMap((item) => {
    const u = (typeof item === "object" && item !== null && "user" in (item as Record<string, unknown>)) ? (item as Record<string, unknown>).user : item;
    if (typeof u !== "object" || u === null) return [];
    const user = u as Record<string, unknown>;
    const id = typeof user.id === "string" ? user.id.trim() : undefined;
    if (!id) return [];
    return [{ id, firstName: typeof user.first_name === "string" ? user.first_name : "", lastName: typeof user.last_name === "string" ? user.last_name : "" }];
  });
}

let currentUserId: string | null = loadSavedUserId();

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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
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
        dueToday: z.boolean().optional().describe("Set true to return tasks due today or overdue (due date on or before today). Fetches all pages and filters client-side."),
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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
        if (input.contactId && input.companyId) {
          throw new Error("Use either contactId or companyId, not both.");
        }
        const fetchAll = input.fetchAll ?? input.dueToday ?? false;
        const dueDate = input.dueToday
          ? (() => {
              const d = new Date();
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            })()
          : undefined;
        const response = await client.listActions({
          contactId: input.contactId,
          companyId: input.companyId,
          assigneeId: input.assigneeId,
          status: input.status,
          includeDone: input.includeDone,
          dueDate,
          page: input.page ?? 1,
          perPage: input.perPage ?? (fetchAll ? 100 : 20),
          fetchAll
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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
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
        if (!currentUserId) return noIdentityPrompt(describeUsers(await client.listUsers()));
        const response = await client.markActionDone(input.taskId);
        return successResult(describeDoneAction(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "identify_me",
    {
      title: "Identify Me",
      description:
        "Tell the server which OnePage CRM user you are. Required before any write operations. Call list_users first if you need to look up your ID.",
      inputSchema: {
        userId: idSchema.describe("Your OnePage CRM user ID.")
      }
    },
    async (input) => {
      try {
        const usersResponse = await client.listUsers();
        const users = extractUserList(usersResponse);
        const match = users.find((u) => u.id === input.userId);
        if (!match) {
          return errorResult(
            new Error(`User ID "${input.userId}" was not found in the team. Call list_users to see valid IDs.`)
          );
        }
        currentUserId = input.userId;
        persistUserId(input.userId);
        const name = [match.firstName, match.lastName].filter(Boolean).join(" ").trim() || input.userId;
        return successResult(`Identity saved. You are ${name} (${input.userId}).`, { userId: input.userId, name });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  return server;
}
