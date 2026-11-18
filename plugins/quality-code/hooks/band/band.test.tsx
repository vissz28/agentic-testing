import { expect, test } from 'claude-code/testing'

import type { Live, Seen } from './types'
import { SHOW_AFTER_FINISH_MS, STALE_MS, bar, percent, view, visible } from './view'

const T0 = Date.parse('2026-11-17T10:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const run = (over: Partial<Live> = {}): Live => ({
  v: 1, key: 'AGT-212', startedAt: iso(T0), updatedAt: iso(T0 + 60_000), finishedAt: null, verdict: null,
  side: 'Vitest', sideIndex: 0, sides: 1, step: 'tests', plan: ['honesty', 'suite-honesty', 'types', 'tests', 'mutation', 'stryker'],
  tests: { total: 50, done: 31, passed: 30, failed: 1, skipped: 0 }, mutants: null, stryker: null, ...over,
})

test('a running test step says the side, the step, the counts and the time', () => {
  const v = view(run(), T0 + 130_000)
  expect(v.headline).toBe('🧪 Quality Code · AGT-212 · Vitest · step 4/6 tests')
  expect(v.detail).toBe('tests 31/50 · ✅ 30  ❌ 1  ⏭ 0 · 2m 10s')
  expect(v.tone).toBe('claude')
})

test('the percent grows with the steps and never reads 100 before the end', () => {
  const types = percent(run({ step: 'types', tests: null }))
  const halfTests = percent(run({ tests: { total: 50, done: 25, passed: 25, failed: 0, skipped: 0 } }))
  const allTests = percent(run({ tests: { total: 50, done: 50, passed: 50, failed: 0, skipped: 0 } }))
  const stryker = percent(run({ step: 'stryker', stryker: { total: 58, done: 58, survived: 3 } }))
  expect(types < halfTests && halfTests < allTests && allTests < stryker).toBe(true)
  expect(stryker).toBe(99)
  expect(percent(run({ finishedAt: iso(T0 + 1000), verdict: 'green' }))).toBe(100)
})

test('Vitest goes by files, since it finds its tests file by file', () => {
  const byFiles = percent(run({ tests: { total: 9, done: 9, passed: 9, failed: 0, skipped: 0, files: { done: 1, total: 4 } } }))
  const byTests = percent(run({ tests: { total: 9, done: 9, passed: 9, failed: 0, skipped: 0 } }))
  expect(byFiles < byTests).toBe(true)
})

test('two sides: the second starts past the first', () => {
  const first = percent(run({ sides: 2, sideIndex: 0, step: 'honesty' }))
  const second = percent(run({ sides: 2, sideIndex: 1, side: 'Playwright', step: 'honesty' }))
  expect(first < 50 && second >= 50).toBe(true)
  expect(view(run({ sides: 2, sideIndex: 1, side: 'Playwright' }), T0).headline).toBe('🧪 Quality Code · AGT-212 · Playwright (2/2) · step 4/6 tests')
})

test('mutation and Stryker show their own counts', () => {
  expect(view(run({ step: 'mutation', mutants: { total: 22, done: 7, killed: 7 } }), T0 + 5000).detail).toBe('mutants 7/22 · 7 killed · 5s')
  expect(view(run({ step: 'stryker', stryker: { total: 58, done: 47, survived: 3 } }), T0 + 5000).detail).toBe('code changes 47/58 · 3 survived · 5s')
})

test('mutation over several specs counts them, and the specs done move the bar', () => {
  const m = (done: number) => run({ step: 'mutation', mutants: { total: 300, done: 120, killed: 118, files: { done, total: 40 } } })
  expect(view(m(10), T0 + 5000).detail).toBe('mutants 120/300 · 118 killed · files 10/40 · 5s')
  expect(percent(m(10)) < percent(m(30))).toBe(true)
})

test('a finished run says its verdict, in the person\'s language', () => {
  const done = run({ finishedAt: iso(T0 + 242_000), verdict: 'tests_red' })
  expect(view(done, T0 + 243_000)).toEqual({ headline: '🔴 Quality Code · AGT-212 · tests fail', detail: '30 passed · 1 failed · 4m 02s', pct: 100, tone: 'error' })
  expect(view(done, T0 + 243_000, 'it').headline).toBe('🔴 Quality Code · AGT-212 · test falliti')
  expect(view(run(), T0 + 5000, 'it').headline).toBe('🧪 Quality Code · AGT-212 · Vitest · passo 4/6 test')
})

test('the band shows a finished run briefly and drops a run that stopped writing', () => {
  const done = run({ finishedAt: iso(T0), verdict: 'green' })
  expect(visible(done, T0 + SHOW_AFTER_FINISH_MS - 1)).toBe(true)
  expect(visible(done, T0 + SHOW_AFTER_FINISH_MS)).toBe(false)
  expect(visible(run(), T0 + 60_000 + STALE_MS - 1)).toBe(true)
  expect(visible(run(), T0 + 60_000 + STALE_MS)).toBe(false)
  expect(visible(null, T0)).toBe(false)
})

test('the bar fills by tenths', () => {
  expect(bar(0)).toBe('░░░░░░░░░░')
  expect(bar(62)).toBe('▓▓▓▓▓▓░░░░')
  expect(bar(100)).toBe('▓▓▓▓▓▓▓▓▓▓')
})

const BAND = {
  plugin: 'quality-code',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

const stored = (seen: Seen | null) => ({ value: { value: { shape: 'live-1', value: seen }, version: 1 } })

test('the band draws a running run on every surface', async ($, on) => {
  on('state.get', () => stored({ run: run(), now: T0 + 130_000, lang: 'en' }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /step 4\/6 tests/ }))?.text).toBe('🧪 Quality Code · AGT-212 · Vitest · step 4/6 tests')
    expect((await ui.find({ type: 'Text', text: /31\/50/ }))?.text).toBe('tests 31/50 · ✅ 30  ❌ 1  ⏭ 0 · 2m 10s')
    await ui.unmount()
  }
})

test('nothing to show: the band leaves the row to the engine', async ($, on) => {
  on('state.get', () => stored(null))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})
