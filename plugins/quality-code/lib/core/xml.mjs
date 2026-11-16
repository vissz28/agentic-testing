// XML reader for test and coverage reports (JUnit, TRX, JaCoCo, Cobertura). No DTD; namespace prefixes are dropped.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/** Decodes &lt; &#65; &#x41;; an unknown entity or an invalid code point stays as is. */
export const decodeEntities = text => String(text).replace(/&(#[xX][0-9a-fA-F]+|#\d+|\w+);/g, (all, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? all
  try { return String.fromCodePoint(/x/i.test(e[1]) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) } catch { return all }
})

const local = name => name.replace(/^[^:]*:/, '')

/**
 * { name: '#document', children, text, unclosed }; each element { name, attrs, children, text }. An end tag closes up
 * to its start tag, a stray one closes nothing. unclosed: the element left open by a cut-off report, else null.
 */
export function parseXml(xml) {
  const doc = { name: '#document', attrs: {}, children: [], text: '', unclosed: null }
  const stack = [doc]
  const s = String(xml ?? '').replace(/^\uFEFF/, '')
  let i = 0
  const skipTo = (end, from) => { const e = s.indexOf(end, from); i = e < 0 ? s.length : e + end.length }
  while (i < s.length) {
    const top = stack.at(-1)
    const lt = s.indexOf('<', i)
    if (lt < 0) { top.text += decodeEntities(s.slice(i)); break }
    if (lt > i) top.text += decodeEntities(s.slice(i, lt))
    if (s.startsWith('<!--', lt)) { skipTo('-->', lt + 4); continue }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt + 9); top.text += s.slice(lt + 9, e < 0 ? s.length : e); skipTo(']]>', lt + 9); continue }
    if (s.startsWith('<?', lt)) { skipTo('?>', lt + 2); continue }
    if (s.startsWith('<!', lt)) { skipTo('>', lt + 2); continue }
    if (s[lt + 1] === '/') {
      const e = s.indexOf('>', lt + 2)
      const name = local(s.slice(lt + 2, e < 0 ? s.length : e).trim())
      const at = stack.map(n => n.name).lastIndexOf(name)
      if (at > 0) stack.length = at
      i = e < 0 ? s.length : e + 1
      continue
    }
    const name = /^[^\s/>]+/.exec(s.slice(lt + 1, lt + 257))?.[0]
    if (!name) { top.text += '<'; i = lt + 1; continue }
    // The attributes run to the first ">" outside quotes.
    let j = lt + 1 + name.length
    for (let quote = null; j < s.length; j++) {
      if (quote) { if (s[j] === quote) quote = null } else if (s[j] === '"' || s[j] === "'") quote = s[j]
      else if (s[j] === '>') break
    }
    // A start tag cut off before its ">" is dropped: the report ends there.
    if (j >= s.length) { doc.unclosed = local(name); return doc }
    const body = s.slice(lt + 1 + name.length, j)
    const el = { name: local(name), attrs: {}, children: [], text: '' }
    for (const m of body.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[local(m[1])] = decodeEntities(m[2] ?? m[3])
    top.children.push(el)
    if (!body.endsWith('/')) stack.push(el)
    i = j + 1
  }
  doc.unclosed = stack.length > 1 ? stack.at(-1).name : null
  return doc
}

/** The first child with this name. */
export const child = (node, name) => node?.children.find(c => c.name === name)

/** Every element with this name below node, in document order. */
export const descendants = (node, name) => (node?.children ?? []).flatMap(c => [...(c.name === name ? [c] : []), ...descendants(c, name)])
