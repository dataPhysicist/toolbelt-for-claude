# Toolbelt — Claude Desktop Extension (.mcpb)

A native **Claude Desktop** install for the Toolbelt router. Unlike the custom-connector path, this
stores your API key in the **OS keychain**, prompts for your workspace ID + key at install, and never
puts the key in a URL.

## How it works
Desktop Extensions (MCPB) run a **local stdio** server — there is no remote-HTTP server type. So this
extension bundles [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), a tiny stdio↔HTTP bridge that
forwards Claude's MCP traffic to Toolbelt's remote endpoint and injects your key as an
`Authorization: Bearer` header. Your `manifest.json` declares two `user_config` fields; Desktop collects
them (the key marked `sensitive` → keychain) and substitutes them into the bridge's arguments at launch.

```
Claude Desktop  ──stdio──>  mcp-remote (local, bundled)  ──HTTPS + Bearer──>  toolbelt.apexti.com/.../mcp
```

## Install (unpacked — for testing today)
The `node_modules/` with the bundled bridge must be present (run `npm install` here if it isn't).

1. Claude Desktop → **Settings → Extensions → Extension Developer → Install Unpacked Extension**
2. Select this `desktop-extension/` folder.
3. When prompted, enter your **hub workspace ID** and **Toolbelt API key**.
4. Open a chat and say **"connect Toolbelt"** (pair with a Project that holds the routing instructions —
   see "Routing behavior" below).

## Package (.mcpb — for distribution)
To produce a single double-click installable file:
```bash
npm install            # vendor the bridge into node_modules/
npx @anthropic-ai/mcpb pack      # or: mcpb pack  — produces toolbelt.mcpb (bundles node_modules)
```
Share the resulting `toolbelt.mcpb`; users install it via **Settings → Extensions → Install Extension**.

## Routing behavior (important)
This extension provides the **tools** (`list_assistants`, `manage_delegations`, …) but does **not**
auto-apply the router skill. The delegation discipline — use `manage_delegations action:"create"` →
`action:"wait"` keyed by `correlationId`, and **not** `sleep`/`get_pending_sub_chats` (which need a chat
context an external client lacks) — lives in `../plugins/toolbelt-get-started/skills/get-started/SKILL.md`.
On Desktop, paste that file's body into a **Project's custom instructions** and use the extension inside
that Project. (A future version can bundle a custom proxy that exposes this as an MCP prompt.)

## Auth wiring note
The key is substituted directly into the `--header` argument via `${user_config.toolbelt_api_key}`. If a
future Desktop build exposes the launch argv and you'd rather keep the key out of it, switch to the
env-indirection form: put `"env": { "TOOLBELT_API_KEY": "${user_config.toolbelt_api_key}" }` in
`mcp_config` and change the header to `"Authorization: Bearer ${TOOLBELT_API_KEY}"` (mcp-remote expands
`${TOOLBELT_API_KEY}` from the environment).

## Versions
- Bundled `mcp-remote`: pinned by `package.json` (installed: 0.1.38).
- Manifest: `manifest_version` 0.3.
