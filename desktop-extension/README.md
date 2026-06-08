# Toolbelt — Claude Desktop Extension (.mcpb)

A native **Claude Desktop** install for the Toolbelt router. Stores your API key in the **OS keychain**,
sends it as an `Authorization: Bearer` header (never in a URL), and **carries the router behavior itself**
so there's nothing to paste.

## How it works — a thin local bridge (`bridge.js`)
Desktop Extensions run a **local stdio** server; there's no remote-HTTP server type. So `bridge.js` is a
small MCP server (on `@modelcontextprotocol/sdk`) that connects *out* to the remote Toolbelt MCP endpoint
and proxies traffic, adding:

```
Claude Desktop ──stdio──> bridge.js ──HTTPS + Bearer──> toolbelt.apexti.com/api/workspaces/<id>/mcp
   │  one ask_<agent> tool per org assistant, recent-first (toggle on/off; delegate→wait handled inside)
   │  check_agent_result (poll a long job by correlationId) · read_storage_file (Model Auto-Pilot rules)
   │  toolbelt + toolbelt_help kept for ad-hoc org management (manage_delegations + the rest hidden)
   │  progress notifications while waiting · auto-reconnect if the session drops · tools/list_changed
   │  bundled `toolbelt` prompt (>>toolbelt) + server `instructions` (Code/VS Code honor; Desktop ignores)
```

1. **Per-agent tools (recent-first).** At connect, the bridge calls `list_assistants`, sorts by last
   activity, and surfaces **all** agents as `ask_<name>` tools — toggle individual agents on/off in
   Settings → Extensions. `ask_<agent>({ task, model? })` runs `create → wait` internally, emits **progress
   notifications** while waiting (so long jobs don't time out), and returns the answer. If it's still
   running, it hands back a `correlationId` for **`check_agent_result`**.
2. **Curated, but management stays available.** Exposed: the `ask_<agent>` tools, `check_agent_result`,
   `read_storage_file`, and `toolbelt`/`toolbelt_help` (ad-hoc org management). `manage_delegations`,
   storage writes, `duckdb_*`, `wrench_*`, service tools, and connection/workflow setup are hidden.
3. **Resilient.** Auto-reconnects if the upstream session drops (retry-once); refreshes the roster every
   few minutes and emits `tools/list_changed` when agents are added/removed; clear message on a 401.
4. **Org name.** Optional `Org name` field at install; if blank the bridge learns it from
   `list_organizations`. Used so Claude refers to your org by name.

## Install (single-file .mcpb — recommended)
```bash
npm install                  # vendor the SDK into node_modules/
npx @anthropic-ai/mcpb pack  # → desktop-extension.mcpb
```
Then Claude Desktop → **Settings → Extensions → Install Extension** → pick the `.mcpb` → enter org name
(optional), hub workspace ID, and API key. Each agent then appears as an `ask_<name>` tool you can toggle.

## Per-org branded build (names it in the Settings list)
Claude's Settings-list label is the manifest `display_name` (static per build). To get a per-org name
there, build a branded copy:
```bash
node pack-org.mjs --org "Acme Corp" --workspace <hub-workspace-id>   # → acme-corp.mcpb
```
- Stamps `display_name` → **"Toolbelt — Acme Corp"** (shows named in Settings).
- Bakes the org name and (with `--workspace`) the workspace ID, so the user only enters their **API key**.
- Restores the base `manifest.json` afterward. Omit `--workspace` to keep that field at install.

## Status (v0.10)
- **Verified locally:** downstream handshake, bundled prompt, graceful upstream failure; the roster
  transform against real org data (recent-first ordering, slug names, collision handling); the
  session/auth error classifiers; packaging (`.mcpbignore` excludes `pack-org.mjs`/README; icon + node
  compatibility in the manifest).
- **Needs a live test (your key):** the delegation round-trip (`create → wait → responseContent`),
  `check_agent_result`, progress-notification rendering, and reconnect after a real session drop. Watch
  `[toolbelt-bridge]` logs; if the roster can't be parsed it falls back to the core tools (still usable).
