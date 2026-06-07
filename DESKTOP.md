# Running the Toolbelt plugin in the Claude **desktop app**

Lead with the **marketplace** — that's the real product path and what an operator's customers will use.
Connector + Project is a break-glass fallback only.

## You need
- The exact **Toolbelt remote MCP URL** from Toolbelt's "Connect to Claude / MCP" settings (the plugin
  currently points at `https://toolbelt.apexti.com/mcp` — verify/replace and re-push if it differs).
- A Toolbelt account to authorize on first connect.

## Route 1 — Install from your marketplace (preferred)
1. Desktop app → **Settings → Plugins** (plugin manager) → **Add marketplace** →
   `YOUR_GITHUB_USERNAME/toolbelt-claude-marketplace`.
2. Install the **toolbelt** plugin → **authorize** the Toolbelt connector when prompted (this is where
   your org is established).
3. Start the flow: say **"connect Toolbelt"** or run **`/toolbelt:get-started`**. It lists your org's
   agents and delegates your requests to them.

> If your desktop build doesn't expose **custom** marketplaces (it can be plan/admin-gated — Team &
> Enterprise admins manage private marketplaces), either run the marketplace in **Claude Code** (where
> `/plugin marketplace add` always works for any user) or use Route 2 below.

## Route 2 — Custom connector + Project (break-glass fallback only)
Use only if you can't add the marketplace on your desktop build.
1. Settings → **Connectors → Add custom connector** → paste the Toolbelt MCP URL → **Authorize**.
2. Create a **Project** and paste the body of
   `plugins/toolbelt-get-started/skills/get-started/SKILL.md` into its custom instructions.
3. Say **"connect Toolbelt"** → same connect → list agents → delegate experience.

## Guaranteed marketplace path (any user) — Claude Code
```text
/plugin marketplace add YOUR_GITHUB_USERNAME/toolbelt-claude-marketplace
/plugin install toolbelt@apexti-toolbelt
/toolbelt:get-started
```

## Note on "fresh instance"
A connector/plugin is account-level. The cleanest "new user" test is a **Project** you haven't used
before (or a separate Claude profile), so the org's agent roster is the only context in the room.
