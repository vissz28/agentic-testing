// Jira keys of the configured projects: tracked skips, anchor tags and --key.
import { escapeRegExp } from '../core/text.mjs'

export const projectKeys = config => [...config.jira.projects, ...(config.jira.trackingProjects ?? [])]

/** `jira.projects: ["*"]` (the shared server's default, no setup run): any project key counts; the person's own Jira access decides what they can see. */
export const anyProject = config => config.jira.projects.includes('*')

/** Regex source like (?:ABC|TRK)-\d+ , or any key for `*` */
export const keySource = config => anyProject(config) ? '[A-Z][A-Z0-9_]*-\\d+' : `(?:${projectKeys(config).map(escapeRegExp).join('|')})-\\d+`

export const isProjectKey = (config, key) => new RegExp(`^${keySource(config)}$`).test(String(key))

/** One key as a whole word: ABC-1 is not ABC-12, nor XABC-1. */
export const keyPattern = key => new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(key)}(?!\\d)`)

/** The test's top-level describe title holds the key. */
export const inKeyBlock = (test, key) => keyPattern(key).test(test.path?.[0] ?? '')

/** Falls back to all tests when there is no key or nothing matches. */
export function ownTests(tests, key) {
  const own = key ? tests.filter(t => inKeyBlock(t, key)) : tests
  return own.length ? own : tests
}
