# skills

My Claude Code mods and skills, as a plugin marketplace.

```
/plugin marketplace add bilal-psd/skills
/plugin install dev-band@bilal
```

## What's here

| Plugin | Kind | What it does |
|---|---|---|
| `dev-band` | mod | A band above the prompt: git branch and changes, 5h/7d usage limits, prompt-cache warmth. Warns when context gets big (`c` compact, `x` clear, `l` later). After 30 idle minutes it unfolds a sitrep of the session; `/sitrep-card` writes one now. |
| `question-card` | mod | Adds `ask_many`: the built-in question dialog for 5+ questions, asked one after another. |
| `sitrep` | skill | `/sitrep`: a 12-line status of the session — now, last step, needs you, next. |
| `wrap` | command | `/wrap`: updates the work plan and `AGENTS.md` so a fresh session can pick up where this one left off. |

Install any of them by name: `/plugin install <name>@bilal`. Run `/reload-plugins` if a new command doesn't show up.

## Notes

- `dev-band` writes its sitrep from your own `~/.claude/skills/sitrep/SKILL.md` if you have one, otherwise from the copy it ships.
- `dev-band`'s usage tracking is adapted from [Vosssa/claude-usage-band](https://github.com/Vosssa/claude-usage-band) (MIT, see `plugins/dev-band/LICENSE-usage-band`).

## License

MIT
