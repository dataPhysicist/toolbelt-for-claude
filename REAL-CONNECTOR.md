# (Superseded) Switching from the stub to live Toolbelt

> **This doc described an earlier onboarding-stub design and is kept only for its findings.**
> The plugin is now a **router**: it connects directly to the live **per-workspace** Toolbelt MCP
> endpoint and applies the router skill — there is no stub or `onboard` tool in the product path.
> For how to connect today, see the README's
> [Two ways to connect](./README.md#two-ways-to-connect-toolbelt-agents-to-claude) and
> [`DESKTOP.md`](./DESKTOP.md). The current connector is per-workspace with Bearer auth:
> `POST https://toolbelt.apexti.com/api/workspaces/<WORKSPACE_ID>/mcp` + `Authorization: Bearer <key>`
> (note: **not** the old `…/mcp` URL this doc used to reference).

## Still-relevant findings from the June 5 live test

These server-side observations against the live Toolbelt MCP remain useful; the full, evidence-backed
version lives in the Toolbelt repo at `docs/claude-integration-findings.md`:

- `create_assistant`, `get_service_connect_url`, and `enable_service` all work and **accept an
  `assistantId`**, so you can provision and wire a brand-new assistant.
- **Gap — no `delete_assistant` action.** Clean teardown/undo of a provisioned assistant isn't possible
  over MCP today.
- **Gap — `create_scheduled_task` / `create_dashboard_page` are scoped to the connection's current
  assistant** (no `assistantId` param), so attaching a report/schedule to a *newly created* assistant
  needs `assistantId` targeting.
