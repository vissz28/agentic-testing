// A transcript is personal data: before anything is shown, saved or sent, the config's redact patterns, customer ids,
// e-mails and ids go. Names stay unless the person asks for them to be masked (task owners come from them).
import { redact } from '../ticket/sanitize.mjs'
import { DEFAULTS } from '../base/config.mjs'

/** The config with the default customer-id pattern always present, so a config without `redact` still masks them. */
const withDefaults = config => ({ ...config, redact: { ...DEFAULTS.redact, ...(config?.redact ?? {}) } })

export const redactText = (config, text, uuids) => redact(withDefaults(config), text, uuids)

/** Redact every turn's words; with `maskSpeakers`, a speaker becomes "Speaker 1", "Speaker 2" … in order of first word. */
export function redactTurns(config, turns, { maskSpeakers = false } = {}) {
  const uuids = new Map()
  const names = new Map()
  const label = s => {
    if (!s) return null
    if (!maskSpeakers) return redactText(config, s, uuids)
    if (!names.has(s)) names.set(s, `Speaker ${names.size + 1}`)
    return names.get(s)
  }
  return turns.map(t => ({ speaker: label(t.speaker), time: t.time, text: redactText(config, t.text, uuids) }))
}
