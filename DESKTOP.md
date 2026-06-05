# Running the Toolbelt first-run in the Claude **desktop app**

This version uses a **remote** Toolbelt connector (OAuth, no local process), so it works in the
desktop app — unlike the original local-stub build, which needed Node.

## You need
- The exact **Toolbelt remote MCP URL** (and whether it's OAuth or token), copied from Toolbelt's
  "Connect to Claude / MCP" settings. The plugin currently points at
  `https://toolbelt.apexti.com/mcp` — **verify and replace this if your endpoint differs**, then
  re-push the repo.
- A Toolbelt account to authorize on first connect.

## Route A — Custom connector + Project instructions (most reliable for an individual)
1. Desktop app → **Settings → Connectors → Add custom connector**.
2. Paste the Toolbelt remote MCP URL → **Authorize** (sign in to Toolbelt). The Toolbelt tools
   (`list_assistants`, `create_assistant`, `get_service_connect_url`, …) are now available in chat.
3. Create a **Project**, and paste the contents of
   `plugins/toolbelt-get-started/skills/get-started/SKILL.md` (everything below the front-matter)
   into the Project's **custom instructions**.
4. In that Project, say **"set up Toolbelt"** → the guided genesis/returning/consumer flow runs
   against live Toolbelt.

## Route B — Install the plugin (if your desktop has plugin/marketplace support)
Plugin + marketplace support reached Cowork in 2026; availability of *custom* marketplaces may depend
on your plan / admin settings (Team & Enterprise admins can add private marketplaces).
1. Desktop app → **Settings → Plugins** (or the plugin manager) → **Add marketplace** →
   `YOUR_GITHUB_USERNAME/toolbelt-claude-marketplace`.
2. Install the **toolbelt** plugin → authorize the Toolbelt connector when prompted.
3. Start the flow with the **get-started** skill (e.g. `/toolbelt:get-started`, or say "set up Toolbelt").

> If your desktop build doesn't expose custom marketplaces, use Route A — it delivers the same
> experience without depending on plugin-marketplace availability.

## Note on "fresh instance"
Because a connector + Project is account-level, the cleanest "new user" test is a Project you haven't
used before (or a separate Claude profile). The genesis path will create a real starter assistant in
your Toolbelt org — name it clearly (e.g. prefix `ZZ-`) so it's easy to remove afterward.
