# Apexti Toolbelt — Claude marketplace

A one-plugin marketplace that connects a fresh Claude to a governed **Toolbelt** org with a
friendly first-run. It ships the **`toolbelt`** plugin, whose `/toolbelt:get-started` flow forks
by who you are — a new operator (genesis), a returning operator with assistants, or an end-user
joining the org an operator already built for them (consumer).

In this first release the onboarding logic runs against a **self-contained local stub** (no login,
no backend) so you can feel the experience in a clean Claude instance. See
[`REAL-CONNECTOR.md`](./REAL-CONNECTOR.md) to point it at live Toolbelt.

## Install in a fresh Claude

Requires Node.js on the machine (the stub MCP server runs locally).

```text
/plugin marketplace add YOUR_GITHUB_USERNAME/toolbelt-claude-marketplace
/plugin install toolbelt@apexti-toolbelt
/toolbelt:get-started
```

Then walk the paths:

- **Genesis** (new operator): pick `genesis` → it provisions a starter org, connects Gmail, runs a
  Meeting-Prep playbook, schedules a weekly branded report.
- **Returning** (operator with assistants): pick `returning` → it discovers your assistants and wires
  the report.
- **Consumer** (operator's customer): simulate the branded install with an invite —
  install, then say "set up Toolbelt with invite sterling-org-7f3a" — and you're bound to the
  operator's org with nothing to configure.

Run `/reload-plugins` after any local edits.

## What's inside

```
.claude-plugin/marketplace.json          # the marketplace catalog
plugins/toolbelt-get-started/            # the plugin
  ├── .claude-plugin/plugin.json
  ├── .mcp.json                          # → local stub today; remote Toolbelt for production
  ├── skills/get-started/SKILL.md        # /toolbelt:get-started
  ├── agents/onboarding-guide.md
  ├── servers/onboard-stub.mjs           # zero-dependency stub of the onboard() state machine
  └── examples/sterling-marketplace.json # the branded operator catalog the generator emits
```

## Roadmap

1. **Stub marketplace** (this repo) — feel the first-run in a clean instance. ✅
2. **Live connector** — point `.mcp.json` at `https://toolbelt.apexti.com/mcp`; onboarding orchestrates
   the real Toolbelt actions (`create_assistant`, `get_service_connect_url`, `enable_service`, …),
   already verified working. See `REAL-CONNECTOR.md`.
3. **Real `onboard` endpoint** — move the logic server-side so the plugin stays thin and the same flow
   re-emits for ChatGPT/Gemini. See the onboard endpoint spec.
4. **Marketplace generator** — auto-emit per-operator branded catalogs (Sterling's own marketplace).
