import express, { type NextFunction, type Request, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type UserCredentials } from "./config.js";
import { createMcpServer } from "./mcpServer.js";

if (process.argv.includes("--stdio")) process.env.MCP_TRANSPORT = "stdio";
if (process.argv.includes("--http")) process.env.MCP_TRANSPORT = "http";

const config = loadConfig();

if (config.userMap.size > 0) {
  console.error(`USER_MAP loaded: ${config.userMap.size} user(s) — tokens: ${[...config.userMap.keys()].join(", ")}`);
} else {
  console.error("USER_MAP not set — running in single-user mode.");
}

if (config.transport === "stdio") {
  await runStdio();
} else {
  await runHttp();
}

async function runStdio(): Promise<void> {
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("OnePage CRM MCP server running in stdio mode.");
}

async function runHttp(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/", (_req, res) => {
    res.type("text/plain").send("OnePage CRM MCP server is running. Use /mcp for Streamable HTTP or /sse for SSE.");
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      name: "onepagecrm-mcp-server",
      commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
      transports: { streamableHttp: "/mcp", sse: "/sse" },
    });
  });

  app.use(["/mcp", "/sse", "/messages"], requireBearerToken);

  app.post("/mcp", async (req, res) => {
    const server = createMcpServer(config, res.locals.userCreds as UserCredentials | undefined);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request failed:", safeErrorMessage(error));
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error." }, id: null });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST for this stateless MCP endpoint." }, id: null });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. This stateless MCP endpoint does not keep sessions." }, id: null });
  });

  const sseTransports = new Map<string, { transport: SSEServerTransport; server: ReturnType<typeof createMcpServer> }>();

  app.get("/sse", async (_req, res) => {
    const server = createMcpServer(config, res.locals.userCreds as UserCredentials | undefined);
    const transport = new SSEServerTransport("/messages", res);
    sseTransports.set(transport.sessionId, { transport, server });

    res.on("close", () => {
      sseTransports.delete(transport.sessionId);
      void server.close();
    });

    try {
      await server.connect(transport);
    } catch (error) {
      console.error("SSE connection failed:", safeErrorMessage(error));
      if (!res.headersSent) res.status(500).send("SSE connection failed.");
    }
  });

  app.post("/messages", async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    const entry = sessionId ? sseTransports.get(sessionId) : undefined;
    if (!entry) {
      res.status(400).json({ error: "Missing or unknown SSE session ID." });
      return;
    }

    try {
      await entry.transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error("SSE message failed:", safeErrorMessage(error));
      if (!res.headersSent) res.status(500).json({ error: "SSE message failed." });
    }
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("HTTP server error:", safeErrorMessage(error));
    if (!res.headersSent) res.status(500).json({ error: "Server error." });
  });

  app.listen(config.port, () => {
    console.error(`OnePage CRM MCP server listening on http://localhost:${config.port}`);
    console.error(`Streamable HTTP endpoint: http://localhost:${config.port}/mcp`);
    console.error(`SSE endpoint: http://localhost:${config.port}/sse`);
  });
}

function requireBearerToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.header("authorization") ?? "";
  const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = headerToken || queryToken;

  // Multi-user mode: token must be a key in userMap.
  if (config.userMap.size > 0) {
    const userCreds = config.userMap.get(token);
    if (!userCreds) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    res.locals.userCreds = userCreds;
    next();
    return;
  }

  // Single-user mode: validate against MCP_BEARER_TOKEN (if set).
  if (config.mcpBearerToken && token !== config.mcpBearerToken) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }

  next();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
