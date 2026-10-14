// Ticket keys of the configured projects: tracked skips, anchor tags and --key.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const projectKeys = config => [...config.jira.projects, ...(config.jira.trackingProjects ?? [])]

/** Regex source for one key of a configured project, like (?:ABC|TRK)-\d+ */
export const keySource = config => `(?:${projectKeys(config).map(esc).join('|')})-\\d+`

export const isProjectKey = (config, key) => new RegExp(`^${keySource(config)}$`).test(String(key))
