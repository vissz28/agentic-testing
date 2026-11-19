// A transcript is personal data: before anything is shown, saved or sent, the config's redact patterns, customer ids,
// e-mails and ids go. Names stay unless the person asks for them to be masked (task owners come from them).
import { redact } from '../ticket/sanitize.mjs'
import { DEFAULTS } from '../config/config.mjs'
import { escapeRegExp } from '../core/text.mjs'

/** The config with the default customer-id pattern always present, so a config without `redact` still masks them. */
const withDefaults = config => ({ ...config, redact: { ...DEFAULTS.redact, ...(config?.redact ?? {}) } })

export const redactText = (config, text, uuids) => redact(withDefaults(config), text, uuids)

/**
 * Redact every turn's words; with `maskSpeakers`, a speaker becomes "Speaker 1", "Speaker 2" … in order of first word,
 * in the words too: the full name, then each part of it (3+ letters). A part two speakers share becomes "Speaker".
 */
export function redactTurns(config, turns, { maskSpeakers = false } = {}) {
  const uuids = new Map()
  const names = new Map()
  if (maskSpeakers) for (const t of turns) if (t.speaker && !names.has(t.speaker)) names.set(t.speaker, `Speaker ${names.size + 1}`)
  const owners = new Map()
  for (const [name, tag] of names) {
    for (const part of new Set(name.split(/[^\p{L}\p{N}'’-]+/u).filter(p => p.length >= 3))) {
      const key = part.toLowerCase()
      owners.set(key, owners.has(key) && owners.get(key) !== tag ? 'Speaker' : tag)
    }
  }
  // A full name wins over a part spelled the same; longest first, so "Ana Rossi" goes whole before "Ana" alone.
  const lookup = new Map([...owners, ...[...names].map(([n, tag]) => [n.toLowerCase(), tag])])
  const alts = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const re = alts.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null
  const unname = text => (re && text ? text.replace(re, m => lookup.get(m.toLowerCase()) ?? m) : text)
  const label = s => (!s ? null : maskSpeakers ? names.get(s) : redactText(config, s, uuids))
  return turns.map(t => ({ speaker: label(t.speaker), time: t.time, text: redactText(config, unname(t.text), uuids) }))
}
