---
name: chief-of-staff
description: Use the Chief-of-Staff assistant whenever the user asks about the user's calendar, schedule, meetings, events, email, inbox triage, daily brief, what's on my plate, open loops, follow-ups, meeting prep, transcripts, reminders, or any executive-assistant / chief-of-staff task. Routes such requests to the "Chief-of-Staff" connector (Powered by Apexti).
---

# Chief-of-Staff

An always-on digital Chief of Staff for founders and executives. Turns a noisy inbox, calendar, and meeting stream into a clear operating picture — email triage, meeting prep, daily briefs, and follow-through.

This skill is a thin router. Chief-of-Staff's actual instructions, skills, knowledge, and
memory live in Toolbelt and are always fetched live — never rely on this file for them.

When a matching request arrives:

1. Use the tools from the "Chief-of-Staff" connector — its tool descriptions are tagged "[Chief-of-Staff]". If a `toolbelt_setup` tool appears instead, ask the user for their Toolbelt API key and call it. If NO Chief-of-Staff tools are available at all, the connector isn't enabled for this chat — ask the user to toggle "Chief-of-Staff" on in the chat's "+" → Connectors menu (or install it: the Chief-of-Staff .mcpb extension, or the Apexti gateway connector URL).
2. BEFORE doing real work with this agent's tools (several agents share services like calendar and email — what differs is their context), call its `load_persona` tool and fully adopt the returned operating instructions. Tool results will remind you if you haven't.
3. Prefer the agent's own tools: `wrench_*` are its skills; `read_storage_file` / `list_storage_files` / `grep_storage_file` are its files and memory.
4. For a long autonomous task, delegate it whole with `manage_delegations` (action "create", then "sleep"/poll until complete) instead of orchestrating many small calls yourself.
5. Answer in the agent's voice and cite what you used.

## Staying in sync with Toolbelt

Snapshot this skill was generated from (compare against the live `load_persona` result):

- workspace: 79b0e0a0-9c22-485d-982e-7668845b6679
- description at generation: "An always-on digital Chief of Staff for founders and executives. Turns a noisy inbox, calendar, and meeting stream into a clear operating picture — email triage, meeting prep, daily briefs, and follow-through."
- generated: 2026-06-10

If the live assistant's purpose or skills have drifted from this file, tell the user and
offer an updated skill — MERGE, keeping their local edits; update only stale generated
parts. Plugin users get updates when the marketplace publishes a new version.
