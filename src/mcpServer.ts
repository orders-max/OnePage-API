import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AppConfig, UserCredentials } from "./config.js";
import {
  describeNoteSearchResults,
  describeActions,
  describeContact,
  describeContactSearch,
  describeCalls,
  describeCreatedAction,
  describeCreatedDeal,
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
  structuredCreatedDeal,
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
const dealStatusSchema = z.enum(["open", "won", "lost"]);

export function createMcpServer(config: AppConfig, userCreds?: UserCredentials): McpServer {
  console.error(`createMcpServer: userCreds=${userCreds ? `userId="${userCreds.userId}"` : "none (falling back to config)"}`);
  const client = new OnePageCrmClient({
    endpoint: config.onePageCrmEndpoint,
    userId: userCreds?.userId ?? config.onePageCrmUserId,
    apiKey: userCreds?.apiKey ?? config.onePageCrmApiKey
  });
  const userId = userCreds?.userId ?? config.onePageCrmUserId;
  const server = new McpServer({
    name: "onepagecrm-mcp-server",
    version: "0.1.0"
  });

  server.registerTool(
    "search_contacts",
    {
      title: "Search Contacts",
      description:
        "Use this to search OnePage CRM contacts by person name. The name is passed directly as the search query — do not substitute a company name. Returns a short contact list with IDs for follow-up calls.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        name: z.string().trim().min(1).max(100).describe("Full person name to search for. Passed directly as the search query — do not use a company name here."),
        email: z.string().trim().email().optional().describe("Optional exact email filter."),
        includeTeam: z.boolean().optional().describe("Include contacts owned by other users on the account."),
        page: pageSchema.describe("Page number. Starts at 1."),
        perPage: perPageSchema.describe("Number of contacts to return. Maximum 100.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "search_contacts", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.searchContacts({
          query: input.name,
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "get_contact", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "create_contact", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_tasks", userId, ts: new Date().toISOString()}));
      try {
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "create_task", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.createAction(input);
        return successResult(describeCreatedAction(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "edit_task",
    {
      title: "Edit Task",
      description: "Use this to update an existing OnePage CRM task. Provide taskId plus at least one field to change. Use mark_task_done to complete a task.",
      inputSchema: {
        taskId: idSchema.describe("The OnePage CRM action/task ID."),
        text: z.string().trim().min(1).max(140).optional().describe("Updated task text. Maximum 140 characters."),
        dueDate: dateSchema.optional().describe("Updated due date in YYYY-MM-DD format."),
        assigneeId: idSchema.optional().describe("OnePage CRM user ID to reassign the task to."),
        status: actionStatusSchema.exclude(["done"]).optional().describe("Updated task status. Use mark_task_done to complete a task.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "edit_task", userId, ts: new Date().toISOString()}));
      try {
        if (!input.text && !input.dueDate && !input.assigneeId && !input.status) {
          throw new Error("Provide at least one of text, dueDate, assigneeId, or status to update.");
        }
        const response = await client.editAction({
          actionId: input.taskId,
          text: input.text,
          date: input.dueDate,
          assigneeId: input.assigneeId,
          status: input.status
        });
        return successResult(describeCreatedAction(response), structuredActions(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search Notes",
      description:
        "Search across all notes in OnePage CRM by keyword. Fetches all pages and filters client-side. Results include note ID (for edit_note), contact ID (for add_note), contact name, and note text.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        keyword: z.string().trim().min(1).max(200).describe("Keyword to search for in note text.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "search_notes", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.searchNotes(input.keyword);
        return successResult(describeNoteSearchResults(response), structuredNotes(response));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_notes", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.listNotes({
          contactId: input.contactId,
          page: input.page ?? 1,
          perPage: input.perPage ?? 20
        });

        // Extract raw note objects so we can access their attachments
        const rawNotes = (response as Record<string, unknown>)?.data;
        const rawItems = Array.isArray((rawNotes as Record<string, unknown>)?.notes)
          ? ((rawNotes as Record<string, unknown>).notes as unknown[])
          : [];

        if (rawItems.length === 0) {
          return successResult("No notes were found.", structuredNotes(response));
        }

        const lines: string[] = [];
        for (let i = 0; i < rawItems.length; i++) {
          const item = rawItems[i] as Record<string, unknown>;
          const note = (typeof item.note === "object" && item.note !== null && !Array.isArray(item.note))
            ? item.note as Record<string, unknown>
            : item;

          // Replicate formatNoteLine output
          const noteText = typeof note.text === "string" && note.text.trim() ? note.text.trim() : "Untitled note";
          const author = (typeof note.author_name === "string" && note.author_name.trim()) ? note.author_name.trim()
            : (typeof note.author === "string" && note.author.trim()) ? note.author.trim() : undefined;
          const created = (typeof note.created_at === "string" && note.created_at.trim()) ? note.created_at.trim()
            : (typeof note.date === "string" && note.date.trim()) ? note.date.trim() : undefined;
          const noteId = typeof note.id === "string" && note.id.trim() ? note.id.trim() : undefined;
          const noteParts = [
            noteText,
            author ? `author: ${author}` : undefined,
            created ? `created: ${created}` : undefined,
            noteId ? `ID: ${noteId}` : undefined
          ].filter(Boolean) as string[];
          let noteLine = `${i + 1}. ${noteParts.join(" | ")}`;

          // Append PDF content for any .pdf attachments on this note
          const attachments = Array.isArray(note.attachments) ? note.attachments as unknown[] : [];
          for (const att of attachments) {
            const a = att as Record<string, unknown>;
            const filename = typeof a.filename === "string" ? a.filename : "";
            const url = typeof a.url === "string" ? a.url : "";
            if (!filename.toLowerCase().endsWith(".pdf") || !url) continue;

            const attParts: string[] = [filename];
            if (url) attParts.push(`url: ${url}`);
            if (typeof a.url_expires_at === "string" && a.url_expires_at) attParts.push(`expires: ${a.url_expires_at}`);
            let attLine = `\n   - ${attParts.join(" | ")}`;
            try {
              const { text: pdfText, totalChars } = await client.fetchAndParsePdf(url);
              const pdfNote = totalChars > 4000 ? `[PDF Content — 4000 of ${totalChars} chars]` : `[PDF Content]`;
              attLine += `\n     ${pdfNote}\n     ${pdfText}`;
            } catch {
              attLine += "\n     [PDF extraction failed]";
            }
            noteLine += attLine;
          }

          lines.push(noteLine);
        }

        return successResult(lines.join("\n"), structuredNotes(response));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "add_note", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.addNote(input);
        return successResult(describeNote(response), structuredCreatedNote(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "edit_note",
    {
      title: "Edit Note",
      description: "Use this to edit an existing note in OnePage CRM. Provide noteId plus text and/or date to update.",
      inputSchema: {
        noteId: idSchema.describe("The OnePage CRM note ID."),
        text: z.string().trim().min(1).max(7168).optional().describe("Updated note text."),
        date: dateSchema.optional().describe("Updated note date in YYYY-MM-DD format.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "edit_note", userId, ts: new Date().toISOString()}));
      try {
        if (!input.text && !input.date) {
          throw new Error("Provide at least one of text or date to update.");
        }
        const response = await client.editNote(input);
        return successResult(JSON.stringify(response), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "list_deal_attachments",
    {
      title: "List Deal Attachments",
      description: "Debug tool: fetch attachments for a deal, trying two URL patterns and returning the raw API response.",
      inputSchema: {
        dealId: idSchema.describe("The OnePage CRM deal ID."),
        contactId: idSchema.describe("The OnePage CRM contact ID associated with the deal (used as fallback URL).")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_deal_attachments", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.listDealAttachments(input.dealId, input.contactId);
        return successResult(JSON.stringify(response, null, 2), response);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete Note",
      description: "Delete a note from OnePage CRM by note ID.",
      inputSchema: {
        noteId: idSchema.describe("The OnePage CRM note ID.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "delete_note", userId, ts: new Date().toISOString()}));
      try {
        await client.deleteNote(input.noteId);
        return successResult(`Note ${input.noteId} deleted successfully.`, { noteId: input.noteId, deleted: true });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "search_deals",
    {
      title: "Search Deals",
      description: "Search OnePage CRM deals by deal name, contact name, or company name.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        query: z.string().trim().min(1).max(200).describe("Search term matched against deal name, contact name, and company name.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "search_deals", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.searchDeals(input.query);
        return successResult(describeDeals(response), structuredDeals(response));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_deals", userId, ts: new Date().toISOString()}));
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
      description: "Fetch one OnePage CRM deal by ID. The response includes contact_id (and contact_ids if multiple) so you can call add_note with both linkedDealId and contactId without a separate contact lookup.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        dealId: idSchema.describe("The OnePage CRM deal ID.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "get_deal", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.getDeal(input.dealId);
        let text = describeDeal(response);
        const rawDeal = (response as { data?: { deal?: { attachments?: unknown[] } } })?.data?.deal;
        const attachments = Array.isArray(rawDeal?.attachments) ? rawDeal.attachments : [];
        if (attachments.length > 0) {
          const lines: string[] = [];
          for (const att of attachments) {
            const a = att as Record<string, unknown>;
            const filename = typeof a.filename === "string" ? a.filename : "";
            const url = typeof a.url === "string" ? a.url : "";
            const expires = typeof a.url_expires_at === "string" ? a.url_expires_at : "";
            const parts: string[] = [];
            if (filename) parts.push(filename);
            if (url) parts.push(`url: ${url}`);
            if (expires) parts.push(`expires: ${expires}`);
            let line = `- ${parts.join(" | ")}`;
            if (filename.toLowerCase().endsWith(".pdf") && url) {
              try {
                const { text: pdfText, totalChars } = await client.fetchAndParsePdf(url);
                const note = totalChars > 4000 ? `[PDF Content — 4000 of ${totalChars} chars]` : `[PDF Content]`;
                line += `\n  ${note}\n  ${pdfText}`;
              } catch {
                line += "\n  [PDF extraction failed]";
              }
            }
            lines.push(line);
          }
          text += "\nAttachments:\n" + lines.join("\n");
        }
        return successResult(text, structuredDeal(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "create_deal",
    {
      title: "Create Deal",
      description: "Create a new deal in OnePage CRM linked to a contact. If both description and dealFields are provided, they are applied in two sequential API calls internally (core fields + dealFields first, then description).",
      inputSchema: {
        contactId: idSchema.describe("The contact ID to link this deal to."),
        name: z.string().trim().min(1).max(255).describe("Deal name."),
        amount: z.number().min(0).optional().describe("Deal value amount."),
        stage: z.number().int().min(0).max(99).optional().describe("Deal stage from 0 to 99."),
        status: dealStatusSchema.optional().describe("Deal status: open, won, or lost. Defaults to open."),
        expectedCloseDate: dateSchema.optional().describe("Expected close date in YYYY-MM-DD format."),
        ownerId: idSchema.optional().describe("OnePage CRM user ID to assign the deal to."),
        description: z.string().trim().min(1).max(10000).optional().describe("Deal description or notes."),
        dealFields: z.object({
          customerPo: z.string().trim().min(1).max(255).optional().describe("Customer PO #"),
          mmkPo: z.string().trim().min(1).max(255).optional().describe("MMK PO #"),
          customerTracking: z.string().trim().min(1).max(255).optional().describe("Customer Tracking #"),
          netTerms: z.string().trim().min(1).max(255).optional().describe("Net Terms"),
          salesPerson: z.string().trim().min(1).max(255).optional().describe("Sales Person"),
          vendorTracking: z.string().trim().min(1).max(255).optional().describe("Vendor Tracking #"),
          estimatedCloseDate: z.string().trim().min(1).max(255).optional().describe("Estimated Close Date"),
          shippingInstructions: z.string().trim().min(1).max(500).optional().describe("Shipping Instructions")
        }).optional().describe("Custom deal fields.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "create_deal", userId, ts: new Date().toISOString()}));
      try {
        const response = await client.createDeal(input);
        return successResult(describeCreatedDeal(response), structuredCreatedDeal(response));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    "update_deal",
    {
      title: "Update Deal",
      description: "Update a OnePage CRM deal. Status open maps to OnePage CRM pending deals. If both description and dealFields are provided, they are applied in two sequential API calls internally (core fields + dealFields first, then description).",
      inputSchema: {
        dealId: idSchema.describe("The OnePage CRM deal ID."),
        name: z.string().trim().min(1).max(255).optional().describe("Deal name."),
        amount: z.number().min(0).optional().describe("Deal value amount."),
        stage: z.number().int().min(0).max(99).optional().describe("Deal stage from 0 to 99."),
        status: dealStatusSchema.optional().describe("Deal status: open, won, or lost."),
        expectedCloseDate: dateSchema.optional().describe("Expected close date in YYYY-MM-DD format."),
        ownerId: idSchema.optional().describe("OnePage CRM user ID to assign the deal to."),
        description: z.string().trim().min(1).max(10000).optional().describe("Deal description or notes."),
        dealFields: z.object({
          customerPo: z.string().trim().min(1).max(255).optional().describe("Customer PO #"),
          mmkPo: z.string().trim().min(1).max(255).optional().describe("MMK PO #"),
          customerTracking: z.string().trim().min(1).max(255).optional().describe("Customer Tracking #"),
          netTerms: z.string().trim().min(1).max(255).optional().describe("Net Terms"),
          salesPerson: z.string().trim().min(1).max(255).optional().describe("Sales Person"),
          vendorTracking: z.string().trim().min(1).max(255).optional().describe("Vendor Tracking #"),
          estimatedCloseDate: z.string().trim().min(1).max(255).optional().describe("Estimated Close Date"),
          shippingInstructions: z.string().trim().min(1).max(500).optional().describe("Shipping Instructions")
        }).optional().describe("Custom deal fields.")
      }
    },
    async (input) => {
      console.log('TOOL_USE ' + JSON.stringify({tool: "update_deal", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_users", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_calls", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "list_emails", userId, ts: new Date().toISOString()}));
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
      console.log('TOOL_USE ' + JSON.stringify({tool: "mark_task_done", userId, ts: new Date().toISOString()}));
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
