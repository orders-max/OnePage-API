import { OnePageCrmApiError } from "./onePageCrmClient.js";

type RecordValue = Record<string, unknown>;

export function successResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function errorResult(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: formatError(error) }] };
}

export function formatError(error: unknown): string {
  if (error instanceof OnePageCrmApiError) {
    return error.crmMessage ? `${error.message} OnePage CRM said: ${error.crmMessage}` : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong while talking to OnePage CRM.";
}

export function describeContactSearch(response: unknown): string {
  const data = getData(response);
  const items = arrayFromWrapped(data?.contacts, "contact");
  if (items.length === 0) return "No contacts were found.";
  const total = numberOrUndefined(data?.total_count) ?? items.length;
  const lines = items.slice(0, 10).map((contact, index) => `${index + 1}. ${formatContactLine(contact)}`);
  return [`Found ${items.length} contact${items.length === 1 ? "" : "s"} (${total} total).`, ...lines].join("\n");
}

export function describeContact(response: unknown): string {
  const data = getData(response);
  const contact = asRecord(data?.contact);
  if (!contact) return "The contact was returned, but the response did not include contact details.";
  const lines = [formatContactLine(contact)];
  const jobTitle = stringOrUndefined(contact.job_title);
  const background = stringOrUndefined(contact.background);
  const nextAction = asRecord(data?.next_action);
  if (jobTitle) lines.push(`Job title: ${jobTitle}`);
  if (background) lines.push(`Background: ${background}`);
  if (nextAction) lines.push(`Next action: ${formatActionLine(nextAction)}`);
  return lines.join("\n");
}

export function describeActions(response: unknown): string {
  const data = getData(response);
  const actions = arrayFromWrapped(data?.actions, "action");
  if (actions.length === 0) return "No open tasks were found.";
  const total = numberOrUndefined(data?.total_count) ?? actions.length;
  const lines = actions.slice(0, 20).map((action, index) => `${index + 1}. ${formatActionLine(action)}`);
  return [`Found ${actions.length} task${actions.length === 1 ? "" : "s"} (${total} total).`, ...lines].join("\n");
}

export function describeCreatedAction(response: unknown): string {
  const action = asRecord(getData(response)?.action);
  return action ? `Created task: ${formatActionLine(action)}` : "The task was created.";
}

export function describeNote(response: unknown): string {
  const note = asRecord(getData(response)?.note);
  if (!note) return "The note was added.";
  const id = stringOrUndefined(note.id);
  const date = stringOrUndefined(note.date);
  return `Added note${id ? ` ${id}` : ""}${date ? ` dated ${date}` : ""}.`;
}

export function describeDoneAction(response: unknown): string {
  const action = asRecord(getData(response)?.action);
  if (!action) return "The task was marked done.";
  return `Task is done: ${formatActionLine(action)}`;
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
  const pieces = [status ? `status: ${status}` : undefined, date ? `due: ${date}` : undefined, id ? `ID: ${id}` : undefined].filter(Boolean);
  return pieces.length ? `${text} (${pieces.join(" | ")})` : text;
}

function getData(value: unknown): RecordValue | undefined {
  return asRecord(asRecord(value)?.data);
}

function arrayFromWrapped(value: unknown, key: string): RecordValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const wrapped = asRecord(record?.[key]);
    return wrapped ? [wrapped] : record ? [record] : [];
  });
}

function firstListValue(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const raw = stringOrUndefined(asRecord(item)?.value);
    if (raw) return raw;
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
