import "dotenv/config";

export type UserCredentials = {
  userId: string;
  apiKey: string;
};

export type AppConfig = {
  onePageCrmEndpoint: string;
  onePageCrmUserId: string;
  onePageCrmApiKey: string;
  transport: "http" | "stdio";
  port: number;
  mcpBearerToken?: string;
  userMap: Map<string, UserCredentials>;
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
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

function parseUserMap(raw: string | undefined): Map<string, UserCredentials> {
  if (!raw?.trim()) return new Map();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const map = new Map<string, UserCredentials>();
    for (const [token, value] of Object.entries(parsed)) {
      if (typeof value === "object" && value !== null) {
        const v = value as Record<string, unknown>;
        if (typeof v.userId === "string" && v.userId.trim() && typeof v.apiKey === "string" && v.apiKey.trim()) {
          map.set(token, { userId: v.userId.trim(), apiKey: v.apiKey.trim() });
        }
      }
    }
    return map;
  } catch {
    throw new Error("USER_MAP must be a valid JSON object mapping tokens to {userId, apiKey}.");
  }
}

export function loadConfig(): AppConfig {
  const userMap = parseUserMap(process.env.USER_MAP);
  const hasUserMap = userMap.size > 0;

  return {
    onePageCrmEndpoint: normalizeEndpoint(requiredEnv("ONEPAGECRM_ENDPOINT")),
    // When USER_MAP is set these become optional fallbacks; otherwise required.
    onePageCrmUserId: hasUserMap ? optionalEnv("ONEPAGECRM_USER_ID") : requiredEnv("ONEPAGECRM_USER_ID"),
    onePageCrmApiKey: hasUserMap ? optionalEnv("ONEPAGECRM_API_KEY") : requiredEnv("ONEPAGECRM_API_KEY"),
    transport: readTransport(),
    port: readPort(),
    mcpBearerToken: process.env.MCP_BEARER_TOKEN?.trim() || undefined,
    userMap
  };
}
