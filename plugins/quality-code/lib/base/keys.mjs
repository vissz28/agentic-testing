// Ticket keys of the configured projects: tracked skips, anchor tags and --key.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const projectKeys = config => [...config.jira.projects, ...(config.jira.trackingProjects ?? [])]

/** Regex source for one key of a configured project, like (?:ABC|TRK)-\d+ */
export const keySource = config => `(?:${projectKeys(config).map(esc).join('|')})-\\d+`

export const isProjectKey = (config, key) => new RegExp(`^${keySource(config)}$`).test(String(key))

/** One key as a whole word: ABC-1 is not ABC-12, nor XABC-1. */
export const keyPattern = key => new RegExp(`(?<![A-Za-z0-9-])${esc(key)}(?!\\d)`)

/** A runner's test result inside the key's block: its top-level group's title holds the key. */
export const inKeyBlock = (test, key) => keyPattern(key).test(test.path?.[0] ?? '')

/** The tests in the key's block; every test when there is no key, or none is in its block. */
export function ownTests(tests, key) {
  const own = key ? tests.filter(t => inKeyBlock(t, key)) : tests
  return own.length ? own : tests
}
