#!/usr/bin/env node
/**
 * onboard-stub.mjs — a zero-dependency stub of Toolbelt's `onboard` MCP tool.
 *
 * PURPOSE (P0): let us feel the getting-started first-run inside real Claude
 * WITHOUT touching Toolbelt source. It speaks newline-delimited JSON-RPC 2.0
 * over stdio (the MCP stdio transport) and implements one tool, `onboard`,
 * as a server-driven state machine returning "setup cards".
 *
 * The real server replaces this with logic over the live Toolbelt primitives
 * (create_assistant, enable_service, get_service_connect_url, wrench_execute,
 * create_dashboard_page, ...). The CLIENT does not change — only this endpoint.
 *
 * Stub-only shortcuts (clearly marked): persona is chosen via an explicit
 * "pick-persona" card or via an `invite` (arg or TOOLBELT_INVITE env). The real
 * server auto-detects persona from the authenticated user's role + inventory.
 */

const SERVER_INFO = { name: "toolbelt-onboard-stub", version: "0.1.0" };

// ---- card helpers -----------------------------------------------------------
const org = (name, role) => ({ id: "stub-org", name, role });
const card = (id, title, body, extra = {}) => ({ id, title, body, ...extra });
const resp = (persona, organization, cards, done, summary) => ({
  persona, org: organization, cards, done: !!done, ...(summary ? { summary } : {}),
});
const finish = (persona, organization, summary) => resp(persona, organization, [], true, summary);

// ---- the onboarding state machine (stub) ------------------------------------
function onboard(args = {}) {
  const invite = args.invite || process.env.TOOLBELT_INVITE || null;
  const step = args.step || "";
  const choice = args.choice || {};

  // ===== CONSUMER (State C): arrived via an operator's branded plugin =====
  if (invite) {
    if (!step || step === "consumer-start") {
      return resp("consumer", org("Sterling IT", "member"), [
        card("welcome-consumer", "Joining your team's AI workspace",
          "Welcome — you're joining the AI workspace Sterling set up for your company. " +
          "I'm connecting you to your team's governed assistant now…",
          { next: "confirm-services" }),
      ], false);
    }
    if (step === "confirm-services") {
      return resp("consumer", org("Sterling IT", "member"), [
        card("ready", "You're all set",
          "You're in. Your Claude now knows your company's business through Sterling's governed org — " +
          "shared memory, guardrails, and a weekly report, all managed by Sterling. " +
          'Try: "prep me for my next meeting."',
          { next: "finish" }),
      ], false);
    }
    if (step === "finish") {
      return finish("consumer", org("Sterling IT", "member"),
        "Connected to Sterling IT as a team member. Your Claude is business-aware and governed by Sterling — nothing to configure.");
    }
  }

  // ===== OPERATOR paths (no invite) =====
  if (!step) {
    // The REAL server auto-detects genesis vs returning. The stub asks.
    return resp(null, null, [
      card("pick-persona", "Let's get you set up",
        "(Stub note: the real server detects this automatically from your Toolbelt account.) " +
        "Are you setting up a brand-new Toolbelt workspace, or do you already have assistants in Toolbelt?",
        { action: { kind: "pick_one", options: ["genesis", "returning"] }, next: "route" }),
    ], false);
  }

  if (step === "route") {
    const persona = choice.persona === "returning" ? "returning" : "genesis";

    if (persona === "returning") {
      // ===== State B: operator already has assistants =====
      return resp("returning", org("Sterling IT", "owner"), [
        card("discovered", "Found your workspace",
          'I found your org "Sterling IT" with 3 assistants — Chief-of-Staff, Pipeline-Hygiene, ' +
          "and Meeting-Prep. They're now callable right here in Claude. " +
          "Want me to wire up your weekly branded report?",
          { action: { kind: "confirm" }, next: "report" }),
      ], false);
    }

    // ===== State A: genesis — provision the first org =====
    return resp("genesis", org("Sterling IT (Starter)", "owner"), [
      card("connect-service", "Workspace created",
        'Done — I\'ve created your governed org "Sterling IT (Starter)" with a Chief-of-Staff ' +
        "assistant and sensible guardrails. Let's connect Gmail so it can see your world.",
        { action: { kind: "open_url", url: "https://toolbelt.apexti.com/connect/gmail?demo=1" }, next: "service-connected" }),
    ], false);
  }

  // ----- genesis continued -----
  if (step === "service-connected") {
    return resp("genesis", org("Sterling IT (Starter)", "owner"), [
      card("run-playbook", "Gmail connected",
        "Gmail connected. Running your first playbook — Meeting Prep for tomorrow's calendar…",
        { next: "playbook-done" }),
    ], false);
  }
  if (step === "playbook-done") {
    return resp("genesis", org("Sterling IT (Starter)", "owner"), [
      card("report", "Your first brief is ready",
        "Here's your meeting brief. I've also stood up a weekly branded report " +
        "(Sterling-branded, role-sliced for leadership / IT / security / finance) delivered Mondays at 7am.",
        { next: "finish" }),
    ], false);
  }
  if (step === "finish") {
    return finish("genesis", org("Sterling IT (Starter)", "owner"),
      "Your Claude is now connected to Sterling IT (Starter): 1 governed assistant, Gmail connected, " +
      "Meeting-Prep playbook live, weekly report scheduled. Add the next playbook anytime by saying \"add a playbook.\"");
  }

  // ----- returning continued -----
  if (step === "report") {
    return finish("returning", org("Sterling IT", "owner"),
      "Connected to Sterling IT — 3 assistants now callable in Claude, weekly branded report scheduled. " +
      "Everything stays governed and metered in Toolbelt.");
  }

  // fallback
  return resp(null, null, [
    card("restart", "Let's restart", 'I lost the thread — say "set up Toolbelt" to start over.', { next: "" }),
  ], false);
}

// ---- the onboard tool definition -------------------------------------------
const ONBOARD_TOOL = {
  name: "onboard",
  description:
    "Drive the Toolbelt getting-started flow. Call with NO arguments to begin. Returns the next " +
    "setup card(s); to advance, call again with `step` set to the previous card's `next` value and " +
    "`choice` set to the user's answer. Stop when `done` is true and read back `summary`.",
  inputSchema: {
    type: "object",
    properties: {
      invite: { type: "string", description: "Operator org/invite ref (present in branded plugins; routes to the consumer flow)." },
      step: { type: "string", description: "The step id to advance, taken from the previous card's `next`. Omit on the first call." },
      choice: { type: "object", description: "The user's answer to the previous card, e.g. {\"persona\":\"genesis\"} or {\"confirm\":true}.", additionalProperties: true },
    },
  },
};

// ---- minimal MCP stdio JSON-RPC server -------------------------------------
function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyErr(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case "notifications/initialized":
    case "initialized":
      return; // notification, no reply
    case "ping":
      return isRequest && reply(id, {});
    case "tools/list":
      return reply(id, { tools: [ONBOARD_TOOL] });
    case "tools/call": {
      const name = params && params.name;
      const argz = (params && params.arguments) || {};
      if (name !== "onboard") return replyErr(id, -32602, `Unknown tool: ${name}`);
      const result = onboard(argz);
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      });
    }
    default:
      if (isRequest) return replyErr(id, -32601, `Method not found: ${method}`);
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)); }
    catch (e) { /* ignore malformed lines */ }
  }
});
process.stdin.on("end", () => process.exit(0));
