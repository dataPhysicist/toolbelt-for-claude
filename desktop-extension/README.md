# Toolbelt — Claude Desktop Extension (.mcpb)

A native **Claude Desktop** install for the Toolbelt router. Stores your API key in the **OS keychain**,
sends it as an `Authorization: Bearer` header (never in a URL), and **carries the router behavior itself**
so there's (almost) nothing to paste.

## How it works — a thin local bridge (`bridge.js`)
Desktop Extensions run a **local stdio** server; there's no remote-HTTP server type. So `bridge.js` is a
small MCP server (built on `@modelcontextprotocol/sdk`) that connects *out* to the remote Toolbelt MCP
endpoint and proxies traffic, while adding three things on top:

```
Claude Desktop ──stdio──> bridge.js ──HTTPS + Bearer──> toolbelt.apexti.com/api/workspaces/<id>/mcp
                           │  rewrites tool descriptions (manage_delegations → wait/correlationId)
                           │  serves a bundled `toolbelt` prompt (>>toolbelt) = full router guidance
                           └  sets server `instructions` (honored by Claude Code/VS Code; Desktop ignores)
```

1. **Tool-description rewrite (automatic, every client).** On `tools/list`, the bridge rewrites
   `manage_delegations` so the model retrieves results with `wait`/`status` by `correlationId` instead of
   the built-in `sleep`/`get_pending_sub_chats` that fail for an external client. This is the key fix and
   needs no user action. See `TOOL_OVERRIDES` in `bridge.js`.
2. **Bundled prompt.** `>>toolbelt` (or the prompt menu) inserts the full router guidance from
   `router-instructions.md` — replaces pasting a skill file into a Project.
3. **Server `instructions`.** Best-effort hint; injected by clients that support it. *Verified: Claude
   Desktop does **not** inject it* (see the probe in `../experiments/instructions-probe/`), which is why
   #1 and #2 carry the behavior instead.

## Install (unpacked — for testing today)
`node_modules/` (the SDK) must be present.
1. `cd desktop-extension && npm install`
2. Claude Desktop → **Settings → Extensions → Extension Developer → Install Unpacked Extension** →
   select this folder. (Folder picker greys out files — select the **folder**, or package a `.mcpb` and
   use **Install Extension**; see below.)
3. Enter your **hub workspace ID** and **API key** when prompted.
4. Say **"connect Toolbelt"** (or run `>>toolbelt` first to load the full guidance).

## Package (.mcpb — for distribution / a clean Install Extension flow)
```bash
npm install            # vendor the SDK into node_modules/
npx @anthropic-ai/mcpb pack   # → toolbelt-0.7.0.mcpb (bundles node_modules)
```
Distribute the `.mcpb`; users install via **Settings → Extensions → Install Extension** (single file → a
normal Open button).

## Status
- Verified locally: bridge starts, serves `instructions` + the `toolbelt` prompt, and fails gracefully
  when the upstream is unreachable.
- **Needs a live test:** upstream proxying + the `manage_delegations` rewrite against a real Toolbelt
  endpoint with your key. Watch the extension logs on first `list_assistants` / delegation.
