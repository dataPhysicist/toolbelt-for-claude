#!/usr/bin/env node
/**
 * Toolbelt Assistant — a thin local stdio MCP proxy.
 *
 * Connects to ONE Toolbelt assistant's live workspace MCP endpoint and brings that
 * assistant into Claude: forwards all its tools/prompts, and surfaces its live
 * instructions (systemPrompt) as the server `instructions` hint + a persona prompt.
 *
 * Hard rules honored here:
 *  - stdio connects IMMEDIATELY; no network before server.connect() (Desktop kills slow handshakes)
 *  - stdout is the wire protocol; all logs go to stderr
 *  - crash-proof: unhandledRejection/uncaughtException are logged, never fatal
 *  - instructions are fetched LIVE (re-fetched per persona invocation), never embedded
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
  ElicitRequestSchema,
  CreateMessageRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const VERSION = "1.1.0";
const log = (...a) => process.stderr.write(`[toolbelt-assistant] ${a.join(" ")}\n`);

// Crash guards: a background HTTP/SSE blip must never take the long-lived server down.
process.on("unhandledRejection", (e) => log(`unhandledRejection: ${e?.message || e}`));
process.on("uncaughtException", (e) => log(`uncaughtException: ${e?.message || e}`));

// --- config (env; guard against unsubstituted ${user_config.*} placeholders) ---
// API key resolution: env (mcpb keychain / plugin user_config) -> key file -> setup mode.
// The key file lets ALL agent plugins share one credential, entered once.
const clean = (v) => (v && !v.includes("${") ? v.trim() : "");
const KEY_FILE = join(process.env.TOOLBELT_KEY_FILE || join(homedir(), ".toolbelt"), "api_key");
const readKeyFile = () => {
  try { return readFileSync(KEY_FILE, "utf8").trim(); } catch { return ""; }
};
let API_KEY = clean(process.env.TOOLBELT_API_KEY) || readKeyFile();
const WORKSPACE_ID = clean(process.env.TOOLBELT_WORKSPACE_ID);
const BASE_URL = (clean(process.env.TOOLBELT_BASE_URL) || "https://toolbelt.apexti.com").replace(/\/+$/, "");
let NAME = clean(process.env.TOOLBELT_ASSISTANT_NAME);
const MCP_URL = `${BASE_URL}/api/workspaces/${WORKSPACE_ID}/mcp`;

if (!WORKSPACE_ID) {
  log("FATAL: TOOLBELT_WORKSPACE_ID is required.");
  process.exit(1);
}
// Missing key is NOT fatal: serve a setup tool so the user can paste it in chat.
const needsSetup = () => !API_KEY;
const SETUP_TOOL = "toolbelt_setup";
const setupTool = () => ({
  name: SETUP_TOOL,
  description:
    `⚠️ ${NAME || "This agent"} needs a Toolbelt API key before its tools can load. ` +
    `Ask the user for their key (Toolbelt → Settings → Connect to Claude), then call this tool with it. ` +
    `It is saved to ${KEY_FILE} (shared by all agent plugins) — never echo it back.`,
  inputSchema: { type: "object", properties: { api_key: { type: "string", description: "The Toolbelt API key" } }, required: ["api_key"] },
});

// Static prompt: Claude Desktop only allows prompts DECLARED in the manifest AND requires
// the returned content to match the declared template EXACTLY (anti prompt-injection).
// So the prompt is a static pointer to the load_persona TOOL, which returns the live
// instructions (tool results are not template-validated).
// PROMPT_TEXT must stay byte-identical to manifest.json -> prompts[0].text.
const PROMPT_NAME = "persona";
const PROMPT_TEXT =
  "Call the load_persona tool from this connector now, then fully adopt the operating instructions it returns for the rest of this conversation.";
const PERSONA_TOOL = "load_persona";

// Long per-call timeout so long-running tools (e.g. manage_delegations) don't die.
const CALL_OPTS = { timeout: 10 * 60 * 1000, resetTimeoutOnProgress: true };

// --- upstream client (lazy connect, cached, reconnect on drop) ---
let upstream = null;
let connecting = null;

async function connectUpstream() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
  });
  transport.onerror = (e) => log(`upstream transport error: ${e?.message || e}`); // swallow
  transport.onclose = () => {
    if (upstream?.transport === transport) upstream = null;
    log("upstream session closed");
  };
  // Bridge server->client requests (elicitation = Toolbelt's "continue after N tool
  // calls?" guard, and sampling) through to Claude, IF the connected Claude client
  // supports them. Without this, an upstream elicitation would dead-end and hang the call.
  const downCaps = server.getClientCapabilities() || {};
  const caps = {};
  if (downCaps.elicitation) caps.elicitation = {};
  if (downCaps.sampling) caps.sampling = {};
  const client = new Client({ name: "toolbelt-assistant-proxy", version: VERSION }, { capabilities: caps });
  client.onerror = (e) => log(`upstream client error: ${e?.message || e}`); // swallow
  if (downCaps.elicitation)
    client.setRequestHandler(ElicitRequestSchema, (req) => {
      log("forwarding upstream elicitation to Claude");
      return server.elicitInput(req.params, CALL_OPTS);
    });
  if (downCaps.sampling)
    client.setRequestHandler(CreateMessageRequestSchema, (req) => server.createMessage(req.params, CALL_OPTS));
  log(`downstream caps: elicitation=${!!downCaps.elicitation} sampling=${!!downCaps.sampling}`);
  try {
    await client.connect(transport);
  } catch (e) {
    if (/\b401\b|\b403\b|unauthor|forbidden/i.test(e?.message || ""))
      throw new Error("Toolbelt rejected the credentials (401/403). Check your API key and workspace ID.");
    throw new Error(`Toolbelt not reachable at ${MCP_URL}: ${e.message}`);
  }
  upstream = client;
  log("connected to Toolbelt workspace MCP");
  return client;
}

function ensureUpstream() {
  if (upstream) return Promise.resolve(upstream);
  if (!connecting) connecting = connectUpstream().finally(() => (connecting = null));
  return connecting;
}

const sessionErr = (e) =>
  e?.code === -32000 ||
  e?.code === -32001 ||
  /fetch failed|terminated|ECONNRESET|socket hang up|session|closed|network|aborted/i.test(e?.message || "");

async function withUpstream(fn) {
  const c = await ensureUpstream();
  try {
    return await fn(c);
  } catch (e) {
    if (!sessionErr(e)) throw e;
    log(`upstream error (${e.message}); reconnecting once…`);
    try { await c.close?.(); } catch { /* ignore */ }
    upstream = null;
    return fn(await ensureUpstream());
  }
}

// --- live persona (never embedded; short cache only to absorb bursts) ---
let personaCache = { text: null, at: 0 };
let personaLoaded = false; // has the client loaded the agent's context this session?
const PERSONA_TTL_MS = 60 * 1000;

async function fetchPersona() {
  if (personaCache.text !== null && Date.now() - personaCache.at < PERSONA_TTL_MS) return personaCache.text;
  let text = "";
  try {
    const res = await withUpstream((c) =>
      c.callTool(
        { name: "toolbelt", arguments: { action: "get_assistant", params: JSON.stringify({ assistantId: WORKSPACE_ID }) } },
        undefined,
        CALL_OPTS,
      ),
    );
    const raw = res?.structuredContent ?? res?.content?.find?.((x) => x.type === "text")?.text;
    const data = typeof raw === "string" ? JSON.parse(raw) : raw || {};
    if (typeof data.systemPrompt === "string") text = data.systemPrompt;
    if (!NAME && data.name) NAME = String(data.name);
  } catch (e) {
    log(`get_assistant persona fetch failed (${e.message}); trying mcp-config…`);
    try {
      const r = await fetch(`${BASE_URL}/api/workspaces/${WORKSPACE_ID}/mcp-config`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      if (r.ok) text = (await r.json())?.mcpConfig?.systemPrompt || "";
      else log(`mcp-config fallback HTTP ${r.status}`);
    } catch (e2) {
      log(`mcp-config fallback failed: ${e2.message}`);
    }
  }
  personaCache = { text, at: Date.now() };
  return text;
}

const personaMessage = (p) => {
  const who = NAME || "this Toolbelt assistant";
  if (!p)
    return `Could not fetch live instructions for ${who} right now. Proceed using its tools; retry this prompt to load the persona.`;
  return (
    `From now on in this conversation, act as **${who}**, a Toolbelt assistant. ` +
    `Its tools, skills (wrench_*), and storage files are available to you via this connector — use them as your own. ` +
    `These are its current operating instructions (fetched live from Toolbelt):\n\n---\n\n${p}`
  );
};

// --- downstream server: connect stdio FIRST, network later ---
// Note: the toggle/Settings label comes from the manifest display_name (fixed at pack
// time) — runtime config can't change it; serverInfo below only affects logs/handshake.
const slugName = NAME ? NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "";
const server = new Server(
  { name: slugName ? `apexti-${slugName}` : "toolbelt-assistant", title: NAME || "Toolbelt Assistant", version: VERSION },
  {
    capabilities: { tools: {}, prompts: {} },
    instructions:
      `This connector brings the Toolbelt assistant "${NAME || "(name loads on first use)"}" into Claude — ` +
      `its live tools, skills, and files. To adopt its persona, call the "${PERSONA_TOOL}" tool ` +
      `(it returns the assistant's current operating instructions, fetched live from Toolbelt) ` +
      `and fully adopt what it returns. The "${PROMPT_NAME}" prompt does the same via one click.`,
  },
);

// tools/list → forward (brief cache so repeated listings don't hammer upstream).
// On upstream failure, surface a diagnostic tool instead of a silent empty list.
let toolsCache = { tools: null, at: 0 };
let lastUpstreamError = "";
const TOOLS_TTL_MS = 30 * 1000;
const STATUS_TOOL = "toolbelt_connection_status";
const statusTool = () => ({
  name: STATUS_TOOL,
  description:
    `⚠️ Could not load tools from Toolbelt: ${lastUpstreamError || "unknown error"} — ` +
    `endpoint ${MCP_URL}. Call this tool to retry and see details. ` +
    `Common causes: wrong workspace ID, invalid API key, Toolbelt unreachable.`,
  inputSchema: { type: "object", properties: {} },
});

const personaTool = () => ({
  name: PERSONA_TOOL,
  description:
    `Load the live operating instructions (persona) of the "${NAME || "Toolbelt"}" assistant from Toolbelt. ` +
    `Call this when asked to act as the assistant, then fully adopt the returned instructions for the conversation.`,
  inputSchema: { type: "object", properties: {} },
});

// Tag forwarded tools with the agent's name — descriptions are the one signal every
// Claude client reads, so this is what routes "what's on my calendar?" to this agent.
const tagTools = (tools) =>
  NAME ? tools.map((t) => ({ ...t, description: `[${NAME}] ${t.description || ""}` })) : tools;

server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (needsSetup()) return { tools: [setupTool()] };
  if (toolsCache.tools && Date.now() - toolsCache.at < TOOLS_TTL_MS)
    return { tools: [personaTool(), ...tagTools(toolsCache.tools)] };
  try {
    const { tools = [] } = await withUpstream((c) => c.listTools());
    toolsCache = { tools, at: Date.now() };
    lastUpstreamError = "";
    return { tools: [personaTool(), ...tagTools(tools)] };
  } catch (e) {
    lastUpstreamError = e.message;
    log(`listTools failed: ${e.message}`);
    return { tools: [personaTool(), ...(toolsCache.tools?.length ? tagTools(toolsCache.tools) : [statusTool()])] };
  }
});

// tools/call → forward with a long timeout
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name === SETUP_TOOL) {
    const key = String(req.params.arguments?.api_key || "").trim();
    if (!key) return { isError: true, content: [{ type: "text", text: "No api_key provided." }] };
    try {
      mkdirSync(dirname(KEY_FILE), { recursive: true, mode: 0o700 });
      writeFileSync(KEY_FILE, key + "\n", { mode: 0o600 });
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Could not save key file: ${e.message}` }] };
    }
    API_KEY = key;
    try {
      const { tools = [] } = await withUpstream((c) => c.listTools());
      toolsCache = { tools, at: Date.now() };
      return { content: [{ type: "text", text: `Key saved to ${KEY_FILE} and verified — ${tools.length} tools available. Tell the user to reload/toggle the connector so the full tool list appears.` }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text", text: `Key saved to ${KEY_FILE}, but Toolbelt rejected it or is unreachable: ${e.message}` }] };
    }
  }
  if (needsSetup())
    return { isError: true, content: [{ type: "text", text: `Setup required: call ${SETUP_TOOL} with the user's Toolbelt API key first.` }] };
  if (req.params.name === PERSONA_TOOL) {
    personaCache = { text: null, at: 0 }; // always re-fetch live
    personaLoaded = true;
    const p = await fetchPersona();
    return p
      ? { content: [{ type: "text", text: personaMessage(p) }] }
      : { isError: true, content: [{ type: "text", text: `Could not fetch live instructions: ${lastUpstreamError || "Toolbelt unreachable"}. Retry, or check the connection with ${STATUS_TOOL}.` }] };
  }
  if (req.params.name === STATUS_TOOL) {
    try {
      const { tools = [] } = await withUpstream((c) => c.listTools());
      toolsCache = { tools, at: Date.now() };
      lastUpstreamError = "";
      return { content: [{ type: "text", text: `Connected. ${tools.length} tools available — reload/toggle this connector to refresh the tool list.` }] };
    } catch (e) {
      lastUpstreamError = e.message;
      return { isError: true, content: [{ type: "text", text: `Still failing: ${e.message}\nEndpoint: ${MCP_URL}\nCheck the workspace ID and API key in the extension settings.` }] };
    }
  }
  try {
    const res = await withUpstream((c) =>
      c.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} }, undefined, CALL_OPTS),
    );
    // Until the agent's persona is loaded, nudge: each agent has its own skills,
    // knowledge, and context — Claude should load it before doing real work as it.
    if (!personaLoaded && Array.isArray(res?.content)) {
      res.content = [
        ...res.content,
        {
          type: "text",
          text: `[note] You have not loaded ${NAME || "this agent"}'s operating context yet. Call ${PERSONA_TOOL} to get its current instructions, skills, and knowledge before continuing to act as it.`,
        },
      ];
    }
    return res;
  } catch (e) {
    return { isError: true, content: [{ type: "text", text: `Toolbelt error: ${e.message}` }] };
  }
});

// prompts/list → [persona, ...upstream]
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  const persona = {
    name: PROMPT_NAME,
    title: `Act as ${NAME || "the Toolbelt assistant"}`,
    description: `Act as the "${NAME || "Toolbelt"}" assistant — loads its current instructions live from Toolbelt.`,
  };
  let up = [];
  try {
    up = (await withUpstream((c) => c.listPrompts())).prompts ?? [];
  } catch { /* upstream may not expose prompts */ }
  return { prompts: [persona, ...up.filter((p) => p.name !== PROMPT_NAME)] };
});

// prompts/get → persona (live fetch) or forward
server.setRequestHandler(GetPromptRequestSchema, async (req) => {
  if (req.params.name === PROMPT_NAME) {
    // Must return EXACTLY the manifest-declared template — Desktop rejects anything else.
    return {
      description: `Act as ${NAME || "the Toolbelt assistant"}`,
      messages: [{ role: "user", content: { type: "text", text: PROMPT_TEXT } }],
    };
  }
  return withUpstream((c) => c.getPrompt({ name: req.params.name, arguments: req.params.arguments ?? {} }));
});

await server.connect(new StdioServerTransport());
log(`toolbelt-assistant ${VERSION} ready on stdio · upstream ${MCP_URL} · prompt ${PROMPT_NAME}`);

// Background warm-up (after handshake): cache tools + persona so first use is snappy.
setTimeout(() => {
  fetchPersona().catch(() => {});
}, 250);
