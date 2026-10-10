export type Snap = {
  h5?: number
  h5Reset?: string
  wk?: number
  wkReset?: string
  ctxPct?: number
  ctxTok?: number
  ctxWin: number
  sub: boolean
  lastAt: number
  now: number
  snooze?: number
  warned?: boolean
  ttl?: '5m' | '1h'
  model?: string
  hit?: number
  missTok?: number
  limitsAt?: number
}

export type Git = { branch: string; dirty: number; ahead: number; behind: number; dir: string; isRepo: boolean }

export type Sitrep = {
  now: string
  last: string[]
  needsYou: string | null
  next: string[]
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'dev-band': {
      snap: Snap
      git: Git | null
      sitrep: Sitrep | null
      isBusy: boolean
      isPinned: boolean
      idleSince: number
      sitrepFor: number
    }
  }
}
