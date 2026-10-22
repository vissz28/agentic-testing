// The n-th distinct UUID of a ticket: still private, but two different ids stay two ids.
const placeholder = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi
// An e-mail, but not a file name like icon@2x.png.
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.(?!(?:png|jpe?g|gif|svg|webp|ico|bmp|tiff?|pdf)\b)[a-zA-Z]{2,}/g

/**
 * Flatten ADF (or anything nested) to plain text. Strings pass through. Blocks (paragraphs,
 * headings, list items) are one per line; the text runs inside one block join as written; a
 * hardBreak is a line break.
 */
export function adfToText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(adfToText).join('')
  if (typeof node === 'object') {
    if (node.type === 'hardBreak') return '\n'
    const bits = []
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
 * Replace every pattern in config.redact, then e-mails and UUIDs. A pattern named customerId keeps
 * the legacy text U######. `uuids` numbers the distinct UUIDs: share one map across a ticket's fields.
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
    if (!uuids.has(k)) uuids.set(k, placeholder(uuids.size + 1))
    return uuids.get(k)
  })
  return s
}

/** First merge-request (or pull-request) URL in the ticket (description, comments, remote links), on any host. */
export function findMergeRequest(input = {}) {
  const hay = JSON.stringify(input ?? '')
  // GitLab /-/merge_requests/N, GitHub /pull/N, Bitbucket /pull-requests/N.
  const re = /https?:\/\/[^\s"'<>\\]+\/(?:(?:-\/)?merge_requests|pull|pull-requests)\/(\d+)/i
  const m = hay.match(re)
  if (!m) return null
  const url = m[0].replace(/[.,;)\]]+$/, '')
  return { url, iid: Number(m[1]) }
}

/** Redact every string leaf of a harvested value; other values keep their shape. */
function redactLeaves(config, value, uuids) {
  if (typeof value === 'string') return redact(config, value, uuids)
  if (Array.isArray(value)) return value.map(v => redactLeaves(config, v, uuids))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactLeaves(config, v, uuids)]))
  return value
}

/** Free text the model harvested next to the ticket body. */
const HARVESTED = ['scenarios', 'qaPlan', 'flags', 'mergeRequest']

export function sanitizeTicket(config, input = {}) {
  const text = input.text ?? {}
  // One numbering for the whole ticket: the same UUID reads the same in every field.
  const uuids = new Map()
  const summary = redact(config, input.summary ?? '', uuids)
  const description = redact(config, text.description ?? '', uuids)
  const acField = redact(config, text.acField ?? '', uuids)
  const harvested = Object.fromEntries(HARVESTED.filter(k => k in input).map(k => [k, redactLeaves(config, input[k], uuids)]))
  return {
    ...input,
    ...harvested,
    summary,
    text: { description, acField },
    // A link in the branch's own merge request is not one the ticket gives.
    gitlab: findMergeRequest({ ...input, mergeRequest: undefined }),
  }
}
