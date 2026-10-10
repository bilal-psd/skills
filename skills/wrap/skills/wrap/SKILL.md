---
name: wrap
description: Update the work plan and AGENTS.md so a fresh session can pick up where this one left off
disable-model-invocation: true
---

I want to continue this work in a new session after this one closes. Before that happens:

1. Update the work plan file for this task (find the one already in use in this repo/session; if none exists, create one — e.g. `PLAN.md` or similar next to the code it describes) with: what's done, what's in progress, what's next, and any open decisions.
2. Update this project's `AGENTS.md` with any new context, conventions, or decisions from this session that a fresh session would need but wouldn't get from just reading the code — architecture choices, gotchas, things tried and rejected, etc. Don't duplicate what's already derivable from the code itself.
   - `AGENTS.md` is the one instructions file, read by both Claude and Codex. **Never create a `CLAUDE.md`**: any `CLAUDE.md` in a folder or above it stops Claude reading every `AGENTS.md`.
   - Exception: a project that still keeps a `CLAUDE.md` because its `AGENTS.md` is not an instructions file (e.g. a generated one) — update that `CLAUDE.md` instead.

Be concrete enough that a new session with zero memory of this conversation could read these two files and continue without re-asking things we already settled. Once you've made the updates, tell me briefly what you wrote so I can sanity-check before I clear.
