import { OnePageCrmApiError } from "./onePageCrmClient.js";

type RecordValue = Record<string, unknown>;

export function successResult(text: string, structuredContent?: unknown) {
  const result: {
    content: Array<{ type: "text"; text: string }>;
    structuredContent?: Record<string, unknown>;
  } = {
    content: [{ type: "text" as const, text }],
  };

  const structuredRecord = asRecord(structuredContent);
  if (structuredRecord) {
    result.structuredContent = structuredRecord;
  }

  return result;
}

export function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: formatError(error) }]
  };
}

export function formatError(error: unknown): string {
  if (error instanceof OnePageCrmApiError) {
    return error.crmMessage ? `${error.message} OnePage CRM said: ${error.crmMessage}` : error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Something went wrong while talking to OnePage CRM.";
}

export function describeContactSearch(response: unknown): string {
  const data = getData(response);
  const items = arrayFromWrapped(data?.contacts, "contact");
  if (items.length === 0) {
    return "No contacts were found.";
  }

  const total = numberOrUndefined(data?.total_count) ?? items.length;
  const lines = items.slice(0, 10).map((contact, index) => `${index + 1}. ${formatContactLine(contact)}`);
  return [`Found ${items.length} contact${items.length === 1 ? "" : "s"}${total ? ` (${total} total)` : ""}.`, ...lines].join(
    "\n"
  );
}

export function describeContact(response: unknown): string {
  const data = getData(response);
  const contact = asRecord(data?.contact);
  if (!contact) {
    return "The contact was returned, but the response did not include contact details.";
  }

  const nextAction = asRecord(data?.next_action);
  const lines = [formatContactLine(contact)];
  const jobTitle = stringOrUndefined(contact.job_title);
  const background = stringOrUndefined(contact.background);

  if (jobTitle) {
    lines.push(`Job title: ${jobTitle}`);
  }
  if (background) {
    lines.push(`Background: ${background}`);
  }
  if (nextAction) {
    lines.push(`Next action: ${formatActionLine(nextAction)}`);
  }

  return lines.join("\n");
}

export function describeActions(response: unknown): string {
  const data = getData(response);
  const actions = arrayFromWrapped(data?.actions, "action");
  if (actions.length === 0) {
    return "No open tasks were found.";
  }

  const total = numberOrUndefined(data?.total_count) ?? actions.length;
  const displayLimit = 100;
  const lines = actions.slice(0, displayLimit).map((action, index) => `${index + 1}. ${formatActionLine(action)}`);
  const extra =
    actions.length > displayLimit
      ? [`Showing the first ${displayLimit} tasks in text. The structured response includes all ${actions.length}.`]
      : [];
  return [`Found ${actions.length} task${actions.length === 1 ? "" : "s"}${total ? ` (${total} total)` : ""}.`, ...lines, ...extra].join(
    "\n"
  );
}

export function describeCreatedAction(response: unknown): string {
  const action = asRecord(getData(response)?.action);
  if (!action) {
    return "The task was created.";
  }
  return `Created task: ${formatActionLine(action)}`;
}

export function describeNote(response: unknown): string {
  const note = asRecord(getData(response)?.note);
  if (!note) {
    return "The note was added.";
  }
  const id = stringOrUndefined(note.id);
  const date = stringOrUndefined(note.date);
  return `Added note${id ? ` ${id}` : ""}${date ? ` dated ${date}` : ""}.`;
}

export function describeNotes(response: unknown): string {
  const notes = arrayFromWrapped(getData(response)?.notes, "note");
  if (notes.length === 0) {
    return "No notes were found.";
  }
  return notes.map((note, index) => `${index + 1}. ${formatNoteLine(note)}`).join("\n");
}

export function describeDeals(response: unknown): string {
  const deals = arrayFromWrapped(getData(response)?.deals, "deal");
  if (deals.length === 0) {
    return "No deals were found.";
  }
  return deals.map((deal, index) => `${index + 1}. ${formatDealLine(deal)}`).join("\n");
}

export function describeDeal(response: unknown): string {
  const deal = asRecord(getData(response)?.deal);
  return deal ? formatDealLine(deal) : "The deal was returned, but the response did not include deal details.";
}

export function describeUsers(response: unknown): string {
  const users = arrayFromWrapped(getDataValue(response), "user");
  if (users.length === 0) {
    return "No users were found.";
  }
  return users.map((user, index) => `${index + 1}. ${formatUserLine(user)}`).join("\n");
}

export function describeCalls(response: unknown): string {
  const calls = arrayFromWrapped(getData(response)?.calls, "call");
  if (calls.length === 0) {
    return "No calls were found.";
  }
  return calls.map((call, index) => `${index + 1}. ${formatCallLine(call)}`).join("\n");
}

export function describeEmails(response: unknown): string {
  const emails = arrayFromWrapped(getData(response)?.email_messages, "email_message");
  if (emails.length === 0) {
    return "No emails were found.";
  }
  return emails.map((email, index) => `${index + 1}. ${formatEmailLine(email)}`).join("\n");
}

export function structuredActions(response: unknown): Record<string, unknown> {
  return paginated("actions", arrayFromWrapped(getData(response)?.actions, "action").map(actionSummary), response);
}

export function structuredNotes(response: unknown): Record<string, unknown> {
  return paginated("notes", arrayFromWrapped(getData(response)?.notes, "note").map(noteSummary), response);
}

export function structuredCreatedNote(response: unknown): Record<string, unknown> {
  const note = asRecord(getData(response)?.note);
  return { note, summary: note ? noteSummary(note) : undefined };
}

export function structuredDeals(response: unknown): Record<string, unknown> {
  return paginated("deals", arrayFromWrapped(getData(response)?.deals, "deal").map(dealSummary), response);
}

export function structuredDeal(response: unknown): Record<string, unknown> {
  const deal = asRecord(getData(response)?.deal);
  return { deal: deal ? dealSummary(deal) : undefined };
}

export function structuredUsers(response: unknown): Record<string, unknown> {
  return { users: arrayFromWrapped(getDataValue(response), "user").map(userSummary) };
}

export function structuredCalls(response: unknown): Record<string, unknown> {
  return paginated("calls", arrayFromWrapped(getData(response)?.calls, "call").map(callSummary), response);
}

export function structuredEmails(response: unknown): Record<string, unknown> {
  return paginated(
    "emails",
    arrayFromWrapped(getData(response)?.email_messages, "email_message").map(emailSummary),
    response
  );
}

export function describeDoneAction(response: unknown): string {
  const action = asRecord(getData(response)?.action);
  if (!action) {
    return "The task was marked done.";
  }
  if (action.done === true || action.status === "done") {
    return `Task is done: ${formatActionLine(action)}`;
  }
  return `Updated task: ${formatActionLine(action)}`;
}

function formatContactLine(contact: RecordValue): string {
  const name = joinName(contact.first_name, contact.last_name) || stringOrUndefined(contact.name) || "Unnamed contact";
  const company = stringOrUndefined(contact.company_name);
  const id = stringOrUndefined(contact.id);
  const email = firstListValue(contact.emails);
  const phone = firstListValue(contact.phones);
  const details = [company, email, phone, id ? `ID: ${id}` : undefined].filter(Boolean).join(" | ");
  return details ? `${name} (${details})` : name;
}

function formatActionLine(action: RecordValue): string {
  const text = stringOrUndefined(action.text) ?? stringOrUndefined(action.name) ?? "Untitled task";
  const status = stringOrUndefined(action.status);
  const date = stringOrUndefined(action.date);
  const id = stringOrUndefined(action.id);
  const pieces = [status ? `status: ${status}` : undefined, date ? `due: ${date}` : undefined, id ? `ID: ${id}` : undefined];
  return `${text}${pieces.length ? ` (${pieces.filter(Boolean).join(" | ")})` : ""}`;
}

function formatNoteLine(note: RecordValue): string {
  const text = stringOrUndefined(note.text) ?? "Untitled note";
  const author = stringOrUndefined(note.author_name) ?? stringOrUndefined(note.author);
  const created = stringOrUndefined(note.created_at) ?? stringOrUndefined(note.date);
  const id = stringOrUndefined(note.id);
  return [text, author ? `author: ${author}` : undefined, created ? `created: ${created}` : undefined, id ? `ID: ${id}` : undefined]
    .filter(Boolean)
    .join(" | ");
}

function formatDealLine(deal: RecordValue): string {
  const name = stringOrUndefined(deal.name) ?? "Untitled deal";
  const id = stringOrUndefined(deal.id);
  const value = numberOrUndefined(deal.amount) ?? numberOrUndefined(deal.total_amount);
  const status = normalizeDealStatus(stringOrUndefined(deal.status));
  const stage = numberOrUndefined(deal.stage);
  const closeDate = stringOrUndefined(deal.expected_close_date) ?? stringOrUndefined(deal.close_date);
  return [
    name,
    value !== undefined ? `value: ${value}` : undefined,
    stage !== undefined ? `stage: ${stage}` : undefined,
    status ? `status: ${status}` : undefined,
    closeDate ? `close: ${closeDate}` : undefined,
    id ? `ID: ${id}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatUserLine(user: RecordValue): string {
  const name = joinName(user.first_name, user.last_name) ?? "Unnamed user";
  const email = stringOrUndefined(user.email);
  const id = stringOrUndefined(user.id);
  return [name, email, id ? `ID: ${id}` : undefined].filter(Boolean).join(" | ");
}

function formatCallLine(call: RecordValue): string {
  const text = stringOrUndefined(call.text) ?? "Call";
  const author = stringOrUndefined(call.author_name) ?? stringOrUndefined(call.author);
  const created = stringOrUndefined(call.created_at);
  const id = stringOrUndefined(call.id);
  return [text, author ? `author: ${author}` : undefined, created ? `created: ${created}` : undefined, id ? `ID: ${id}` : undefined]
    .filter(Boolean)
    .join(" | ");
}

function formatEmailLine(email: RecordValue): string {
  const subject = stringOrUndefined(email.subject) ?? "No subject";
  const sender = stringOrUndefined(email.sender);
  const sent = stringOrUndefined(email.send_time) ?? stringOrUndefined(email.created_at);
  const id = stringOrUndefined(email.id);
  return [subject, sender ? `from: ${sender}` : undefined, sent ? `sent: ${sent}` : undefined, id ? `ID: ${id}` : undefined]
    .filter(Boolean)
    .join(" | ");
}

function getData(value: unknown): RecordValue | undefined {
  const record = asRecord(value);
  return asRecord(record?.data);
}

function getDataValue(value: unknown): unknown {
  const record = asRecord(value);
  return record?.data;
}

function arrayFromWrapped(value: unknown, key: string): RecordValue[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    const wrapped = asRecord(record?.[key]);
    return wrapped ? [wrapped] : record ? [record] : [];
  });
}

function firstListValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const item of value) {
    const record = asRecord(item);
    const raw = stringOrUndefined(record?.value);
    if (raw) {
      return raw;
    }
  }
  return undefined;
}

function joinName(first: unknown, last: unknown): string | undefined {
  const joined = [stringOrUndefined(first), stringOrUndefined(last)].filter(Boolean).join(" ").trim();
  return joined || undefined;
}

function asRecord(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function paginated(key: string, items: unknown[], response: unknown): Record<string, unknown> {
  const data = getData(response);
  return {
    [key]: items,
    total_count: numberOrUndefined(data?.total_count),
    page: numberOrUndefined(data?.page),
    per_page: numberOrUndefined(data?.per_page),
    max_page: numberOrUndefined(data?.max_page)
  };
}

function actionSummary(action: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(action.id),
    text: stringOrUndefined(action.text),
    status: stringOrUndefined(action.status),
    date: stringOrUndefined(action.date),
    contact_id: stringOrUndefined(action.contact_id),
    contact_name: stringOrUndefined(action.contact_name),
    company_id: stringOrUndefined(action.company_id),
    company_name: stringOrUndefined(action.company_name),
    assignee_id: stringOrUndefined(action.assignee_id),
    assignee_name: stringOrUndefined(action.assignee_name),
    completed_at: action.done === true ? stringOrUndefined(action.completed_at) : undefined,
    completed_by_name: action.done === true ? stringOrUndefined(action.completed_by_name) : undefined
  };
}

function noteSummary(note: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(note.id),
    text: stringOrUndefined(note.text),
    created_at: stringOrUndefined(note.created_at),
    author_id: stringOrUndefined(note.author_id) ?? stringOrUndefined(note.user_id),
    author_name: stringOrUndefined(note.author_name) ?? stringOrUndefined(note.author),
    contact_id: stringOrUndefined(note.contact_id),
    contact_name: stringOrUndefined(note.contact_name)
  };
}

function dealSummary(deal: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(deal.id),
    name: stringOrUndefined(deal.name),
    value: numberOrUndefined(deal.amount) ?? numberOrUndefined(deal.total_amount),
    stage: numberOrUndefined(deal.stage),
    status: normalizeDealStatus(stringOrUndefined(deal.status)),
    contact_id: stringOrUndefined(deal.contact_id),
    contact_name: stringOrUndefined(deal.contact_name),
    owner_id: stringOrUndefined(deal.owner_id),
    owner_name: stringOrUndefined(deal.owner_name),
    expected_close_date: stringOrUndefined(deal.expected_close_date),
    created_at: stringOrUndefined(deal.created_at)
  };
}

function userSummary(user: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(user.id),
    first_name: stringOrUndefined(user.first_name),
    last_name: stringOrUndefined(user.last_name),
    email: stringOrUndefined(user.email),
    active: typeof user.active === "boolean" ? user.active : undefined
  };
}

function callSummary(call: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(call.id),
    contact_id: stringOrUndefined(call.contact_id),
    contact_name: stringOrUndefined(call.contact_name),
    text: stringOrUndefined(call.text),
    created_at: stringOrUndefined(call.created_at),
    author_id: stringOrUndefined(call.author_id),
    author_name: stringOrUndefined(call.author_name) ?? stringOrUndefined(call.author),
    call_time_int: numberOrUndefined(call.call_time_int),
    phone_number: stringOrUndefined(call.phone_number),
    call_result: stringOrUndefined(call.call_result),
    recording_link: stringOrUndefined(call.recording_link)
  };
}

function emailSummary(email: RecordValue): Record<string, unknown> {
  return {
    id: stringOrUndefined(email.id),
    contact_id: stringOrUndefined(email.contact_id),
    contact_name: stringOrUndefined(email.contact_name),
    type: stringOrUndefined(email.type),
    send_time: stringOrUndefined(email.send_time),
    created_at: stringOrUndefined(email.created_at),
    author_id: stringOrUndefined(email.author_id),
    author_name: stringOrUndefined(email.author_name),
    sender: stringOrUndefined(email.sender),
    recipients: email.recipients,
    subject: stringOrUndefined(email.subject),
    plain_content: stringOrUndefined(email.plain_content),
    status: stringOrUndefined(email.status),
    incoming_email: typeof email.incoming_email === "boolean" ? email.incoming_email : undefined,
    url: stringOrUndefined(email.url)
  };
}

function normalizeDealStatus(status: string | undefined): string | undefined {
  return status === "pending" ? "open" : status;
}
