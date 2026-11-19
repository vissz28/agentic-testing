// /quality-code:seed safety checks. Mock data only ever goes to a local database, never a shared or remote one.

import { escapeRegExp } from '../core/text.mjs'

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
    // Tenant equality must be a term of the statement's own WHERE (not a subquery's): first or after an AND (so never
    // after a NOT), followed by nothing that changes it, with no OR to widen the WHERE.
    const col = escapeRegExp(tenant.column)
    const scoped = new RegExp(`(?:^|\\bAND)\\s*(?:[\\w"]+\\.)?"?${col}"?\\s*=\\s*'T'\\s*(?:$|\\b(?:AND|RETURNING|LIMIT|ORDER)\\b)`, 'i')
    const shown = st => `"${st.split(/\s+/).slice(0, 3).join(' ')} …"`
    for (const st of text.split(';').map(x => x.trim())) {
      // Bracketed parts (subqueries, value lists) emptied: only the statement's own clauses count.
      let top = st
      while (/\([^()]*\)/.test(top)) top = top.replace(/\([^()]*\)/g, ' _ ')
      if (/^(?:DELETE\s+FROM|UPDATE)\b/i.test(top)) {
        const where = /\bWHERE\b([\s\S]*)$/i.exec(top)?.[1]?.trim()
        if (!(where && scoped.test(where) && !/\bOR\b/i.test(where))) out.push(`${shown(st)} does not keep to ${tenant.column} = '${tenant.id}'`)
      } else if (/\bON\s+CONFLICT\b[\s\S]*\bDO\s+UPDATE\b|\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(st)) {
        out.push(`${shown(st)} updates a row that is already there, which may be another tenant's: delete this tenant's rows first and use ON CONFLICT DO NOTHING`)
      } else if (/\b(?:DELETE|UPDATE)\b|\b(?:REPLACE|MERGE)\s+INTO\b/i.test(st)) {
        // ponytail: a CTE that writes (WITH … DELETE), MERGE or REPLACE is refused whole; the generated files never need one.
        out.push(`${shown(st)} deletes or updates in a shape the check cannot read: write it as DELETE FROM or UPDATE … WHERE ${tenant.column} = '${tenant.id}'`)
      }
    }
  }
  return out
}
