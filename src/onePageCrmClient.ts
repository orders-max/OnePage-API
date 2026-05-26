import type { AppConfig } from "./config.js";

type QueryValue = string | number | boolean | undefined | null;
type RawContact = Record<string, unknown> & {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
};
type RawAction = Record<string, unknown> & {
  contact?: RawContact;
};

export type OnePageCrmContact = Record<string, unknown>;
export type OnePageCrmAction = Record<string, unknown>;
export type OnePageCrmNote = Record<string, unknown>;

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
  private userCache: Map<string, Record<string, unknown>> | null = null;

  constructor(config: AppConfig) {
    this.endpoint = config.onePageCrmEndpoint;
    this.authorizationHeader = `Basic ${Buffer.from(
      `${config.onePageCrmUserId}:${config.onePageCrmApiKey}`
    ).toString("base64")}`;
  }

  async testConnection(): Promise<unknown> {
    return this.request("GET", "/bootstrap");
  }

  async searchContacts(params: {
    query: string;
    email?: string;
    includeTeam?: boolean;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
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

  async getContact(contactId: string): Promise<unknown> {
    return this.request("GET", `/contacts/${encodeURIComponent(contactId)}`);
  }

  async createContact(params: {
    firstName: string;
    lastName?: string;
    companyName?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    background?: string;
    ownerId?: string;
  }): Promise<unknown> {
    const body = compactObject({
      first_name: params.firstName,
      last_name: params.lastName,
      company_name: params.companyName,
      emails: params.email ? [{ value: params.email }] : undefined,
      phones: params.phone ? [{ value: params.phone }] : undefined,
      job_title: params.jobTitle,
      background: params.background,
      owner_id: params.ownerId
    });

    return this.request("POST", "/contacts.json", { body });
  }

  async listActions(params: {
    contactId?: string;
    companyId?: string;
    assigneeId?: string;
    status?: string;
    includeDone?: boolean;
    dateFilter?: "created_at" | "modified_at" | "updated_at" | "date" | "close_date";
    fromDate?: string;
    toDate?: string;
    page?: number;
    perPage?: number;
    fetchAll?: boolean;
  }): Promise<unknown> {
    if (params.fetchAll) {
      return this.listAllActions(params);
    }

    const response = await this.request("GET", "/actions.json", { query: this.buildActionsQuery(params) });
    return this.enrichActionsResponse(response);
  }

  private async listAllActions(params: {
    contactId?: string;
    companyId?: string;
    assigneeId?: string;
    status?: string;
    includeDone?: boolean;
    dateFilter?: "created_at" | "modified_at" | "updated_at" | "date" | "close_date";
    fromDate?: string;
    toDate?: string;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
    const perPage = params.perPage ?? 100;
    const firstPage = params.page ?? 1;
    let page = firstPage;
    let lastResponse: unknown;
    let lastData: Record<string, unknown> | undefined;
    let totalCount: number | undefined;
    let maxPage: number | undefined;
    const actions: unknown[] = [];

    for (let requestCount = 0; requestCount < 1000; requestCount += 1) {
      const response = await this.request("GET", "/actions.json", {
        query: this.buildActionsQuery({ ...params, page, perPage })
      });
      const data = isRecord(response) && isRecord(response.data) ? response.data : undefined;
      const pageActions = Array.isArray(data?.actions) ? data.actions : [];

      lastResponse = response;
      lastData = data;
      actions.push(...pageActions);
      totalCount = numberOrUndefined(data?.total_count) ?? totalCount;
      maxPage = numberOrUndefined(data?.max_page) ?? maxPage;

      if (maxPage !== undefined && page >= maxPage) {
        break;
      }
      if (totalCount !== undefined && actions.length >= totalCount) {
        break;
      }
      if (pageActions.length === 0) {
        break;
      }
      if (maxPage === undefined && totalCount === undefined && pageActions.length < perPage) {
        break;
      }
      page += 1;
    }

    const mergedResponse = isRecord(lastResponse)
      ? {
          ...lastResponse,
          data: {
            ...(lastData ?? {}),
            actions,
            total_count: totalCount ?? actions.length,
            page: firstPage,
            per_page: perPage,
            max_page: maxPage ?? page
          }
        }
      : lastResponse;

    return this.enrichActionsResponse(mergedResponse);
  }

  private buildActionsQuery(params: {
    contactId?: string;
    companyId?: string;
    assigneeId?: string;
    status?: string;
    includeDone?: boolean;
    dateFilter?: "created_at" | "modified_at" | "updated_at" | "date" | "close_date";
    fromDate?: string;
    toDate?: string;
    page?: number;
    perPage?: number;
  }): Record<string, QueryValue> {
    const query: Record<string, QueryValue> = {
      contact_id: params.contactId,
      company_id: params.companyId,
      assignee_id: params.assigneeId,
      status: params.status,
      done: params.status === "done" ? true : params.includeDone ? undefined : false,
      date_filter: params.dateFilter,
      date_from: params.fromDate,
      date_to: params.toDate,
      page: params.page,
      per_page: params.perPage
    };

    return query;
  }

  private async enrichActionsResponse(response: unknown): Promise<unknown> {
    if (!isRecord(response) || !isRecord(response.data)) {
      return response;
    }

    const data = response.data as Record<string, unknown>;
    if (!Array.isArray(data.actions)) {
      return response;
    }

    const userMap = await this.getUserMap();
    const enrichedActions = await Promise.all(
      data.actions.map(async (item: unknown) => {
        if (!isRecord(item)) {
          return item;
        }

        const action = (isRecord(item.action) ? item.action : item) as RawAction;

        const contactId = stringOrUndefined(action.contact_id) ?? stringOrUndefined(action.contact?.id);
        const contactName = stringOrUndefined(action.contact_name) ?? stringOrUndefined(action.contact?.name);
        if (contactId && !contactName) {
          try {
            const contactResponse = await this.getContact(contactId);
            const contactData =
              isRecord(contactResponse) && isRecord(contactResponse.data) ? contactResponse.data : contactResponse;
            const contact = isRecord((contactData as Record<string, unknown> | undefined)?.contact)
              ? ((contactData as Record<string, unknown>).contact as RawContact)
              : undefined;

            if (contact) {
              const firstName = String(contact.first_name || "").trim();
              const lastName = String(contact.last_name || "").trim();
              action.contact_id = contactId;
              action.contact_name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
              action.company_name = String(contact.company_name || "").trim() || undefined;
            }
          } catch (error) {
            console.error(`Failed to enrich contact ${contactId}:`, error instanceof Error ? error.message : error);
          }
        }

        if ((action.assignee_id || action.user_id) && !action.assignee_name) {
          const userId = String(action.assignee_id || action.user_id);
          const user = userMap.get(userId);
          if (user) {
            const firstName = String(user.first_name || "").trim();
            const lastName = String(user.last_name || "").trim();
            action.assignee_name = [firstName, lastName].filter(Boolean).join(" ") || undefined;
            action.assignee_id = userId;
          }
        }

        return isRecord(item.action) ? { action } : item;
      })
    );

    return {
      ...response,
      data: {
        ...data,
        actions: enrichedActions
      }
    };
  }

  private async getUserMap(): Promise<Map<string, Record<string, unknown>>> {
    if (this.userCache) {
      return this.userCache;
    }

    const userMap = new Map<string, Record<string, unknown>>();
    try {
      const usersResponse = await this.listUsers();
      const data = isRecord(usersResponse) ? usersResponse.data : undefined;
      const users = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.users) ? data.users : [];

      for (const item of users) {
        if (isRecord(item)) {
          const user = isRecord(item.user) ? item.user : item;
          const userId = String(user.id || "").trim();
          if (userId) {
            userMap.set(userId, user as Record<string, unknown>);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load user map:", error instanceof Error ? error.message : error);
    }

    this.userCache = userMap;
    return userMap;
  }

  async createAction(params: {
    contactId: string;
    text: string;
    dueDate?: string;
    status?: string;
    exactTime?: number;
    assigneeId?: string;
    position?: number;
  }): Promise<unknown> {
    const status = params.status ?? (params.exactTime ? "date_time" : params.dueDate ? "date" : "asap");
    const body: Record<string, unknown> = {
      contact_id: params.contactId,
      text: params.text,
      status,
      assignee_id: params.assigneeId,
      date: params.dueDate,
      exact_time: params.exactTime,
      position: params.position
    };

    return this.request("POST", "/actions", { body: compactObject(body) });
  }

  async addNote(params: {
    contactId: string;
    text: string;
    date?: string;
    linkedDealId?: string;
    userIdsToNotify?: string[];
  }): Promise<unknown> {
    const body = compactObject({
      text: params.text,
      date: params.date,
      linked_deal_id: params.linkedDealId,
      user_ids_to_notify: params.userIdsToNotify
    });

    return this.request("POST", `/contacts/${encodeURIComponent(params.contactId)}/notes`, { body });
  }

  async listNotes(params: { contactId?: string; page?: number; perPage?: number }): Promise<unknown> {
    if (params.contactId) {
      return this.request("GET", `/contacts/${encodeURIComponent(params.contactId)}/notes`, {
        query: { page: params.page, per_page: params.perPage }
      });
    }

    return this.request("GET", "/notes", {
      query: { page: params.page, per_page: params.perPage }
    });
  }

  async listDeals(params: {
    contactId?: string;
    status?: string;
    page?: number;
    perPage?: number;
  }): Promise<unknown> {
    const path = params.contactId ? `/contacts/${encodeURIComponent(params.contactId)}/deals` : "/deals";
    return this.request("GET", path, {
      query: {
        status: mapDealStatus(params.status),
        page: params.page,
        per_page: params.perPage
      }
    });
  }

  async getDeal(dealId: string): Promise<unknown> {
    return this.request("GET", `/deals/${encodeURIComponent(dealId)}`);
  }

  async updateDeal(params: { dealId: string; stage?: number; status?: string }): Promise<unknown> {
    const body = compactObject({
      stage: params.stage,
      status: mapDealStatus(params.status)
    });

    if (Object.keys(body).length === 0) {
      throw new Error("Provide at least one deal field to update: stage or status.");
    }

    return this.request("PUT", `/deals/${encodeURIComponent(params.dealId)}`, {
      query: { partial: true },
      body
    });
  }

  async listUsers(): Promise<unknown> {
    return this.request("GET", "/users");
  }

  async listCalls(params: { contactId: string; page?: number; perPage?: number }): Promise<unknown> {
    return this.request("GET", `/contacts/${encodeURIComponent(params.contactId)}/calls`, {
      query: { page: params.page, per_page: params.perPage }
    });
  }

  async listEmails(params: { contactId: string; page?: number; perPage?: number }): Promise<unknown> {
    return this.request("GET", `/contacts/${encodeURIComponent(params.contactId)}/email_messages`, {
      query: { page: params.page, per_page: params.perPage }
    });
  }

  async markActionDone(actionId: string): Promise<unknown> {
    const existing = await this.request("GET", `/actions/${encodeURIComponent(actionId)}`);
    const action = unwrapData(existing, "action") as Record<string, unknown> | undefined;

    if (action?.done === true || action?.status === "done") {
      return existing;
    }

    const body = compactObject({
      contact_id: action?.contact_id,
      assignee_id: action?.assignee_id,
      status: action?.status,
      text: action?.text,
      date: action?.date,
      exact_time: action?.exact_time,
      position: action?.position
    });

    return this.request("PUT", `/actions/${encodeURIComponent(actionId)}`, {
      query: { done: true },
      body
    });
  }

  private async request(
    method: string,
    path: string,
    options: { query?: Record<string, QueryValue>; body?: Record<string, unknown> } = {}
  ): Promise<unknown> {
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
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

function mapDealStatus(status: string | undefined): string | undefined {
  if (!status) {
    return undefined;
  }
  return status === "open" ? "pending" : status;
}

function unwrapData(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  const data = value.data;
  if (!isRecord(data)) {
    return undefined;
  }
  return data[key];
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
  const candidates = [value.message, value.error, value.errors];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return undefined;
}

function friendlyStatusMessage(status: number): string {
  if (status === 0) {
    return "OnePage CRM could not be reached.";
  }
  if (status === 400) {
    return "OnePage CRM rejected the request. Check that the IDs, dates, and fields are valid.";
  }
  if (status === 401) {
    return "OnePage CRM rejected the credentials. Check ONEPAGECRM_USER_ID and ONEPAGECRM_API_KEY.";
  }
  if (status === 403) {
    return "OnePage CRM says this API user does not have permission for that action.";
  }
  if (status === 404) {
    return "OnePage CRM could not find that record.";
  }
  if (status === 409) {
    return "OnePage CRM reported a conflict. Refresh the record and try again.";
  }
  if (status >= 500) {
    return "OnePage CRM had a temporary server problem. Try again in a few minutes.";
  }
  return `OnePage CRM returned HTTP ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
