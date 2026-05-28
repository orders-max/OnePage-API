type ClientListTaskArgs = {
  assigneeId: string;
  dueDate: string;
  fetchAll: true;
  perPage: 100;
};

type McpListTaskArgs = {
  assigneeId: string;
  dueToday: true;
  fetchAll: true;
  perPage: 100;
};

const taskDate = process.env.TEST_TASK_DATE?.trim() || todayInTimeZone(process.env.TEST_TIME_ZONE || "America/Regina");
const assigneeId = process.env.TEST_ONEPAGECRM_ASSIGNEE_ID?.trim() || "64356f39cbd21b3445c08b05";
const clientArgs: ClientListTaskArgs = {
  assigneeId,
  dueDate: taskDate,
  fetchAll: true,
  perPage: 100
};
const mcpArgs: McpListTaskArgs = {
  assigneeId,
  dueToday: true,
  fetchAll: true,
  perPage: 100
};

try {
  const response = process.env.MCP_TEST_SERVER_URL
    ? await callMcpListTasks(process.env.MCP_TEST_SERVER_URL, mcpArgs)
    : await callClientListTasks(clientArgs);
  const actions = extractActions(response);
  const dates = actions.map(actionDate);
  const wrongDates = dates.filter((date) => date !== taskDate);

  if (actions.length >= 50) {
    throw new Error(`Expected fewer than 50 tasks due on ${taskDate}, but list_tasks returned ${actions.length}.`);
  }
  if (wrongDates.length > 0) {
    throw new Error(
      `Expected every returned task to have date ${taskDate}, but found ${wrongDates.length} mismatched date(s).`
    );
  }

  console.log(`list_tasks today check passed: ${actions.length} task(s) due on ${taskDate}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function callClientListTasks(args: ClientListTaskArgs): Promise<unknown> {
  const [{ loadConfig }, { OnePageCrmClient }] = await Promise.all([
    import("./config.js"),
    import("./onePageCrmClient.js")
  ]);
  const client = new OnePageCrmClient(loadConfig());
  return client.listActions(args);
}

async function callMcpListTasks(serverUrl: string, args: McpListTaskArgs): Promise<unknown> {
  const response = await fetch(serverUrl, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "test-list-tasks-today",
      method: "tools/call",
      params: {
        name: "list_tasks",
        arguments: args
      }
    })
  });
  const text = await response.text();
  const data = text.match(/^data: (.*)$/m)?.[1];
  if (!response.ok || !data) {
    throw new Error(`MCP list_tasks request failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const message = JSON.parse(data) as Record<string, unknown>;
  const result = isRecord(message.result) ? message.result : undefined;
  if (result?.isError === true) {
    throw new Error(`MCP list_tasks returned an error: ${JSON.stringify(result.content)}`);
  }

  return result?.structuredContent;
}

function extractActions(response: unknown): Record<string, unknown>[] {
  const record = isRecord(response) ? response : undefined;
  const data = isRecord(record?.data) ? record.data : record;
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  return actions.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    return [isRecord(item.action) ? item.action : item];
  });
}

function actionDate(action: Record<string, unknown>): string | undefined {
  return typeof action.date === "string" && action.date.trim() ? action.date.trim() : undefined;
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
