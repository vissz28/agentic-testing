// What the band says about a run: pure, so the tests read it without an engine.

import type { Lang, Live } from './types'

export type { Counts, Lang, Live } from './types'
export type Tone = 'success' | 'error' | 'warning' | 'claude'
export type View = { headline: string; detail: string; pct: number; tone: Tone }

// A finished run stays up this long; a run that stops writing for this long is gone (killed, or its machine slept).
export const SHOW_AFTER_FINISH_MS = 20_000
export const STALE_MS = 15 * 60_000

// The slow steps weigh more, so the bar moves with the time a run takes.
const WEIGHT: Record<string, number> = { types: 2, tests: 4, mutation: 4, stryker: 4, flaky: 4 }
const weight = (step: string) => WEIGHT[step] ?? 1
const sum = (steps: string[]) => steps.reduce((n, s) => n + weight(s), 0)
const ratio = (done = 0, total = 0) => (total > 0 ? Math.min(done / total, 1) : 0)

const WORDS = {
  en: {
    step: 'step', tests: 'tests', files: 'files', mutants: 'mutants', killed: 'killed', changes: 'code changes', survived: 'survived', passed: 'passed', failed: 'failed',
    steps: { boundary: 'boundary', honesty: 'honesty', 'suite-honesty': 'suite honesty', types: 'types', tests: 'tests', expected: 'expected values', mutation: 'mutation', flaky: 'flakiness', stryker: 'Stryker' } as Record<string, string>,
    verdicts: { green: 'passed', tests_red: 'tests fail', checks_failed: 'checks failed', not_verified: 'could not run', crashed: 'stopped' } as Record<string, string>,
  },
  it: {
    step: 'passo', tests: 'test', files: 'file', mutants: 'mutanti', killed: 'uccisi', changes: 'modifiche al codice', survived: 'sopravvissute', passed: 'passati', failed: 'falliti',
    steps: { boundary: 'confini', honesty: 'onestà', 'suite-honesty': 'onestà della suite', types: 'tipi', tests: 'test', expected: 'valori attesi', mutation: 'mutazione', flaky: 'instabilità', stryker: 'Stryker' } as Record<string, string>,
    verdicts: { green: 'superato', tests_red: 'test falliti', checks_failed: 'controlli falliti', not_verified: 'non eseguito', crashed: 'interrotto' } as Record<string, string>,
  },
}

const VERDICT: Record<string, { icon: string; tone: Tone }> = {
  green: { icon: '✅', tone: 'success' },
  tests_red: { icon: '🔴', tone: 'error' },
  checks_failed: { icon: '❌', tone: 'error' },
  not_verified: { icon: '⚠️', tone: 'warning' },
  crashed: { icon: '⚠️', tone: 'warning' },
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN)

export function visible(run: Live | null, now: number): boolean {
  if (!run) return false
  if (run.finishedAt) return now - ms(run.finishedAt) < SHOW_AFTER_FINISH_MS
  return now - ms(run.updatedAt) < STALE_MS
}

/** How far the running step is, from its own counts. */
export function stepFraction(run: Live): number {
  if (run.step === 'tests') return run.tests?.files?.total ? ratio(run.tests.files.done, run.tests.files.total) : ratio(run.tests?.done, run.tests?.total)
  // Mutation's total grows as each spec plans its mutants, so the specs done move the bar.
  if (run.step === 'mutation') return run.mutants?.files?.total ? ratio(run.mutants.files.done, run.mutants.files.total) : ratio(run.mutants?.done, run.mutants?.total)
  if (run.step === 'stryker') return ratio(run.stryker?.done, run.stryker?.total)
  return 0
}

/** The whole run, every side: 100 only once it has finished. */
export function percent(run: Live): number {
  if (run.finishedAt) return 100
  if (!run.step) return Math.floor((run.sideIndex / Math.max(run.sides, 1)) * 100)
  const plan = run.plan.length ? run.plan : [run.step]
  const at = Math.max(plan.indexOf(run.step), 0)
  const side = (sum(plan.slice(0, at)) + weight(plan[at] ?? run.step) * stepFraction(run)) / sum(plan)
  return Math.min(99, Math.floor(((run.sideIndex + side) / Math.max(run.sides, 1)) * 100))
}

export const bar = (pct: number, width = 10) => {
  const full = Math.round((Math.max(0, Math.min(pct, 100)) / 100) * width)
  return '▓'.repeat(full) + '░'.repeat(width - full)
}

export function elapsed(fromIso: string, to: number): string {
  const s = Math.max(0, Math.floor((to - ms(fromIso)) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function counts(run: Live, w: typeof WORDS.en): string {
  const t = run.tests
  if (run.step === 'tests' && t) {
    const files = t.files?.total ? ` · ${w.files} ${t.files.done}/${t.files.total}` : ''
    return `${w.tests} ${t.done}/${t.total} · ✅ ${t.passed ?? 0}  ❌ ${t.failed ?? 0}  ⏭ ${t.skipped ?? 0}${files}`
  }
  if (run.step === 'mutation' && run.mutants) {
    const files = run.mutants.files && run.mutants.files.total > 1 ? ` · ${w.files} ${run.mutants.files.done}/${run.mutants.files.total}` : ''
    return `${w.mutants} ${run.mutants.done}/${run.mutants.total} · ${run.mutants.killed ?? 0} ${w.killed}${files}`
  }
  if (run.step === 'stryker' && run.stryker) return `${w.changes} ${run.stryker.done}/${run.stryker.total} · ${run.stryker.survived ?? 0} ${w.survived}`
  return ''
}

export function view(run: Live, now: number, lang: Lang = 'en'): View {
  const w = WORDS[lang] ?? WORDS.en
  const key = run.key ? ` · ${run.key}` : ''
  if (run.finishedAt) {
    const v = VERDICT[run.verdict ?? ''] ?? { icon: '⚠️', tone: 'warning' as const }
    const t = run.tests
    const tally = t && t.total ? `${t.passed ?? 0} ${w.passed} · ${t.failed ?? 0} ${w.failed} · ` : ''
    return { headline: `${v.icon} Quality Code${key} · ${w.verdicts[run.verdict ?? ''] ?? run.verdict ?? ''}`, detail: `${tally}${elapsed(run.startedAt, ms(run.finishedAt))}`, pct: 100, tone: v.tone }
  }
  const side = run.side ? ` · ${run.side}${run.sides > 1 ? ` (${run.sideIndex + 1}/${run.sides})` : ''}` : ''
  const plan = run.plan.length ? run.plan : run.step ? [run.step] : []
  const step = run.step ? ` · ${w.step} ${Math.max(plan.indexOf(run.step), 0) + 1}/${plan.length} ${w.steps[run.step] ?? run.step}` : ''
  const detail = [counts(run, w), elapsed(run.startedAt, now)].filter(Boolean).join(' · ')
  return { headline: `🧪 Quality Code${key}${side}${step}`, detail, pct: percent(run), tone: 'claude' }
}
