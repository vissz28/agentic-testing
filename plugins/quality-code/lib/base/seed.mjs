// The checks of /quality-code:seed's loader: which database seed.target reaches, and what a SQL file may do there.
// Mock data goes to a local database only: a shared, remote or production one is never written.

/** The database a seed.target line names (host[:port]/database, or a URL), credentials dropped; null when it names none. */
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
 * This computer's database: localhost, 127.x.x.x, ::1, or a container name (one word, like postgres, as Docker
 * Compose names its services). A name with a dot, or any other address, may be a shared machine.
 * ponytail: a one-word name is trusted as a container, so a LAN host with a one-word name would pass; add an allow-list if one shows up.
 */
export const isLocal = host => host === '::1' || /^127(\.\d{1,3}){3}$/.test(host) || /^[a-z][a-z0-9_-]*$/i.test(host)

/**
 * Why a mock-data SQL file may not be loaded: schema changes, or (with a tenant) a reset or update that reaches other tenants. [] when it is fine.
 * ponytail: a regex scan per statement, not a SQL parser; it catches the generated files' shapes, not a determined author.
 */
export function sqlProblems(sql, tenant = null) {
  const text = String(sql).replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const out = []
  if (/\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|VIEW|INDEX|TYPE)|TRUNCATE|ALTER\s+(?:TABLE|SCHEMA|DATABASE|TYPE))\b/i.test(text)) out.push('it drops, truncates or alters something: mock data only deletes and inserts rows')
  if (tenant) {
    const scoped = new RegExp(`\\b${tenant.column}"?\\s*=\\s*'${tenant.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`)
    for (const st of text.split(';').map(x => x.trim())) {
      if (/^(?:DELETE\s+FROM|UPDATE)\b/i.test(st) && !scoped.test(st)) out.push(`"${st.split(/\s+/).slice(0, 3).join(' ')} …" does not keep to ${tenant.column} = '${tenant.id}'`)
    }
  }
  return out
}
