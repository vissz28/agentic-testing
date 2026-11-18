// The band's state contract: the last live file it read (lib/pipeline/live.mjs), when, and the language to show it in.

export type Counts = {
  total: number
  done: number
  passed?: number
  failed?: number
  skipped?: number
  killed?: number
  survived?: number
  files?: { done: number; total: number }
}

export type Live = {
  v: number
  key: string | null
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  verdict: string | null
  side: string | null
  sideIndex: number
  sides: number
  step: string | null
  plan: string[]
  tests: Counts | null
  mutants: Counts | null
  stryker: Counts | null
}

export type Lang = 'en' | 'it'
export type Seen = { run: Live; now: number; lang: Lang }

declare module 'claude-code' {
  interface PluginState {
    'quality-code': { live: Shaped<Seen | null> }
  }
}
