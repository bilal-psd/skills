---
name: sitrep
description: |
  Quick status of the current session — the problem in play, the last change,
  anything needed from you, and what's next.
disable-model-invocation: true
---

# Sitrep — situation report

The user just stepped back into an active Claude Code session and wants to
re-orient in a few seconds — not read a wall of text. Produce a tight status
report from the current session's context (the recent messages and tool
calls), not from files.

## Output format

ALWAYS use exactly this structure, in this order. Keep the whole report
under ~12 lines.

**Now**
One sentence: the specific problem being worked on at this moment.

**Last step**
Very brief bullets — only the major functional changes, in plain terms a
glancing reader gets instantly. One bullet per real change. Skip incidental
edits, refactors, logging tweaks, and dead ends. If nothing functional
changed, say so in a single line.

**Needs you** — include this section only if input is genuinely required;
otherwise omit it entirely
The specific decision, answer, or action needed from the user before work
can continue.

**Next**
1–3 short bullets: what happens next.

## What keeps it useful

- Brevity wins, and so does plain language. Short lines, everyday words — no
  jargon or unexplained acronyms. The user is glancing, not studying, and
  shouldn't need the code open to follow it. If a line isn't earning its
  place, cut it.
- Name the actor on every step. Say who does the thing — the agent ("I"), a
  test run, CI, a script, or the user ("you"). "I patch the fixture, then you
  push the branch" is clear; "patch the fixture, then push the branch" hides
  who's on the hook. Keep build-time steps (a script generates X) separate
  from run-time steps (the service does X at request time) when both are in
  play.
- "Now" is the live problem, not the whole project. Scope it to what's
  actively being solved this minute, not the session's overall goal.
- "Last step" is major functional changes only, since the user last looked.
  Don't replay the session or list every edit — just the changes that
  actually move the work, in terms the user grasps at a glance. A reader
  skimming this should understand what's different now without knowing the
  code. Leave out refactors, renames, logging, and attempts that went
  nowhere.
- Drop "Needs you" when nothing's needed. A false blocked-on-you line trains
  the user to ignore the real ones. Only include it when work genuinely
  can't proceed without them.
- "Next" is intent, not a lecture. One concrete action per bullet, each with
  its actor.

## Example

**Now** Fixing the auth test that fails sometimes on CI but passes on my
machine.

**Last step**
- Found the cause: the token refresh breaks when the token has already
  expired.
- I'd first suspected the network mock, but that's now ruled out.

**Needs you** The test makes tokens expire after 5 seconds. Is that on
purpose, or should I make it longer?

**Next**
- I fix the test once you answer on the 5-second timeout.
- I run the tests 20 times to confirm the failure is gone.
- You push the branch so CI runs it again.
