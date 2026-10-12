const WS = '00000000-0000-4000-8000-000000000001'

/** Flatten ADF (or anything nested) to plain text. Strings pass through. */
export function adfToText(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number' || typeof node === 'boolean') return String(node)
  if (Array.isArray(node)) return node.map(adfToText).join('')
  if (typeof node === 'object') {
    const bits = []
    if (typeof node.text === 'string') bits.push(node.text)
    if (Array.isArray(node.content)) {
      const join = node.type === 'paragraph' || node.type === 'heading' ? '\n' : ''
      bits.push(node.content.map(adfToText).join(join))
    }
    return bits.join('')
  }
  return ''
}

/** Replace every pattern in config.redact, then e-mails and UUIDs. A pattern named customerId keeps the legacy text U######. */
export function redact(config, text) {
  if (text == null) return ''
  let s = typeof text === 'string' ? text : adfToText(text)
  for (const [name, src] of Object.entries(config?.redact ?? {})) {
    s = s.replace(new RegExp(src, 'g'), name === 'customerId' ? 'U######' : `[redacted:${name}]`)
  }
  s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'user@example.test')
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, WS)
  return s
}

/** First merge-request URL in the ticket (description, comments, remote links), on any host. */
export function findMergeRequest(input = {}) {
  const hay = JSON.stringify(input ?? '')
  const re = /https?:\/\/[^\s"'<>\\]+\/(?:-\/)?merge_requests\/(\d+)/i
  const m = hay.match(re)
  if (!m) return null
  const url = m[0].replace(/[.,;)\]]+$/, '')
  return { url, iid: Number(m[1]) }
}

export function sanitizeTicket(config, input = {}) {
  const text = input.text ?? {}
  return {
    ...input,
    summary: redact(config, input.summary ?? ''),
    text: {
      description: redact(config, text.description ?? ''),
      acField: redact(config, text.acField ?? ''),
    },
    gitlab: findMergeRequest(input),
  }
}
