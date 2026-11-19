// /quality-code:seed safety checks. Mock data only ever goes to a local database, never a shared or remote one.

/**
 * host[:port]/db or a URL; credentials are dropped.
 * hosts: every address the connection may use. libpq lets ?host= and ?hostaddr= override the URL's host, and any of them can be a comma list.
 */
export function parseTarget(line) {
  const s = String(line ?? '').trim()
  if (!s || /\s/.test(s)) return null
  let u
  try { u = new URL(s.includes('://') ? s : `db://${s}`) } catch { return null }
  const params = ['host', 'hostaddr'].flatMap(k => u.searchParams.getAll(k))
  const hosts = [u.hostname, ...params].flatMap(h => h.split(',')).map(h => h.trim().replace(/^\[|\]$/g, '')).filter(Boolean)
  if (!hosts.length) return null
  const host = hosts.join(',')
  const database = u.pathname.replace(/^\/+/, '') || null
  return { host, hosts, port: u.port || null, database, shown: `${hosts.length === 1 && host.includes(':') ? `[${host}]` : host}${u.port ? `:${u.port}` : ''}${database ? `/${database}` : ''}` }
}

// The usual Compose service names of a database. A one-word name outside these (dbprod01, fileserver) may be a machine on the network.
const CONTAINERS = ['postgres', 'postgresql', 'pg', 'db', 'database', 'mysql', 'mariadb', 'mongo', 'mongodb', 'redis', 'mssql', 'sqlserver']
const CONTAINER = new RegExp(`^(?:${CONTAINERS.join('|')})(?:[-_]\\d+)?$`, 'i')

/**
 * Loopback, a socket folder (?host=/var/run/postgresql), or a database's Compose service name, with an optional replica number (db_1).
 * ponytail: names only, nothing is resolved; a container with another name is reached as localhost:<published port>.
 */
export const isLocal = host => /^localhost$/i.test(host) || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host) || host.startsWith('/') || CONTAINER.test(host)

/**
 * Rejects schema changes and, with a tenant, DELETE/UPDATE that can reach other tenants.
 * ponytail: a regex scan per statement, not a SQL parser; it catches the generated files' shapes, not a determined author.
 */
export function sqlProblems(sql, tenant = null) {
  // Blank out strings first ("--" or ";" inside one is text), keeping only whether it's the tenant id; then drop comments.
  const id = tenant ? `'${String(tenant.id).replace(/'/g, "''")}'` : null
  const text = String(sql).replace(/'(?:[^']|'')*'/g, s => (s === id ? "'T'" : "''")).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ')
  const out = []
  if (/\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|VIEW|INDEX|TYPE)|TRUNCATE|ALTER\s+(?:TABLE|SCHEMA|DATABASE|TYPE))\b/i.test(text)) out.push('it drops, truncates or alters something: mock data only deletes and inserts rows')
  if (tenant) {
    // Tenant equality must be in the WHERE, with no OR to widen it.
    const scoped = new RegExp(`\\b${tenant.column}"?\\s*=\\s*'T'`)
    for (const st of text.split(';').map(x => x.trim())) {
      const where = /\bWHERE\b([\s\S]*)$/i.exec(st)?.[1]
      if (/^(?:DELETE\s+FROM|UPDATE)\b/i.test(st) && !(where && scoped.test(where) && !/\bOR\b/i.test(where))) out.push(`"${st.split(/\s+/).slice(0, 3).join(' ')} …" does not keep to ${tenant.column} = '${tenant.id}'`)
    }
  }
  return out
}
