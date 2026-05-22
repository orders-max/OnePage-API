import "dotenv/config";

export type AppConfig = {
  onePageCrmEndpoint: string;
  onePageCrmUserId: string;
  onePageCrmApiKey: string;
  transport: "http" | "stdio";
  port: number;
  mcpBearerToken?: string;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Endpoint must use https:// unless it is localhost.");
    }
    return trimmed;
  } catch (error) {
    if (error instanceof Error && error.message.includes("Endpoint must")) {
      throw error;
    }
    throw new Error("ONEPAGECRM_ENDPOINT must be a valid URL, for example https://app.onepagecrm.com/api/v3");
  }
}

function readTransport(): "http" | "stdio" {
  const value = process.env.MCP_TRANSPORT?.trim().toLowerCase() ?? "http";
  if (value === "http" || value === "stdio") {
    return value;
  }
  throw new Error('MCP_TRANSPORT must be either "http" or "stdio".');
}

function readPort(): number {
  const value = process.env.PORT?.trim() ?? "3000";
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a number between 1 and 65535.");
  }
  return port;
}

export function loadConfig(): AppConfig {
  return {
    onePageCrmEndpoint: normalizeEndpoint(requiredEnv("ONEPAGECRM_ENDPOINT")),
    onePageCrmUserId: requiredEnv("ONEPAGECRM_USER_ID"),
    onePageCrmApiKey: requiredEnv("ONEPAGECRM_API_KEY"),
    transport: readTransport(),
    port: readPort(),
    mcpBearerToken: process.env.MCP_BEARER_TOKEN?.trim() || undefined
  };
}
