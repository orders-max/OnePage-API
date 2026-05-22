import type { AppConfig } from "./config.js";

type QueryValue = string | number | boolean | undefined | null;

export class OnePageCrmApiError extends Error {
  readonly status: number;
  readonly crmMessage?: string;

  constructor(status: number, message: string, crmMessage?: string) {
    super(message);
    this.name = "OnePageCrmApiError";
    this.status = status;
    this.crmMessage = crmMessage;
  }
}

export class OnePageCrmClient {
  private readonly endpoint: string;
  private readonly authorizationHeader: string;

  constructor(config: AppConfig) {
    this.endpoint = config.onePageCrmEndpoint;
    this.authorizationHeader = `Basic ${Buffer.from(`${config.onePageCrmUserId}:${config.onePageCrmApiKey}`).toString("base64")}`;
  }

  async searchContacts(params: { query: string; email?: string; includeTeam?: boolean; page?: number; perPage?: number }) {
    const trimmedQuery = params.query.trim();
    const query: Record<string, QueryValue> = {
      page: params.page,
      per_page: params.perPage,
      team: params.includeTeam || undefined
    };

    if (params.email) {
      query.email = params.email;
      query.search = trimmedQuery || undefined;
    } else if (trimmedQuery.includes("@")) {
      query.email = trimmedQuery;
    } else {
      query.search = trimmedQuery;
    }

    return this.request("GET", "/contacts", { query });
  }

  async getContact(contactId: string) {
    return this.request("GET", `/contacts/${encodeURIComponent(contactId)}`);
  }

  async listActions(params: {
    contactId?: string;
    companyId?: string;
    assigneeId?: string;
    status?: string;
    includeDone?: boolean;
    fromDate?: string;
    toDate?: string;
    page?: number;
    perPage?: number;
  }) {
    const query: Record<string, QueryValue> = {
      contact_id: params.contactId,
      company_id: params.companyId,
      assignee_id: params.assigneeId,
      status: params.status,
      done: params.status === "done" ? true : params.includeDone ? undefined : false,
      page: params.page,
      per_page: params.perPage
    };

    if (params.fromDate || params.toDate) {
      query.date_filter = "date";
      query.since = params.fromDate;
      query.until = params.toDate;
    }

    return this.request("GET", "/actions", { query });
  }

  async createAction(params: {
    contactId: string;
    text: string;
    dueDate?: string;
    status?: string;
    exactTime?: number;
    assigneeId?: string;
    position?: number;
  }) {
    const status = params.status ?? (params.exactTime ? "date_time" : params.dueDate ? "date" : "asap");
    return this.request("POST", "/actions", {
      body: compactObject({
        contact_id: params.contactId,
        text: params.text,
        status,
        assignee_id: params.assigneeId,
        date: params.dueDate,
        exact_time: params.exactTime,
        position: params.position
      })
    });
  }

  async addNote(params: { contactId: string; text: string; date?: string; linkedDealId?: string; userIdsToNotify?: string[] }) {
    return this.request("POST", `/contacts/${encodeURIComponent(params.contactId)}/notes`, {
      body: compactObject({
        text: params.text,
        date: params.date,
        linked_deal_id: params.linkedDealId,
        user_ids_to_notify: params.userIdsToNotify
      })
    });
  }

  async markActionDone(actionId: string) {
    const existing = await this.request("GET", `/actions/${encodeURIComponent(actionId)}`);
    const action = unwrapData(existing, "action") as Record<string, unknown> | undefined;

    if (action?.done === true || action?.status === "done") {
      return existing;
    }

    return this.request("PUT", `/actions/${encodeURIComponent(actionId)}`, {
      query: { done: true },
      body: compactObject({
        contact_id: action?.contact_id,
        assignee_id: action?.assignee_id,
        status: action?.status,
        text: action?.text,
        date: action?.date,
        exact_time: action?.exact_time,
        position: action?.position
      })
    });
  }

  private async request(method: string, path: string, options: { query?: Record<string, QueryValue>; body?: Record<string, unknown> } = {}) {
    const url = new URL(`${this.endpoint}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: this.authorizationHeader,
          ...(options.body ? { "Content-Type": "application/json" } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown network error";
      throw new OnePageCrmApiError(0, `Could not reach OnePage CRM: ${message}`);
    }

    const payload = await readResponsePayload(response);
    if (!response.ok) {
      throw new OnePageCrmApiError(response.status, friendlyStatusMessage(response.status), payload.message);
    }

    return payload.value;
  }
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""));
}

function unwrapData(value: unknown, key: string): unknown {
  if (!isRecord(value) || !isRecord(value.data)) {
    return undefined;
  }
  return value.data[key];
}

async function readResponsePayload(response: Response): Promise<{ value: unknown; message?: string }> {
  const text = await response.text();
  if (!text) {
    return { value: undefined };
  }

  try {
    const value = JSON.parse(text) as unknown;
    return { value, message: extractMessage(value) };
  } catch {
    return { value: text, message: text.slice(0, 500) };
  }
}

function extractMessage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const candidate of [value.message, value.error, value.errors]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function friendlyStatusMessage(status: number): string {
  if (status === 0) return "OnePage CRM could not be reached.";
  if (status === 400) return "OnePage CRM rejected the request. Check that the IDs, dates, and fields are valid.";
  if (status === 401) return "OnePage CRM rejected the credentials. Check ONEPAGECRM_USER_ID and ONEPAGECRM_API_KEY.";
  if (status === 403) return "OnePage CRM says this API user does not have permission for that action.";
  if (status === 404) return "OnePage CRM could not find that record.";
  if (status === 409) return "OnePage CRM reported a conflict. Refresh the record and try again.";
  if (status >= 500) return "OnePage CRM had a temporary server problem. Try again in a few minutes.";
  return `OnePage CRM returned HTTP ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
