import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { jiminnyGet } from "./jiminnyClient.js";

const PORT = process.env.PORT || 3000;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!MCP_AUTH_TOKEN) {
  throw new Error("MCP_AUTH_TOKEN environment variable is required");
}

function toResult(result) {
  if (result.error) {
    return {
      content: [
        {
          type: "text",
          text: `Jiminny API error (HTTP ${result.status}): ${
            typeof result.body === "string" ? result.body : JSON.stringify(result.body)
          }`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify(result.data ?? result.note ?? null, null, 2) }],
  };
}

function buildServer() {
  const server = new McpServer({ name: "jiminny-mcp-server", version: "1.0.0" });

  server.registerTool(
    "jiminny_get_organization",
    {
      title: "Get Jiminny organization profile",
      description: "Returns the current authenticated Jiminny organization (profile:read).",
      inputSchema: {},
    },
    async () => toResult(await jiminnyGet("/me"))
  );

  server.registerTool(
    "jiminny_get_users",
    {
      title: "List Jiminny users",
      description: "Lists the users on the team, including name, email, team, and CRM id.",
      inputSchema: {},
    },
    async () => toResult(await jiminnyGet("/getUsers"))
  );

  server.registerTool(
    "jiminny_get_activities",
    {
      title: "List Jiminny call/meeting activities",
      description:
        "Lists calls and meetings (activities). Provide fromDate/toDate or updatedFrom/updatedTo (max 6 month range). Filter by accountId or opportunityId to scope to a specific CRM account/deal.",
      inputSchema: {
        fromDate: z.string().optional().describe("UTC date-time, e.g. 2026-08-01 00:00:00"),
        toDate: z.string().optional().describe("UTC date-time, e.g. 2026-08-31 23:59:59"),
        updatedFrom: z.string().optional(),
        updatedTo: z.string().optional(),
        status: z
          .enum(["received", "sent", "delivered", "in-progress", "completed"])
          .optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(500).optional(),
        accountId: z.string().optional().describe("External CRM account ID"),
        opportunityId: z.string().optional().describe("External CRM opportunity/deal ID"),
      },
    },
    async (args) => toResult(await jiminnyGet("/getActivities", args))
  );

  server.registerTool(
    "jiminny_get_activity",
    {
      title: "Get a single Jiminny activity",
      description:
        "Returns full detail for one call/meeting by activity ID, including CRM account/opportunity (deal), participants, tracks, comments, and coaching feedback.",
      inputSchema: {
        activityId: z.string().uuid(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getActivity", args))
  );

  server.registerTool(
    "jiminny_get_transcription",
    {
      title: "Get call transcript",
      description: "Returns transcript segments for a given activity ID.",
      inputSchema: {
        activityId: z.string().uuid(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getTranscription", args))
  );

  server.registerTool(
    "jiminny_get_summary",
    {
      title: "Get AI call summary",
      description: "Returns the AI-generated summary for a call/meeting.",
      inputSchema: {
        activityId: z.string().uuid(),
        format: z.enum(["text", "html"]).optional(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getSummary", args))
  );

  server.registerTool(
    "jiminny_get_action_items",
    {
      title: "Get call action items",
      description: "Returns AI-extracted action items for a call/meeting.",
      inputSchema: {
        activityId: z.string().uuid(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getActionItems", args))
  );

  server.registerTool(
    "jiminny_get_questions",
    {
      title: "Get questions asked on a call",
      description: "Returns questions detected on a call/meeting, with engagement/insight flags.",
      inputSchema: {
        activityId: z.string().uuid(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getQuestions", args))
  );

  server.registerTool(
    "jiminny_get_ai_scorecard",
    {
      title: "Get AI call scorecard for one activity",
      description: "Returns AI scorecard run(s) for a single call/meeting.",
      inputSchema: {
        activityId: z.string().uuid(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getAiScorecard", args))
  );

  server.registerTool(
    "jiminny_get_ai_scorecards",
    {
      title: "List AI call scorecards over a date range",
      description:
        "Lists AI scorecards completed within fromDate/toDate (both required), paginated.",
      inputSchema: {
        fromDate: z.string(),
        toDate: z.string(),
        page: z.number().int().min(1).optional(),
      },
    },
    async (args) => toResult(await jiminnyGet("/getAiScorecards", args))
  );

  return server;
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.status(200).send("jiminny-mcp-server: ok");
});

app.post("/mcp/:token", async (req, res) => {
  if (req.params.token !== MCP_AUTH_TOKEN) {
    res.status(404).end();
    return;
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp/:token", (req, res) => {
  if (req.params.token !== MCP_AUTH_TOKEN) {
    res.status(404).end();
    return;
  }
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed: this server is stateless (no SSE stream)." },
    id: null,
  });
});

app.listen(PORT, () => {
  console.log(`jiminny-mcp-server listening on port ${PORT}`);
});
