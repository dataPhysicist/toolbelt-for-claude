#!/usr/bin/env node
/**
 * Toolbelt bridge — a thin local MCP server (stdio) that proxies to the remote
 * Toolbelt MCP endpoint and augments it so the extension carries the router
 * behavior itself. Zero Toolbelt server changes.
 *
 * Tool model (constant size — scales to any number of org agents):
 *   • list_agents(query?)          — discover the org's agents (searchable)
 *   • ask_agent(agent, task, model?) — delegate to any agent by name/id, get the answer
 *   • check_agent_result(correlationId) — poll a long-running task
 *   • set_pinned_agents([...])      — pin favorites; they appear as individual
 *                                     ask_<name> tools (persisted, operator-pre-bakeable)
 *   • read_storage_file, toolbelt, toolbelt_help — MAP rules + ad-hoc management
 *   + one ask_<name> tool per PINNED agent only (not one per agent).
 *
 * Resilient: reconnects if the upstream session drops; sends MCP progress while a
 * delegation runs. Auth: API key sent as Authorization: Bearer (never in the URL).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = "0.11.0";
const log = (...a) => process.stderr.write(`[toolbelt-bridge] ${a.join(" ")}\n`);

const MCP_URL = process.env.TOOLBELT_MCP_URL;
const API_KEY = process.env.TOOLBELT_API_KEY;
if (!MCP_URL || !API_KEY) {
  log("FATAL: TOOLBELT_MCP_URL and TOOLBELT_API_KEY must both be set.");
  process.exit(1);
}
const WS_KEY = (MCP_URL.match(/workspaces\/([^/]+)/) || [, MCP_URL])[1];

let ORG_OVERRIDE = (process.env.TOOLBELT_ORG_NAME || "").trim();
if (!ORG_OVERRIDE || ORG_OVERRIDE.includes("${")) ORG_OVERRIDE = "";

// Optional pre-seed of pinned agents (operator pre-bake / install field): names or ids.
const PINNED_SEED = (process.env.TOOLBELT_PINNED_AGENTS || "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && !s.includes("${"));

const ROUTER_BODY = readFileSync(join(HERE, "router-instructions.md"), "utf8");
const orgHeader = (name) =>
  name
    ? `> This connection is the **${name}** Toolbelt org. Refer to it by that name in greetings and attributions.\n\n`
    : "";
const ROUTER_INSTRUCTIONS = orgHeader(ORG_OVERRIDE) + ROUTER_BODY;

const ROUTER_PROMPT = {
  name: "toolbelt",
  description:
    "Load the Toolbelt router instructions: discover agents, delegate via ask_agent (or pinned ask_<name> tools), pick the optimal model, report honestly, and stay pause-aware.",
};

const AGENT_PREFIX = "ask_";
const WAIT_ITERS = 6;
const WAIT_SECS = 30;
const ROSTER_TTL_MS = 60_000;

// Toolbelt tools passed straight through to Claude (ad-hoc management + MAP rules).
const CORE_TOOLS = new Set(["read_storage_file", "toolbelt", "toolbelt_help"]);

// --- constant generic tools (independent of org size) ---
const ASK_PROPS = {
  task: { type: "string", description: "What you want the agent to do." },
  model: {
    type: "string",
    description: "Optional model override per Model Auto-Pilot (e.g. gemini-3.5-flash). Omit for the agent's default.",
  },
};
const GENERIC_TOOLS = [
  {
    name: "list_agents",
    description:
      "List the org's agents you can delegate to. Optional `query` filters by name/description (use it for large orgs). Returns each agent's name + purpose; pass the name to ask_agent or set_pinned_agents.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Optional search filter over name/description." } },
    },
  },
  {
    name: "ask_agent",
    description:
      "Delegate a task to one of the org's agents by name (from list_agents) and get its answer. The agent runs in Toolbelt with its own memory, tools, and guardrails. Use this for any agent; pinned agents also have their own ask_<name> tool.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Agent name or id (from list_agents)." },
        ...ASK_PROPS,
      },
      required: ["agent", "task"],
    },
  },
  {
    name: "check_agent_result",
    description:
      "Check the status or final answer of a long-running delegation, using the correlationId an ask_agent / ask_<name> tool reported when it was still working.",
    inputSchema: {
      type: "object",
      properties: { correlationId: { type: "string", description: "The correlationId reported by the agent tool." } },
      required: ["correlationId"],
    },
  },
  {
    name: "set_pinned_agents",
    description:
      "Pin a small set of favorite agents so they appear as individual ask_<name> tools for one-click access. Pass agent names or ids (from list_agents). Replaces the current pinned set and persists across restarts.",
    inputSchema: {
      type: "object",
      properties: {
        agents: { type: "array", items: { type: "string" }, description: "Agent names or ids to pin (replaces current pins)." },
      },
      required: ["agents"],
    },
  },
];

const TOOL_OVERRIDES = {
  toolbelt:
    "Ad-hoc Toolbelt org management — create/configure assistants, enable services, tasks, dashboards, etc. " +
    "To DELEGATE a task to an agent, use ask_agent (or a pinned ask_<name> tool) instead. Do NOT use " +
    "create_sub_chat / sleep / get_pending_sub_chats for delegation — they need a chat context this external client lacks.",
};
const rewriteTool = (t) => (TOOL_OVERRIDES[t.name] ? { ...t, description: TOOL_OVERRIDES[t.name] } : t);

// --- helpers ---
function extractData(res) {
  if (res && res.structuredContent && typeof res.structuredContent === "object") return res.structuredContent;
  const text = res?.content?.find?.((c) => c.type === "text")?.text;
  if (typeof text === "string") {
    try {
      return JSON.parse(text);
    } catch {
      return { _raw: text };
    }
  }
  // manage_delegations returns data at the top level of the result (loose schema).
  if (
    res &&
    typeof res === "object" &&
    (res.correlationId !== undefined ||
      res.responseContent !== undefined ||
      res.assistants !== undefined ||
      res.organizations !== undefined ||
      res.status !== undefined ||
      res.success !== undefined)
  ) {
    return res;
  }
  return {};
}
function slugify(s) {
  return (
    String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "agent"
  );
}
function isSessionError(e) {
  if (e?.code === -32000 || e?.code === -32001) return true;
  if ((e?.constructor?.name || "") === "StreamableHTTPError") return true;
  return /fetch failed|terminated|ECONNRESET|socket hang up|session|closed|network|aborted|not found/i.test(e?.message || "");
}
function isAuthError(e) {
  if ((e?.constructor?.name || "") === "UnauthorizedError") return true;
  if (e?.code === 401 || e?.code === 403) return true;
  return /\b401\b|\b403\b|unauthor|forbidden|invalid.*(key|token|credential)/i.test(e?.message || "");
}
function text(t) {
  return { content: [{ type: "text", text: t }] };
}
function err(t) {
  return { isError: true, content: [{ type: "text", text: t }] };
}

// --- pin persistence (survives extension updates) ---
const PIN_DIR = join(os.homedir(), ".toolbelt-claude");
const PIN_FILE = join(PIN_DIR, "pins.json");
function loadAllPins() {
  try {
    return JSON.parse(readFileSync(PIN_FILE, "utf8"));
  } catch {
    return {};
  }
}
function savePinnedIds(ids) {
  const all = loadAllPins();
  all[WS_KEY] = ids;
  try {
    mkdirSync(PIN_DIR, { recursive: true });
    writeFileSync(PIN_FILE, JSON.stringify(all, null, 2));
  } catch (e) {
    log(`could not persist pins: ${e.message}`);
  }
}

// --- upstream (remote Toolbelt MCP) with reconnect ---
let upstream = null;
let connected = false;
let connecting = null;
async function connectUpstream() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  });
  transport.onclose = () => {
    connected = false;
  };
  const client = new Client({ name: "toolbelt-bridge", version: VERSION }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (e) {
    if (isAuthError(e)) {
      throw new Error(
        "Toolbelt rejected the credentials (401/403). Check your API key and hub workspace ID in the extension settings.",
      );
    }
    throw new Error(`Toolbelt upstream not reachable: ${e.message}`);
  }
  upstream = client;
  connected = true;
  log("connected to upstream Toolbelt MCP");
}
function ensureUpstream() {
  if (connected) return Promise.resolve();
  if (!connecting) connecting = connectUpstream().finally(() => (connecting = null));
  return connecting;
}
async function withUpstream(fn) {
  await ensureUpstream();
  try {
    return await fn(upstream);
  } catch (e) {
    if (isSessionError(e)) {
      log(`upstream session error (${e.message}); reconnecting…`);
      connected = false;
      try {
        await upstream?.close?.();
      } catch {
        /* ignore */
      }
      await ensureUpstream();
      return fn(upstream);
    }
    throw e;
  }
}

// --- roster (cached) ---
let rosterCache = null;
let rosterAt = 0;
async function getRoster() {
  if (rosterCache && Date.now() - rosterAt < ROSTER_TTL_MS) return rosterCache;
  const res = await withUpstream((c) => c.callTool({ name: "toolbelt", arguments: { action: "list_assistants" } }));
  const assistants = extractData(res).assistants;
  if (!Array.isArray(assistants)) throw new Error("roster not parseable");
  rosterCache = [...assistants].sort(
    (a, b) => new Date(b.lastUpdated || 0).getTime() - new Date(a.lastUpdated || 0).getTime(),
  );
  rosterAt = Date.now();
  return rosterCache;
}
function resolveAgent(roster, str) {
  if (!str) return null;
  const s = String(str).trim();
  let a = roster.find((x) => x.id === s);
  if (a) return a;
  const lc = s.toLowerCase();
  a = roster.find((x) => (x.name || "").toLowerCase() === lc);
  if (a) return a;
  const sl = slugify(s.replace(/^ask_/, ""));
  a = roster.find((x) => slugify(x.name) === sl);
  if (a) return a;
  return roster.find((x) => (x.name || "").toLowerCase().includes(lc)) || null;
}

// --- pinned agents ---
let pinnedIds = null;
let agentToolIndex = new Map(); // ask_<name> -> { id, name }
async function getPinnedIds() {
  if (pinnedIds) return pinnedIds;
  const saved = loadAllPins()[WS_KEY];
  if (Array.isArray(saved)) {
    pinnedIds = saved;
    return pinnedIds;
  }
  if (PINNED_SEED.length) {
    try {
      const roster = await getRoster();
      pinnedIds = PINNED_SEED.map((s) => resolveAgent(roster, s)?.id).filter(Boolean);
      if (pinnedIds.length) savePinnedIds(pinnedIds);
      return pinnedIds;
    } catch {
      /* fall through */
    }
  }
  pinnedIds = [];
  return pinnedIds;
}
function agentTool(a) {
  const meta = a.provider && a.model ? ` Default model: ${a.provider}/${a.model}.` : "";
  return {
    name: `${AGENT_PREFIX}${slugify(a.name)}`,
    description:
      `Ask the "${a.name}" agent to do a task and get its answer.` +
      `${a.description ? " " + a.description : ""}${meta} Runs in Toolbelt with its own memory, tools, and guardrails.`,
    inputSchema: { type: "object", properties: { ...ASK_PROPS }, required: ["task"] },
  };
}
async function buildPinnedTools() {
  const ids = await getPinnedIds();
  agentToolIndex = new Map();
  if (!ids.length) return [];
  const roster = await getRoster();
  const byId = new Map(roster.map((a) => [a.id, a]));
  const tools = [];
  const used = new Set();
  for (const id of ids) {
    const a = byId.get(id);
    if (!a) continue;
    const t = agentTool(a);
    while (used.has(t.name)) t.name = `${t.name}_${String(a.id).slice(0, 6)}`;
    used.add(t.name);
    agentToolIndex.set(t.name, { id: a.id, name: a.name });
    tools.push(t);
  }
  return tools;
}

// --- delegation (create → wait, with progress) ---
async function delegateToAgent(id, label, { task, model } = {}, ctx = {}) {
  if (!task) return err("Provide a 'task' for the agent.");
  const createArgs = { action: "create", targetAssistantId: id, content: task };
  if (model) createArgs.model = model;
  const createRes = await withUpstream((c) => c.callTool({ name: "manage_delegations", arguments: createArgs }));
  const created = extractData(createRes);
  const correlationId = created.correlationId;
  if (!correlationId) {
    const raw = JSON.stringify(created).slice(0, 800);
    log(`delegation create returned no correlationId for ${label}: ${raw}`);
    return err(`Couldn't start a task for the "${label}" agent — no correlationId. Raw response: ${raw}`);
  }
  for (let i = 0; i < WAIT_ITERS; i++) {
    if (ctx.progressToken !== undefined && ctx.sendNotification) {
      ctx
        .sendNotification({
          method: "notifications/progress",
          params: { progressToken: ctx.progressToken, progress: i + 1, total: WAIT_ITERS },
        })
        .catch(() => {});
    }
    const res = await withUpstream((c) =>
      c.callTool({ name: "manage_delegations", arguments: { action: "wait", correlationId, timeoutSeconds: WAIT_SECS } }),
    );
    const d = extractData(res);
    if (d.responseContent) return text(String(d.responseContent));
    if (d.status && /fail|error|cancel/i.test(String(d.status))) return err(`Delegation to ${label} ${d.status}.`);
  }
  return text(
    `The "${label}" agent is still working (correlationId ${correlationId}). Check later with check_agent_result.`,
  );
}
async function checkResult(correlationId) {
  if (!correlationId) return err("Provide a correlationId.");
  const res = await withUpstream((c) =>
    c.callTool({ name: "manage_delegations", arguments: { action: "status", correlationId } }),
  );
  const d = extractData(res);
  if (d.responseContent) return text(String(d.responseContent));
  return text(`Status for ${correlationId}: ${d.status || "unknown"} (no answer yet).`);
}

// --- list_agents / set_pinned_agents handlers ---
async function listAgents(query) {
  const roster = await getRoster();
  const pins = new Set(await getPinnedIds());
  const q = (query || "").toLowerCase();
  const list = q
    ? roster.filter((a) => `${a.name} ${a.description || ""}`.toLowerCase().includes(q))
    : roster;
  const agents = list.map((a) => ({
    name: a.name,
    pinned: pins.has(a.id),
    model: a.provider && a.model ? `${a.provider}/${a.model}` : undefined,
    purpose: a.description || undefined,
  }));
  return text(JSON.stringify({ agents, count: agents.length, totalInOrg: roster.length }, null, 2));
}
async function setPinnedAgents(inputs) {
  const roster = await getRoster();
  const resolved = [];
  const unknown = [];
  for (const s of inputs || []) {
    const a = resolveAgent(roster, s);
    if (a && !resolved.find((r) => r.id === a.id)) resolved.push(a);
    else if (!a) unknown.push(s);
  }
  pinnedIds = resolved.map((a) => a.id);
  savePinnedIds(pinnedIds);
  try {
    server.sendToolListChanged?.();
  } catch {
    /* ignore */
  }
  return text(
    `Pinned ${resolved.length} agent(s): ${resolved.map((a) => a.name).join(", ") || "(none)"}.` +
      `${unknown.length ? ` Not found: ${unknown.join(", ")}.` : ""}` +
      ` They now appear as ask_<name> tools (you may need to reopen the chat to see them).`,
  );
}

// --- downstream server ---
const server = new Server(
  { name: "toolbelt", version: VERSION },
  { capabilities: { tools: { listChanged: true }, prompts: {} }, instructions: ROUTER_INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // GENERIC_TOOLS are always returned, even if the upstream is momentarily down —
  // they reconnect lazily when actually called.
  let core = [];
  try {
    const { tools = [] } = await withUpstream((c) => c.listTools());
    core = tools.filter((t) => CORE_TOOLS.has(t.name)).map(rewriteTool);
  } catch (e) {
    log(`upstream listTools failed: ${e.message}`);
  }
  let pinned = [];
  try {
    pinned = await buildPinnedTools();
  } catch (e) {
    log(`pinned tools build failed: ${e.message}`);
  }
  return { tools: [...GENERIC_TOOLS, ...pinned, ...core] };
});

server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  const ctx = { sendNotification: extra?.sendNotification, progressToken: req.params?._meta?.progressToken };
  try {
    if (name === "list_agents") return await listAgents(args.query);
    if (name === "set_pinned_agents") return await setPinnedAgents(args.agents);
    if (name === "check_agent_result") return await checkResult(args.correlationId);
    if (name === "ask_agent") {
      const roster = await getRoster();
      const a = resolveAgent(roster, args.agent);
      if (!a) return err(`No agent matching "${args.agent}". Call list_agents to see available agents.`);
      return await delegateToAgent(a.id, a.name, args, ctx);
    }
    if (name.startsWith(AGENT_PREFIX)) {
      if (!agentToolIndex.has(name)) {
        try {
          await buildPinnedTools();
        } catch {
          /* ignore */
        }
      }
      const a = agentToolIndex.get(name);
      if (a) return await delegateToAgent(a.id, a.name, args, ctx);
    }
    return await withUpstream((c) => c.callTool({ name, arguments: args }));
  } catch (e) {
    return err(`Toolbelt error: ${e.message}`);
  }
});

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  let up = [];
  try {
    await ensureUpstream();
    up = (await withUpstream((c) => c.listPrompts())).prompts ?? [];
  } catch {
    /* upstream may not advertise prompts */
  }
  return { prompts: [ROUTER_PROMPT, ...up] };
});

server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  if (req.params.name === ROUTER_PROMPT.name) {
    return {
      description: ROUTER_PROMPT.description,
      messages: [{ role: "user", content: { type: "text", text: ROUTER_INSTRUCTIONS } }],
    };
  }
  return withUpstream((c) => c.getPrompt({ name: req.params.name, arguments: req.params.arguments ?? {} }));
});

await server.connect(new StdioServerTransport());
log(`toolbelt bridge ${VERSION} ready on stdio`);
