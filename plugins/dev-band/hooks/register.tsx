import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { Git, Sitrep, Snap } from '../types'

// Usage tracking (limits, context, cache TTL learning) adapted from
// Vosssa/claude-usage-band (MIT, see LICENSE-usage-band). Drawing and the sitrep are ours.

const TTL_SUB = 60 * 60_000
const TTL_API = 5 * 60_000
const MIN_PROMPT = 20_000
const NAG = 400_000
const NAG_HARD = 600_000
const IDLE_MS = 30 * 60_000

const snap = atom({ plugin: 'dev-band', key: 'snap' } as const, { ctxWin: 0, sub: false, lastAt: 0, now: 0 } as Snap)
const git = atom({ plugin: 'dev-band', key: 'git' } as const, null as Git | null)
const sitrep = atom({ plugin: 'dev-band', key: 'sitrep' } as const, null as Sitrep | null)
const isBusy = atom({ plugin: 'dev-band', key: 'isBusy' } as const, false)
const isPinned = atom({ plugin: 'dev-band', key: 'isPinned' } as const, false)
// Kept in session state, not a timer, so a mod reload or /reload-plugins can't lose the countdown.
const idleSince = atom({ plugin: 'dev-band', key: 'idleSince' } as const, 0)
const sitrepFor = atom({ plugin: 'dev-band', key: 'sitrepFor' } as const, 0)

// GitHub-dark-ish terminal palette.
const OK = '#3fb950', WARN = '#d29922', BAD = '#f85149', WARM = '#f0883e', COOL = '#58a6ff', ACCENT = '#bc8cff'
const tone = (p: number) => (p >= 90 ? BAD : p >= 70 ? WARN : OK)

const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`)
const left = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / 60_000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${h % 24}h`
}
const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Keep the start and the end, which carry the meaning: feat/add-us…-band
const mid = (t: string, max: number) => {
  const c = [...t]
  if (c.length <= max) return t
  const head = Math.ceil((max - 1) / 2)
  return `${c.slice(0, head).join('')}…${c.slice(c.length - (max - 1 - head)).join('')}`
}
// A long path keeps its last two folders: ~/dev/lifeos/apps/web → …/apps/web
const shortDir = (d: string, max: number) => {
  if ([...d].length <= max) return d
  const parts = d.split('/').filter(Boolean)
  return mid(`…/${parts.slice(-2).join('/')}`, max)
}
// Greedy word wrap to a number of monospace cells.
const wrap = (t: string, n: number): string[] => {
  const out: string[] = []
  let line = ''
  for (const w of t.split(/\s+/).filter(Boolean)) {
    if (!line) line = w
    else if ([...line].length + 1 + [...w].length <= n) line += ` ${w}`
    else {
      out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

const MAX_DIR = 24
const MAX_BRANCH = 28

// Eighth-block bar: ▕█████▋░░░░▏
const bar = (frac: number, width: number) => {
  const f = Math.max(0, Math.min(1, frac)) * width
  const full = Math.floor(f)
  const part = ' ▏▎▍▌▋▊▉'[Math.round((f - full) * 8)]
  const fill = '█'.repeat(full) + (full < width && part !== ' ' ? part : '')
  return fill + '░'.repeat(Math.max(0, width - [...fill].length))
}

// ---- desktop drawing: monospace SVG segments ----
// The desktop app sets Text in a proportional font, so block characters break apart.
// Each segment is drawn as its own small SVG in a monospace face instead.

type Run = { text: string; color?: string; dim?: boolean; bold?: boolean } | { bar: number; color: string; width: number } | { dot: string }
const FS = 12.5
// Measured in the desktop app: its monospace face advances ~0.65em, so size for 0.66.
const CW = FS * 0.66
const H = 20
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const seg = (runs: Run[]) => {
  let x = 0
  const parts: string[] = []
  for (const r of runs) {
    if ('bar' in r) {
      const f = Math.max(0, Math.min(1, r.bar))
      parts.push(`<rect x="${x}" y="${H / 2 - 3}" width="${r.width}" height="6" rx="3" class="track"/>`)
      if (f > 0) parts.push(`<rect x="${x}" y="${H / 2 - 3}" width="${Math.max(6, f * r.width).toFixed(1)}" height="6" rx="3" fill="${r.color}"/>`)
      x += r.width + CW
    } else if ('dot' in r) {
      parts.push(`<circle cx="${x + 4}" cy="${H / 2}" r="3.5" fill="${r.dot}"/>`)
      x += 8 + CW
    } else {
      const cls = r.dim ? 'dim' : r.color ? '' : 'fg'
      const fill = r.color && !r.dim ? ` fill="${r.color}"` : ''
      parts.push(`<text x="${x}" y="${H / 2 + FS * 0.36}" class="${cls}"${fill}${r.bold ? ' font-weight="600"' : ''}>${esc(r.text)}</text>`)
      x += r.text.length * CW
    }
  }
  const w = Math.ceil(x)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">
<style>text{font:${FS}px ui-monospace,'SF Mono',Menlo,monospace;white-space:pre}.fg{fill:#24292f}.dim{fill:#6e7781}.track{fill:#000;fill-opacity:.1}
@media (prefers-color-scheme:dark){.fg{fill:#e6edf3}.dim{fill:#8b949e}.track{fill:#fff;fill-opacity:.12}}</style>
${parts.join('')}</svg>`
  return { svg, w }
}

// ---- usage (from usage-band) ----

type Limits = readonly SessionRateLimit[]
const withLimits = (s: Snap, rl: Limits): Snap => {
  if (!rl.length) return s
  const h5 = rl.find(r => r.kind === 'five_hour')
  const wk = rl.find(r => r.kind === 'seven_day')
  return { ...s, sub: true, h5: h5?.percentUsed, h5Reset: h5?.resetsAt, wk: wk?.percentUsed, wkReset: wk?.resetsAt }
}
const fold = (u: Pick<SessionUsage, 'context' | 'rateLimits'>, cached?: Limits) => (s: Snap): Snap => ({
  ...withLimits(s, u.rateLimits.length ? u.rateLimits : cached ?? []),
  ctxPct: u.context.percent, ctxTok: u.context.tokens, ctxWin: u.context.window,
})
type SavedLimits = { at: number; rl: Limits }
const parseLimits = (v: unknown): SavedLimits | undefined =>
  Array.isArray(v) ? { at: 0, rl: v as Limits }
    : v && typeof v === 'object' && Array.isArray((v as SavedLimits).rl) ? (v as SavedLimits) : undefined
const aged = (rl: Limits, now: number): Limits =>
  rl.map(r => (r.resetsAt && Date.parse(r.resetsAt) <= now ? { kind: r.kind, percentUsed: 0 } : r))

type Seen = Record<string, number>
async function remember($: EngineInterface, t: number) {
  const [id, got] = await Promise.all([$.session.id(), $.store.get('lastAt')])
  const seen = { ...((got ?? {}) as Seen), [id]: t }
  const keep = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 30)
  await $.store.set('lastAt', Object.fromEntries(keep))
}

async function transcriptAt($: EngineInterface, id: string): Promise<number> {
  try {
    const [cwd, cfg, home] = await Promise.all([$.session.cwd(), $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('HOME')])
    const base = cfg ?? `${home}/.claude`
    const st = await $.fs.stat(`${base}/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${id}.jsonl`)
    return st.kind === 'file' ? st.mtimeMs : 0
  } catch {
    return 0
  }
}

let storedLimits = ''

// ---- git ----

async function refreshGit($: EngineInterface) {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) ?? ''
  const dir = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd
  const noRepo: Git = { branch: '', dirty: 0, ahead: 0, behind: 0, dir, isRepo: false }
  try {
    const r = await $.process.run(['git', 'status', '--porcelain=v1', '-b'], { timeoutMs: 5000 })
    if (r.exitCode !== 0) return update($, git, () => noRepo)
    const [head, ...rest] = r.stdout.split('\n')
    const m = head.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.\S+)?(?: \[(.*)\])?/)
    const info = m?.[2] ?? ''
    const g: Git = {
      branch: m?.[1] ?? 'HEAD',
      dirty: rest.filter(l => l.trim()).length,
      ahead: Number(info.match(/ahead (\d+)/)?.[1] ?? 0),
      behind: Number(info.match(/behind (\d+)/)?.[1] ?? 0),
      dir,
      isRepo: true,
    }
    await update($, git, () => g)
  } catch {
    await update($, git, () => noRepo)
  }
}

// ---- sitrep ----

const promptFor = (skill: string) => `You are writing a sitrep for the user, who has stepped away from this session.
Follow these instructions for content, tone and brevity:

<sitrep-skill>
${skill}
</sitrep-skill>

Answer with JSON only, no prose and no code fence:
{"now": "<one sentence>", "last": ["<bullet>", ...], "needsYou": "<what you need, or null>", "next": ["<bullet>", ...]}
Keep every string short and plain. Use null for needsYou unless work genuinely cannot continue without the user.`

const parseSitrep = (text: string, at: number): Sitrep | null => {
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try {
    const raw = JSON.parse(text.slice(a, b + 1))
    const list = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, 4) : [])
    return {
      now: typeof raw.now === 'string' ? raw.now : '',
      last: list(raw.last),
      needsYou: typeof raw.needsYou === 'string' && raw.needsYou.trim() ? raw.needsYou : null,
      next: list(raw.next).slice(0, 3),
      at,
    }
  } catch {
    return null
  }
}

let sitrepError = ''

// Your own sitrep skill wins; the copy shipped with the mod covers installs without one.
async function sitrepSkill($: EngineInterface) {
  const home = await $.env.get('HOME')
  for (const path of [home && `${home}/.claude/skills/sitrep/SKILL.md`, `${$.plugin.root}/hooks/sitrep.md`]) {
    if (!path) continue
    try {
      return await $.fs.read(path)
    } catch {}
  }
  return 'Sections: Now, Last step, Needs you (only if blocked), Next. Under 12 lines. Plain words. Name who does each step.'
}


// Checked once a minute: 30 minutes since the last turn ended, and no sitrep yet for that idle stretch.
async function checkIdle($: EngineInterface, now: number) {
  const since = await read($, idleSince)
  if (!since || now - since < IDLE_MS) return
  if ((await read($, sitrepFor)) === since) return
  await update($, sitrepFor, () => since)
  await writeSitrep($)
}

async function writeSitrep($: EngineInterface) {
  if (await read($, isBusy)) return
  await update($, isBusy, () => true)
  sitrepError = ''
  try {
    const skill = await sitrepSkill($)
    const reply = await $.model.fork({ prompt: promptFor(skill) })
    if (!reply.isAnswered) {
      if (reply.reason !== 'nothing-to-fork') sitrepError = `sitrep failed (${reply.reason})`
      return
    }
    const s = parseSitrep(reply.text, await $.clock.now())
    if (!s) {
      sitrepError = 'sitrep: unreadable reply'
      return
    }
    await update($, sitrep, () => s)
    if (s.needsYou) $.ui.toast(`Needs you: ${s.needsYou}`, { timeoutMs: 10000 })
  } finally {
    await update($, isBusy, () => false)
  }
}

async function closeSitrep($: EngineInterface) {
  await update($, sitrep, () => null)
  await update($, isPinned, () => false)
}

// The band's compact shortcut: say what happened instead of failing silently.
// The desktop app runs Claude Code headless, where $.session.compact is unavailable;
// running the built-in /compact command does the same and reports its own progress.
// Not awaited: compaction outlasts the 10s budget a ui.press hook gets, so the press
// returns at once and a failure is reported whenever it arrives.
function compactNow($: EngineInterface) {
  // A slash command has to go through command.run; prompt.submit refuses text starting with /.
  $.command.run({ command: 'compact' }).catch(err => {
    $.ui.log(`dev-band: could not start /compact: ${String(err).slice(0, 160)}`)
    void $.prompt.fill({ text: '/compact' })
  })
}

// ---- hooks ----

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const [now, u, ttl, seen, limits, id] = await Promise.all([
      $.clock.now(), $.session.usage(), $.store.get('ttl'), $.store.get('lastAt'), $.store.get('limits'), $.session.id(),
    ])
    const got = parseLimits(limits)
    const cached = got && aged(got.rl, now)
    const saved = ((seen ?? {}) as Seen)[id] || (u.context.tokens ? await transcriptAt($, id) : 0)
    await update($, snap, s => ({
      ...fold(u, cached)(s),
      now,
      limitsAt: u.rateLimits.length ? now : got?.at ?? 0,
      ttl: ttl === '5m' || ttl === '1h' ? ttl : s.ttl,
      lastAt: Math.max(s.lastAt, Math.min(saved, now)),
    }))
    await refreshGit($)
    await $.command.register({ name: 'sitrep-card', description: 'Unfold the sitrep in the band now instead of waiting 30 idle minutes' })
    $.clock.every(60_000, async () => {
      const [t, v] = await Promise.all([$.clock.now(), $.store.get('limits')])
      const fresh = parseLimits(v)
      await update($, snap, s => (fresh && fresh.at > (s.limitsAt ?? 0)
        ? { ...withLimits(s, aged(fresh.rl, t)), limitsAt: fresh.at, now: t }
        : { ...s, now: t }))
      await refreshGit($)
      await checkIdle($, t)
    })
    // A load with no countdown running (first load, or a reload of an older version) starts one now.
    if (!(await read($, idleSince))) await update($, idleSince, () => now)
    // Catch up at once if the idle stretch already passed while the mod was reloading.
    void checkIdle($, now)
    return next(e)
  })

  on('command.run', { command: 'sitrep-card' }, async $ => {
    void writeSitrep($)
    return { text: 'Writing the sitrep into the band.' }
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const isResponse = e.changed.includes('context')
    const tok = e.context.tokens ?? 0
    const prev = await read($, snap)
    if (tok >= NAG && !prev.warned) {
      $.ui.toast(`Context is at ${k(tok)} tokens: every turn re-sends all of it. Consider compacting or clearing.`)
    }
    await update($, snap, s => ({
      ...fold(e)(s), now, lastAt: isResponse ? now : s.lastAt,
      limitsAt: e.rateLimits.length ? now : s.limitsAt,
      warned: tok >= NAG,
      snooze: tok < NAG ? 0 : s.snooze,
    }))
    const rl = JSON.stringify(e.rateLimits)
    if (e.rateLimits.length && rl !== storedLimits) {
      storedLimits = rl
      await $.store.set('limits', { at: now, rl: e.rateLimits })
    }
    return next(e)
  })

  // You're back: the sitrep has done its job, unless pinned.
  on('prompt.submit', async ($, e, next) => {
    await update($, idleSince, () => 0)
    if (!(await read($, isPinned))) await closeSitrep($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await update($, idleSince, () => 0)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, snap, s => ({ ...s, lastAt: now, now }))
    await remember($, now)
    void refreshGit($)
    if (!e.agentId) await update($, idleSince, () => now)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const first = e.index === 0 && !e.agentId
    const [before, sentAt] = first ? await Promise.all([read($, snap), $.clock.now()]) : [undefined, 0]
    const r = yield* next(e)
    const u = r.usage
    if (!before || !u) return r
    const total = u.cache_read_input_tokens + u.cache_creation_input_tokens + u.input_tokens
    if (total < MIN_PROMPT) return r
    const hit = u.cache_read_input_tokens / total >= 0.5
    const gap = before.lastAt ? sentAt - before.lastAt : -1
    const sameModel = !before.model || before.model === u.model
    let ttl = before.ttl
    if (sameModel && hit && gap > 6 * 60_000) ttl = '1h'
    else if (sameModel && !hit && gap > 6 * 60_000 && gap < 55 * 60_000 && u.cache_read_input_tokens / total < 0.2) ttl = '5m'
    if (ttl && ttl !== before.ttl) await $.store.set('ttl', ttl)
    const ttlMs = (ttl ?? (before.sub ? '1h' : '5m')) === '1h' ? TTL_SUB : TTL_API
    if (!hit && gap >= 0 && gap < ttlMs && sameModel && total >= 50_000) {
      $.ui.toast(`Cache miss: that message re-read ${k(total - u.cache_read_input_tokens)} tokens at full price.`)
    }
    await update($, snap, s => ({
      ...s, ttl, model: u.model, hit: u.cache_read_input_tokens / total,
      missTok: hit ? undefined : total - u.cache_read_input_tokens,
    }))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const [s, g, rep, busy, pinned] = await Promise.all([
      read($, snap), read($, git), read($, sitrep), read($, isBusy), read($, isPinned),
    ])
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = Math.max(s.now, s.lastAt)
    const cols = e.props.bodyColumns || 120

    // One model for both surfaces. Lower prio drops first when the line won't fit.
    type Spec = { key: string; prio: number; alt: string; runs: Run[] }
    const specs: Spec[] = []
    const tok = s.ctxTok ?? 0
    const cp = s.ctxPct ?? 0

    if (g && !g.isRepo) {
      specs.push({ key: 'git', prio: 3, alt: `${g.dir}, not a git repo`, runs: [{ text: shortDir(g.dir, MAX_DIR), color: ACCENT }] })
    } else if (g) {
      const r: Run[] = [{ text: `⎇ ${mid(g.branch, MAX_BRANCH)}`, color: ACCENT }]
      if (g.dirty) r.push({ text: ` ±${g.dirty}`, color: WARN })
      if (g.ahead) r.push({ text: ` ↑${g.ahead}`, dim: true })
      if (g.behind) r.push({ text: ` ↓${g.behind}`, dim: true })
      specs.push({ key: 'git', prio: 3, alt: `branch ${g.branch}, ${g.dirty} changed`, runs: r })
    }

    // Bars start at their minimum; whatever room is left after the text is theirs.
    const BW = 24
    const limit = (key: string, label: string, prio: number, pct?: number, reset?: string) => {
      if (pct === undefined) return
      const isReset = !!reset && Date.parse(reset) <= now
      const p = isReset ? 0 : pct
      const color = tone(p)
      const tail = reset && !isReset ? ` ${left(Date.parse(reset) - now)}` : ''
      specs.push({
        key, prio, alt: `${label} limit ${Math.round(p)}%${tail}`,
        runs: [{ text: `${label} `, dim: true }, { bar: p / 100, color, width: BW }, { text: `${Math.round(p)}%`, color, bold: true }, ...(tail ? [{ text: tail, dim: true }] : [])],
      })
    }
    limit('h5', '5h', 5, s.h5, s.h5Reset)
    limit('wk', '7d', 2, s.wk, s.wkReset)

    const ttl = (s.ttl ?? (s.sub ? '1h' : '5m')) === '1h' ? TTL_SUB : TTL_API
    const rem = s.lastAt ? s.lastAt + ttl - now : 0
    // Only a miss is worth the space; a hit is the normal case.
    const miss = s.missTok ? ` ✗${k(s.missTok)}` : ''
    const cache: Run[] = e.props.isWorking
      ? [{ text: 'cache ', dim: true }, { dot: WARM }, { text: 'hot', color: WARM }]
      : rem > 0
        ? [{ text: 'cache ', dim: true }, { dot: WARM }, { text: 'warm', color: WARM }, { text: ` ${Math.max(0, Math.ceil(rem / 60_000))}m`, dim: true }, ...(miss ? [{ text: miss, color: BAD }] : [])]
        : [{ text: 'cache ', dim: true }, { dot: COOL }, { text: s.lastAt ? 'cold' : '—', color: COOL }]
    specs.push({ key: 'cache', prio: 4, alt: 'prompt cache', runs: cache })

    // Width of a spec in cells (terminal) or px (desktop).
    const isTerm = e.surface === 'terminal'
    let TW = 3
    const cells = (r: Run[]) => r.reduce((n, x) => n + ('bar' in x ? (TW ? TW + 3 : 0) : 'dot' in x ? 2 : [...x.text].length), 0)
    const GAP_T = 3
    const GAP_PX = 24
    const avail = isTerm ? cols - 2 : cols * 8 - 24
    const width = (list: Spec[]) =>
      list.reduce((n, x) => n + (isTerm ? cells(x.runs) : seg(x.runs).w), 0) + Math.max(0, list.length - 1) * (isTerm ? GAP_T : GAP_PX)
    let shown = [...specs]
    // First shorten the cache to its state, then drop whole segments by priority.
    if (width(shown) > avail) {
      shown = shown.map(x => (x.key === 'cache' ? { ...x, runs: x.runs.filter(r => !('text' in r) || !r.dim || r.text === 'cache ') } : x))
    }
    while (width(shown) > avail && shown.length > 1) {
      const lowest = shown.reduce((m, x) => (x.prio < m.prio ? x : m))
      shown = shown.filter(x => x !== lowest)
    }
    // Spare room goes to the bars, up to a cap, leaving a little air.
    const nBars = shown.reduce((n, x) => n + x.runs.filter(r => 'bar' in r).length, 0)
    if (nBars) {
      const spare = avail - width(shown) - (isTerm ? 4 : 48)
      if (isTerm && TW) TW = Math.min(24, TW + Math.max(0, Math.floor(spare / nBars)))
      if (!isTerm) {
        const grow = Math.max(0, Math.floor(spare / nBars))
        shown = shown.map(x => ({ ...x, runs: x.runs.map(r => ('bar' in r ? { ...r, width: Math.min(220, r.width + grow) } : r)) }))
      }
    }

    // Big-context row: the cheapest move given the cache.
    const isCold = s.lastAt > 0 && rem <= 0
    const isExpiring = !isCold && rem > 0 && rem <= 10 * 60_000
    const nag = !e.props.isWorking && tok >= Math.max(NAG, s.snooze ?? 0)
    const nagRow = nag ? (
      <Box key="nag" flexDirection="row" alignItems="center" gap={1} paddingX={1}>
        <Text color={isCold ? COOL : tok >= NAG_HARD ? BAD : WARN}>!</Text>
        <Text dimColor wrap="truncate-end">
          {isCold
            ? `cache cold: next message re-reads ${k(tok)}; clear is free`
            : isExpiring
              ? `cache expires in ${left(rem)}: compact while it's cheap`
              : `${k(tok)} in context: every turn re-sends it`}
        </Text>
        <Button key="compact" label="compact" hotkey="c" variant={isCold ? 'secondary' : 'primary'} onPress={() => compactNow($)} />
        <Button key="clear" label="clear" hotkey="x" variant={isCold ? 'primary' : 'secondary'} onPress={() => void $.prompt.fill({ text: '/clear' })} />
        <Button key="later" label="later" hotkey="l" onPress={() => update($, snap, x => ({ ...x, snooze: tok + 100_000 }))} />
      </Box>
    ) : null

    // The sitrep unfolds under the metrics.
    const showRep = rep && (!e.props.isWorking || pinned)
    const bullets = (items: string[], p: string) =>
      items.map((t, i) => (
        <Text key={`${p}${i}`} wrap="wrap">
          <Text dimColor>{'    · '}</Text>
          {t}
        </Text>
      ))
    const repView = showRep && rep ? (
      <Box key="rep" flexDirection="column" paddingX={1} marginTop={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text dimColor>
            {`── sitrep @ ${hhmm(rep.at)}${pinned ? ' · pinned' : ''} ──`}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="pin" label={pinned ? 'unpin' : 'pin'} hotkey="p" onPress={() => update($, isPinned, v => !v)} />
            <Button key="close" label="close" hotkey="d" role="dismiss" onPress={() => closeSitrep($)} />
          </Box>
        </Box>
        <Text wrap="wrap">
          <Text color={COOL} bold>{'  now  '}</Text>
          {rep.now}
        </Text>
        {rep.last.length > 0 && <Text color={COOL} bold>{'  last'}</Text>}
        {bullets(rep.last, 'l')}
        {rep.needsYou && (
          <Text wrap="wrap">
            <Text color={WARN} bold>{'  you  '}</Text>
            <Text color={WARN}>{rep.needsYou}</Text>
          </Text>
        )}
        {rep.next.length > 0 && <Text color={COOL} bold>{'  next'}</Text>}
        {bullets(rep.next, 'n')}
      </Box>
    ) : busy ? (
      <Box key="rep" paddingX={1}>
        <Text dimColor>── sitrep: writing…</Text>
      </Box>
    ) : sitrepError ? (
      <Box key="rep" paddingX={1}>
        <Text color={BAD}>{`── ${sitrepError}`}</Text>
      </Box>
    ) : null

    if (!isTerm) {
      const { Svg } = $.ui.resolve(e) as unknown as { Svg: (p: { source: string; alt: string; width?: number; height?: number }) => unknown }
      const svgRow = (key: string, runs: Run[], alt: string) => {
        const d = seg(runs)
        return <Svg key={key} source={d.svg} alt={alt || ' '} width={d.w} height={H} />
      }
      // A label column, then text wrapped to the band's width:
      //   now   one sentence
      //   last  · bullet
      const LABEL = 6
      // bodyColumns is in the app's own monospace cells, which are at least as wide as ours.
      const textCells = Math.max(20, cols - LABEL - 6)
      const block = (key: string, label: string, color: string, items: string[], bullet: boolean, textColor?: string) => {
        const rows: unknown[] = []
        items.forEach((item, i) => {
          wrap(item, textCells).forEach((ln, j) => {
            const first = i === 0 && j === 0
            const lead = bullet ? (j === 0 ? '· ' : '  ') : ''
            rows.push(svgRow(`${key}${i}-${j}`, [
              first ? { text: label.padEnd(LABEL), color, bold: true } : { text: ' '.repeat(LABEL) },
              { text: lead, dim: true },
              textColor ? { text: ln, color: textColor } : { text: ln },
            ], first ? `${label}: ${item}` : ln))
          })
        })
        return rows
      }
      const nagText = isCold
        ? `cache cold: next message re-reads ${k(tok)} · clear is free`
        : isExpiring
          ? `cache expires in ${left(rem)} · compact while it's cheap`
          : `${k(tok)} in context · every turn re-sends it`
      const nagColor = isCold ? COOL : tok >= NAG_HARD ? BAD : WARN
      const nagDesk = nag ? (
        <Box key="nag" flexDirection="row" justifyContent="space-between" alignItems="center" paddingX={1} marginTop={1}>
          {svgRow('nagmsg', [{ text: '! ', color: nagColor, bold: true }, { text: nagText, dim: true }], nagText)}
          {svgRow('nagkeys', [
            { text: 'c', color: COOL }, { text: ' compact', dim: isCold, ...(isCold ? {} : { color: undefined }) },
            { text: '   x', color: COOL }, { text: ' clear', dim: !isCold },
            { text: '   l', color: COOL }, { text: ' later', dim: true },
          ], 'c compact, x clear, l later')}
          <Box display="none">
            <Button key="compact" label="compact" hotkey="c" onPress={() => compactNow($)} />
            <Button key="clear" label="clear" hotkey="x" onPress={() => void $.prompt.fill({ text: '/clear' })} />
            <Button key="later" label="later" hotkey="l" onPress={() => update($, snap, x => ({ ...x, snooze: tok + 100_000 }))} />
          </Box>
        </Box>
      ) : null

      const repDesk = showRep && rep ? (
        <Box key="rep" flexDirection="column" paddingX={1} marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            {svgRow('hdr', [
              { text: '── ', dim: true },
              { text: 'sitrep', color: COOL, bold: true },
              { text: ` @ ${hhmm(rep.at)}${pinned ? ' · pinned' : ''}`, dim: true },
            ], `sitrep at ${hhmm(rep.at)}`)}
            {svgRow('hdrkeys', [
              { text: 'p', color: COOL }, { text: pinned ? ' unpin' : ' pin', dim: true },
              { text: '   d', color: COOL }, { text: ' close', dim: true },
            ], 'p pin, d close')}
            {/* Keys only: the buttons stay mounted for their hotkeys but are not drawn. */}
            <Box display="none">
              <Button key="pin" label={pinned ? 'unpin' : 'pin'} hotkey="p" onPress={() => update($, isPinned, v => !v)} />
              <Button key="close" label="close" hotkey="d" onPress={() => closeSitrep($)} />
            </Box>
          </Box>
          <Box height={1} />
          {block('now', 'now', COOL, [rep.now], false)}
          {block('last', 'last', COOL, rep.last, true)}
          {rep.needsYou ? block('you', 'you', WARN, [rep.needsYou], false, WARN) : null}
          {block('next', 'next', COOL, rep.next, true)}
        </Box>
      ) : busy ? (
        <Box key="rep" paddingX={1} marginTop={1}>{svgRow('busy', [{ text: '── sitrep: writing…', dim: true }], 'sitrep: writing')}</Box>
      ) : sitrepError ? (
        <Box key="rep" paddingX={1} marginTop={1}>{svgRow('err', [{ text: `── ${sitrepError}`, color: BAD }], sitrepError)}</Box>
      ) : null
      return (
        <Box flexDirection="column">
          <Box key="line" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={3} paddingX={1}>
            {shown.map(x => {
              const d = seg(x.runs)
              return <Svg key={x.key} source={d.svg} alt={x.alt} width={d.w} height={H} />
            })}
          </Box>
          {nagDesk}
          {repDesk}
        </Box>
      )
    }

    const termRun = (r: Run, i: number) =>
      'bar' in r ? (TW ? <Text key={i} color={r.color}>{`▕${bar(r.bar, TW)}▏ `}</Text> : null)
        : 'dot' in r ? <Text key={i} color={r.dot}>{'● '}</Text>
          : <Text key={i} color={r.dim ? undefined : r.color} dimColor={r.dim} bold={r.bold}>{r.text}</Text>
    const line = (
      <Box key="line" flexDirection="row" justifyContent="space-between" columnGap={GAP_T} paddingX={1}>
        {shown.map(x => (
          <Text key={x.key} wrap="truncate-end">{x.runs.map(termRun)}</Text>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {line}
        {nagRow}
        {repView}
      </Box>
    )
  })
}
