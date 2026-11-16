// /quality-code:seed safety checks. Mock data only ever goes to a local database, never a shared or remote one.

/** host[:port]/db or a URL; credentials are dropped. */
export function parseTarget(line) {
  const s = String(line ?? '').trim()
  if (!s || /\s/.test(s)) return null
  let u
  try { u = new URL(s.includes('://') ? s : `db://${s}`) } catch { return null }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host) return null
  const database = u.pathname.replace(/^\/+/, '') || null
  return { host, port: u.port || null, database, shown: `${host.includes(':') ? `[${host}]` : host}${u.port ? `:${u.port}` : ''}${database ? `/${database}` : ''}` }
}

/**
 * Loopback, or a one-word Compose service name. Anything with a dot may be a shared machine.
 * ponytail: a one-word name is trusted as a container, so a LAN host with a one-word name would pass; add an allow-list if one shows up.
 */
export const isLocal = host => host === '::1' || /^127(\.\d{1,3}){3}$/.test(host) || /^[a-z][a-z0-9_-]*$/i.test(host)

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
