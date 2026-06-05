# Toolbelt — Getting Started plugin (P0)

A thin Claude plugin whose only job is to connect a fresh Claude to a governed **Toolbelt**
org and run a friendly first-run. All the brains live server-side in the `onboard` tool —
this plugin just renders the cards the server returns. In **P0** that server is a
zero-dependency local **stub** so you can feel the experience without touching Toolbelt source.

## What's inside

```
toolbelt-get-started/
├── .claude-plugin/plugin.json     # manifest (namespace: /toolbelt:…)
├── .mcp.json                      # points Claude at the onboard server (stub in P0)
├── skills/get-started/SKILL.md    # /toolbelt:get-started — the entry point
├── agents/onboarding-guide.md     # optional focused sub-agent runner
├── servers/onboard-stub.mjs       # zero-dep MCP stub of the onboard() state machine
├── examples/sterling-marketplace.json  # branded operator catalog (State C demo)
└── README.md
```

## Try it locally (no install)

```bash
# from the folder that contains toolbelt-get-started/
claude --plugin-dir ./toolbelt-get-started
# in Claude:
/toolbelt:get-started
```

Walk the three persona paths:

- **Genesis** (new operator): at the first card pick `genesis` → it provisions a starter
  org, connects Gmail, runs a playbook, schedules the report.
- **Returning** (operator with assistants): pick `returning` → it discovers your assistants
  and wires the report.
- **Consumer** (Sterling's customer): simulate the branded install by setting the invite —
  `TOOLBELT_INVITE=sterling-org-7f3a claude --plugin-dir ./toolbelt-get-started` — then run
  `/toolbelt:get-started`. It binds you to Sterling's org with no building.

Run `/reload-plugins` after edits to pick up changes.

## Try the install path (local marketplace)

```text
/plugin marketplace add /absolute/path/to/toolbelt-marketplace-local.json
/plugin install toolbelt@toolbelt-local
```

## Going to production (P1+)

Swap the stub for the real endpoint by editing `.mcp.json` to the remote Toolbelt MCP server:

```json
{ "mcpServers": { "toolbelt": { "url": "https://toolbelt.apexti.com/mcp", "transport": "http" } } }
```

Then implement `onboard` in Toolbelt over the existing primitives (`create_assistant`,
`enable_service`, `get_service_connect_url`, `wrench_execute`, `create_dashboard_page`, …).
The client does **not** change — only the server. See the Getting-Started plan doc for the
`onboard` contract, the source enhancements (inline signup OAuth, invite-bound OAuth, starter
templates), phasing, and the time-to-value metric.

## Notes & caveats

- The stub asks "genesis or returning?" because it can't authenticate you. The **real** server
  auto-detects persona from your Toolbelt role + inventory; drop that card in production.
- `.mcp.json` is intentionally minimal. Avoid putting secrets here; real auth is the remote
  server's OAuth handshake.
- Keep onboarding tools pre-allowed so users don't face repeated "approve tool?" prompts.
