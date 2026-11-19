// Numbered placeholders: the real id is hidden, but distinct ids stay distinct.
const placeholder = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
// Skips file names like icon@2x.png.
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?!(?:png|jpe?g|gif|svg|webp|ico|bmp|tiff?|pdf)\b)[a-zA-Z]{2,}/g

/** ADF to plain text, one block per line. */
export function adfToText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(adfToText).join('')
  if (typeof node === 'object') {
    if (node.type === 'hardBreak') return '\n'
    // Keep markdown markers so the scorer reads lists and headings as usual.
    if ((node.type === 'bulletList' || node.type === 'orderedList') && Array.isArray(node.content)) {
      const start = Number(node.attrs?.order) || 1
      return node.content.map((item, i) => {
        const marker = node.type === 'orderedList' ? `${start + i}. ` : '- '
        return marker + adfToText(item).split('\n').join(`\n${' '.repeat(marker.length)}`)
      }).join('\n')
    }
    const bits = node.type === 'heading' ? ['#'.repeat(Math.min(Math.max(Number(node.attrs?.level) || 1, 1), 6)) + ' '] : []
    if (typeof node.text === 'string') bits.push(node.text)
    if (Array.isArray(node.content)) {
      const blocks = node.content.some(c => Array.isArray(c?.content))
      bits.push(node.content.map(adfToText).join(blocks ? '\n' : ''))
    }
    return bits.join('')
  }
  return ''
}

/**
 * Applies config.redact, then e-mails and UUIDs. customerId keeps the legacy U###### text.
 * Share one `uuids` map across a ticket's fields so the same id gets the same placeholder.
 */
export function redact(config, text, uuids = new Map()) {
  if (text == null) return ''
  let s = typeof text === 'string' ? text : adfToText(text)
  for (const [name, src] of Object.entries(config?.redact ?? {})) {
    s = s.replace(new RegExp(src, 'g'), name === 'customerId' ? 'U######' : `[redacted:${name}]`)
  }
  s = s.replace(EMAIL, 'user@example.test')
  s = s.replace(UUID, u => {
    const k = u.toLowerCase()
    if (!uuids.has(k)) {
      const used = new Set(uuids.values())
      let n = uuids.size
      while (used.has(placeholder(++n)));
      uuids.set(k, placeholder(n))
    }
    return uuids.get(k)
  })
  return s
}

// What redact() leaves where a real value was. It cannot be undone (the real value is never kept), so a text bound for Jira must hold none.
const PLACEHOLDER = /user@example\.test|00000000-0000-4000-8000-\d{12}|\[redacted:[^\]\s]+\]|\bU######/g

/** The redaction placeholders in a text, each once, in order. */
export function placeholdersIn(text) {
  return [...new Set(String(text ?? '').match(PLACEHOLDER) ?? [])]
}

/** Rebuilds the uuid map from a saved ticket's placeholders so later text continues the numbering. */
export function uuidsOf(ticket) {
  const found = JSON.stringify(ticket ?? '').match(UUID) ?? []
  return new Map(found.filter(u => /^00000000-0000-4000-8000-\d{12}$/.test(u)).map(u => [u, u]))
}

/** First MR/PR URL anywhere in the ticket, any host. */
export function findMergeRequest(input = {}) {
  const hay = JSON.stringify(input ?? '')
  // GitLab /-/merge_requests/N, GitHub /pull/N, Bitbucket /pull-requests/N.
  const re = /https?:\/\/[^\s"'<>\\]+\/(?:(?:-\/)?merge_requests|pull|pull-requests)\/(\d+)/i
  const m = hay.match(re)
  if (!m) return null
  const url = m[0].replace(/[.,;)\]]+$/, '')
  return { url, iid: Number(m[1]) }
}

function redactLeaves(config, value, uuids) {
  if (typeof value === 'string') return redact(config, value, uuids)
  if (Array.isArray(value)) return value.map(v => redactLeaves(config, v, uuids))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactLeaves(config, v, uuids)]))
  return value
}

// Free text the model gathered beside the body.
const HARVESTED = ['scenarios', 'qaPlan', 'flags', 'mergeRequest']

/** Keeps only the count: no file names or URLs. */
export function attachmentCount(value) {
  const n = Array.isArray(value) ? value.length : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** http(s) links only, redacted, as { url, title }. */
export function cleanLinks(config, value, uuids = new Map()) {
  if (!Array.isArray(value)) return []
  return value
    .map(l => (typeof l === 'string' ? { url: l, title: '' } : l))
    .filter(l => l && typeof l.url === 'string' && /^https?:\/\//i.test(l.url.trim()))
    .map(l => ({ url: redact(config, l.url.trim(), uuids), title: redact(config, typeof l.title === 'string' ? l.title : '', uuids).slice(0, 200) }))
}

export function sanitizeTicket(config, input = {}) {
  const text = input.text ?? {}
  const uuids = new Map()
  const summary = redact(config, input.summary ?? '', uuids)
  const description = redact(config, text.description ?? '', uuids)
  const acField = redact(config, text.acField ?? '', uuids)
  const harvested = Object.fromEntries(HARVESTED.filter(k => k in input).map(k => [k, redactLeaves(config, input[k], uuids)]))
  return {
    ...input,
    ...harvested,
    ...('attachments' in input ? { attachments: attachmentCount(input.attachments) } : {}),
    ...('links' in input ? { links: cleanLinks(config, input.links, uuids) } : {}),
    summary,
    text: { description, acField },
    // The branch's own MR isn't a link the ticket gives.
    gitlab: findMergeRequest({ ...input, mergeRequest: undefined }),
  }
}
