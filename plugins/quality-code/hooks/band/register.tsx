// The band above the prompt: a pipeline run's live progress (tests passed, failed, % done), read from the file it writes.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Seen } from './types'
import { bar, view, visible } from './view'

// Change the tag when Seen's fields change: it declines what an earlier version stored.
const seen = atom({ plugin: 'quality-code', key: 'live' } as const, null, { shape: 'live-1' })

/** One plugin script through run-node.cmd, which finds node when PATH lacks it (sh, then cmd on Windows). */
async function script($: EngineInterface, args: string[]): Promise<string | null> {
  const wrapper = `${$.plugin.root}/bin/run-node.cmd`
  for (const argv of [['sh', wrapper, ...args], ['cmd', '/c', wrapper.replace(/\//g, '\\'), ...args]]) {
    try {
      const r = await $.process.run(argv, { timeoutMs: 20_000 })
      if (r.exitCode === 0 && r.stdout.trim()) return r.stdout.trim()
    } catch {}
  }
  return null
}

const languageOf = (out: string | null) => (/"language"\s*:\s*"it"/.test(out ?? '') ? 'it' : 'en')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    // The pipeline and this band agree on the file through the plugin's own code (live.mjs path).
    const file = await script($, ['live.mjs', 'path'])
    if (!file) return started
    let mtime = 0
    let run = ''
    let lang: Seen['lang'] = 'en'
    let shown = false
    $.clock.every(1000, async () => {
      const now = await $.clock.now()
      const stat = await $.fs.stat(file).catch(() => null)
      if (stat && stat.mtimeMs !== mtime) {
        mtime = stat.mtimeMs
        try {
          const live = JSON.parse(await $.fs.read(file))
          // A new run: the person may have switched language since the last one.
          if (live.startedAt !== run) { run = live.startedAt; lang = languageOf(await script($, ['progress.mjs', 'get', 'session'])) }
          shown = visible(live, now)
          await update($, seen, () => ({ run: live, now, lang }))
        } catch {}
        return
      }
      // Nothing new: move the clock while the band shows, then let it go once.
      if (!shown) return
      await update($, seen, s => {
        if (!s) return s
        shown = visible(s.run, now)
        return shown ? { ...s, now } : null
      })
    })
    return started
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, seen)
    if (!s || e.props.hasSurvey || !visible(s.run, s.now)) return next(e)
    const v = view(s.run, s.now, s.lang)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text bold color={v.tone}>{v.headline}</Text>
        <Box gap={1}>
          <Text color={v.tone}>{bar(v.pct)} {v.pct}%</Text>
          <Text dimColor>{v.detail}</Text>
        </Box>
      </Box>
    )
  })
}
