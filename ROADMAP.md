# Roadmap — Toolbelt for Claude

Status of the Claude ↔ Toolbelt integration and what's next, in priority order. The
integration is in production: agents connect by URL (OAuth gateway) or by `.mcpb`, the
agent's brain stays live in Toolbelt, and IT/Security's server-side tool policy is
enforced inside Claude.

## Recently shipped

- **OAuth gateway** — real MCP OAuth (discovery, DCR, PKCE/S256, sealed stateless tokens)
  over Toolbelt with zero Toolbelt source changes. Connect = "Add connector → paste URL →
  sign in." Works in Desktop, Cowork, and claude.ai web.
- **Gateway hardened & brought to parity with the local proxy:**
  - `structuredContent` → readable text (no more empty "no output" tool results).
  - Org-policy **"ask"** gate surfaced as a clear **🔒 APPROVAL REQUIRED** prompt with the
    confirmation ID, for both JSON and SSE responses (streaming preserved).
  - CORS preflight (`OPTIONS`) + exposed MCP headers for claude.ai web.
  - Sign-in key no longer echoed into the page on a retry; key-validation `fetch` now has a
    5s timeout so a slow Toolbelt can't hang the Connect click.
- **Tests:** gateway suite now covers discovery, DCR, PKCE, token/refresh, real-key
  forwarding, tamper + **expiry** rejection, the two parity transforms (through the SSE
  rewriter), CORS preflight, unregistered-`redirect_uri` rejection, and key-not-echoed. 15
  checks, green.
- **Build pipeline:** `dist/` re-synced with build output (`sync-dist.mjs` added so a
  single-agent `build-offline.mjs` can refresh the committed installers without a full
  packager run); skills + docs lead with the gateway URL; `packager/server.js` verified
  byte-identical to the shipped proxy.

## P0 — close the last friction gap

- **True keyless connect (no API key paste).** Today the user still pastes a Toolbelt key
  once on the gateway sign-in page. Two ways to remove that:
  1. **Gateway + Toolbelt session bridge (smaller):** add a non-destructive
     `GET /api/my-api-key` (or short-lived token mint) endpoint in Toolbelt, host the
     gateway on `connect.apexti.com`, share the cookie domain, and have the gateway's
     authorize step read the logged-in Toolbelt session instead of prompting. Result: "sign
     in to Toolbelt → Approve → done."  *(Note: existing `regenerateApiKey` is destructive —
     do not reuse it; this needs a read-only endpoint.)*
  2. **Native Toolbelt OAuth (larger, best end-state):** Toolbelt becomes its own
     authorization server; retire the gateway's key page entirely. Nothing changes for end
     users — they already see an OAuth sign-in.
  Recommendation: ship (1) now, plan (2).

## P1 — operational hardening

- **Custom domain + warm instance.** Point `connect.apexti.com` at the gateway (one CNAME,
  set `PUBLIC_URL`), and run Render **Starter** ($7/mo) so it stays warm (free tier
  cold-starts ~50s and makes first connect feel slow). Prereq for P0 option 1.
- **Pin `GATEWAY_SECRET`.** `render.yaml` persists a generated secret; confirm it's pinned
  in the live service so redeploys don't silently log everyone out.
- **Per-user token revocation.** Today revocation is all-or-nothing (rotate
  `GATEWAY_SECRET`) or per-user via rotating their Toolbelt key. If finer control is needed,
  add a small revocation list (token `jti` + a tiny store) — gives up "fully stateless" but
  enables targeted revoke.
- **Rate-limit the `/oauth/*` endpoints** and add structured request logging/metrics to the
  gateway (currently `/health` + stderr only).

## P1.5 — auto-routing (stronger, server-side)

The gateway now injects identity + a "use me, call load_persona first" nudge into the
`initialize` instructions, and the routing skills are connector-agnostic (recognize both
the gateway's unprefixed tools and the `.mcpb`'s prefixed ones). Two further options if
hands-free routing still needs to be stronger *without* installing the skill:

- **Per-agent triggers in the gateway.** Ship a small `workspace_id → {name, triggers}`
  map alongside the gateway (generated from `assistants.json`) so the `initialize`
  instructions name the agent's actual trigger phrases — server-side routing as strong as
  the skill, no plugin needed. Cost: redeploy the gateway when the roster changes.
- **Synthetic "★ START HERE" entry tool** in the gateway's `tools/list` (mirrors the
  `.mcpb` proxy), with the gateway intercepting calls to it. Strong nudge, but adds a tool
  and a small amount of call-handling state to the otherwise pass-through gateway.

## P2 — drift prevention & coverage

- **CI checks** in this repo: (a) fail if `packager/server.js` ≠ `toolbelt-assistant-mcpb/
  server/index.js`; (b) fail if `dist/` is stale vs `dist-bundles/`; (c) run the gateway
  test suite. Removes the two manual "keep in sync" footguns.
- **Auto-sync on build.** Have `build-offline.mjs` invoke `sync-dist.mjs` (or document the
  two-step) so a one-off build never leaves `dist/` behind again.
- **Proxy ↔ gateway parity guard.** Both apply the same response transforms today; factor
  the transform into one shared module (or a parity test) so a future proxy change can't
  silently regress the gateway path.
- **More tests:** local `.mcpb` proxy integration test in CI; JSON-RPC batch responses
  through the gateway; SSE chunk-boundary fuzz (multi-byte split mid-event).
- **Verify the web (CORS) path in production** against a real browser-side connect, to
  confirm the preflight handling is actually exercised (or document that Anthropic calls
  remote MCP server-side and CORS is belt-and-suspenders).

## Backlog / decisions

- **Publish Mito & Genie?** Both have built connectors (`dist/mito.mcpb`, `dist/genie.mcpb`)
  but are **not** in the build roster (`assistants.json`), so they have no marketplace
  plugin/skill and don't appear in the marketplace. To publish either: add a roster entry
  (name, `workspace_id`, one-line description, trigger phrases) and rebuild. Until then they
  install only by direct URL/`.mcpb`.
- **`toolbelt-get-started` onboarding plugin** stays connector-agnostic (single org-wide
  connection); revisit whether it should also offer a gateway URL.
- **When Toolbelt ships native OAuth**, delete the gateway key page; keep the gateway only
  if still needed for namespacing-free remote connect, otherwise retire it.
