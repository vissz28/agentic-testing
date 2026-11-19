// Plain text from a .docx (word/document.xml via node:zlib), no styles or images.
import { inflateRawSync } from 'node:zlib'

// Zip bomb guard: real documents are far smaller.
const MAX_XML = 20 * 1024 * 1024
// Shared functional analyses run past 20,000 chars and got cut off at that size.
export const DOCX_MAX_CHARS = 60000
export const MAX_BYTES = 5 * 1024 * 1024
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** null when the entry is missing; throws on a non-zip. */
export function unzipEntry(buf, name) {
  // EOCD sits in the last 22 bytes, plus up to a 64 KB comment.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a .docx (no zip directory)')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('not a .docx (bad zip directory)')
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const skip = nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32)
    if (buf.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const local = buf.readUInt32LE(p + 42)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_XML })
      throw new Error(`not a .docx (zip method ${method})`)
    }
    p += 46 + skip
  }
  return null
}

const char = (code, m) => { try { return String.fromCodePoint(code) } catch { return m } }

export function docxText(buf, { maxChars = DOCX_MAX_CHARS } = {}) {
  let xml
  try { xml = unzipEntry(buf, 'word/document.xml') } catch (e) {
    throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'the .docx is too large to read' : e instanceof RangeError ? 'not a .docx (cut short)' : e.message)
  }
  if (!xml) throw new Error('not a .docx (no word/document.xml)')
  const text = xml.toString('utf8')
    // Tracked changes: the text as accepted. Deleted runs and the old place of moved text go; a self-closing
    // <w:del/> (a deleted paragraph mark) has no body and is left to the tag strip below.
    .replace(/<w:(del|moveFrom)\b(?:[^>]*[^/>])?>[\s\S]*?<\/w:\1>/g, '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, '')
    // Mark list paragraphs so the scorer reads them as a list.
    // ponytail: every list item gets "- "; numbering.xml tells bullets from numbers, read it if steps need "1.".
    .replace(/<w:numPr\b/g, '- $&')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, e) => (d ? char(+d, m) : h ? char(parseInt(h, 16), m) : ENTITIES[e] ?? m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxChars ? { text: text.slice(0, maxChars), truncated: true } : { text, truncated: false }
}
