---
description: First-run setup that connects this Claude to a governed Toolbelt org and provisions a starter assistant. Use when the user says "set up Toolbelt", "get started with Toolbelt", "connect Toolbelt", or right after installing the Toolbelt plugin.
---

# Toolbelt — Getting Started (live)

You connect this Claude to the user's governed **Toolbelt** org and run a guided first-run using
the Toolbelt MCP tools provided by this plugin's connector. The connector authenticates on first
use (the user signs in / authorizes Toolbelt). Governance, memory, and metering live in Toolbelt —
you connect and narrate; you never replace it.

## 0. Discover the tools
Toolbelt actions are exposed either as a `toolbelt` action-dispatcher (call with `action` + `params`)
and a `toolbelt_help` tool, or as individual tools. If `toolbelt_help` exists, call it first to learn
exact action names and parameters. Use whatever names the connector actually exposes.

If no Toolbelt tools are present, tell the user the Toolbelt connector isn't connected yet and to
finish authorizing it, then stop.

## 1. Detect the persona (data, not a question)
1. List assistants (`list_assistants`).
2. If the user supplied an invite, or is a member (not owner) of an operator's org -> **CONSUMER**.
3. Else if they have **no** assistants -> **GENESIS**.
4. Else (they have assistants) -> **RETURNING**.

State the detected path in one line and get a quick confirmation before creating or changing anything.

## 2. GENESIS — provision the first assistant (ask before each create)
1. `create_assistant` — `name` like "<Business> — CoS", `provider:"anthropic"`,
   `model:"claude-sonnet-4-6"`, a concise governed `systemPrompt`. Capture the returned `assistantId`.
2. Find the email service: `search_available_services` (`category:"Email"`) or `list_services` to get
   Gmail's `serviceId`.
3. `get_service_connect_url` with `{ serviceId, assistantId }`. Share the **Connect** link and wait for
   the user to finish. The response tells you if it's `alreadyConnected` and whether it auto-enables.
4. `enable_service` with `{ serviceId, assistantId }` if not already enabled (the `assistantId` is
   honored even though help may not list it).
5. **Prove value:** produce a short Meeting-Prep brief from the connected Gmail/Calendar — run a
   meeting-prep wrench if one exists (`wrench_list` / `wrench_execute`), else read the next event +
   recent threads and synthesize. Keep it tight and real; never fabricate.
6. **Offer** the weekly branded report (a dashboard page + a `create_scheduled_task` for weekly
   delivery). Create it only if the user says yes.
7. Summarize what's now live and suggest one thing to try.

## 3. RETURNING — connect what they have
List their assistants, surface them as usable here, and offer to stand up the weekly report. Do not
recreate anything that exists.

## 4. CONSUMER — join the operator's org
Bind the user to the operator's existing assistant(s), confirm their services are connected, and hand
them a working, business-aware Claude. Do not create or configure org-level anything — the operator
already did.

## Rules
- Ask before any action that creates or modifies data. Show what you're about to do in one line.
- Governance, spend, and audit are configured in Toolbelt, not here.
- One step at a time. Short, concrete turns. If a tool call fails, say so and offer to retry — never
  claim success you didn't get.
