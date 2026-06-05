# Switching from the stub to live Toolbelt

The stub lets you feel the UX with no login. To make `/toolbelt:get-started` act against a real
Toolbelt org, two things change — the connector and the skill.

## 1. Point the plugin at the remote Toolbelt MCP

Replace `plugins/toolbelt-get-started/.mcp.json` with the remote server (Claude runs OAuth on first
connect):

```json
{
  "mcpServers": {
    "toolbelt": {
      "url": "https://toolbelt.apexti.com/mcp",
      "transport": "http"
    }
  }
}
```

> Confirm the exact MCP URL + auth from your Toolbelt "Connect to Claude / MCP" settings — copy it
> verbatim rather than assuming. Some deployments require a token or a per-user OAuth handshake.

## 2. Make the skill orchestrate real actions (until the `onboard` endpoint exists)

The stub exposes a single `onboard` tool. The live Toolbelt MCP instead exposes `toolbelt_help` and
the `toolbelt` action dispatcher. Two options:

- **Thick skill (works today):** rewrite `skills/get-started/SKILL.md` to drive the genesis sequence
  directly with the real actions. **This exact sequence is already verified live:**

  | Step | Action | Notes |
  |---|---|---|
  | 1 | `create_assistant` | name, `provider:"anthropic"`, `model:"claude-sonnet-4-6"`, starter systemPrompt → returns `assistantId` |
  | 2 | `get_service_connect_url` | `{ serviceId, assistantId }` → popup URL; returns `autoEnableOnConnect`, `alreadyConnected`, and an `enableAfterConnect` block |
  | 3 | `enable_service` | `{ serviceId, assistantId }` — **honors `assistantId`** even though help doesn't list it; enables the service on the new assistant |
  | 4 | `wrench_execute` | run a hero playbook (Meeting Prep) against the connected data |
  | 5 | `create_dashboard_page` + `create_scheduled_task` | the weekly branded report (see gaps below) |

- **Thin skill (preferred end state):** build the server-side `onboard` tool (see the onboard endpoint
  spec) and keep the current skill as-is.

## Verified findings from the live test (June 5, 2026)

- `create_assistant`, `get_service_connect_url`, and `enable_service` all work and **accept an
  `assistantId`**, so you can provision and wire a brand-new assistant.
- **Gap — no `delete_assistant` action.** Clean teardown/undo of a provisioned assistant isn't possible
  over MCP today; add one for a reversible onboarding lifecycle.
- **Gap — `create_scheduled_task` / `create_dashboard_page` are scoped to the connection's current
  assistant** (no `assistantId` param). To attach the report/schedule to a *newly created* assistant,
  either add `assistantId` targeting or have `onboard` run in that assistant's context.
- `get_service_connect_url` returns `alreadyConnected:true` when the org already has the service, so a
  returning operator skips the OAuth popup entirely.

These three are the concrete source changes that turn the thick-skill demo into the thin-client product.
