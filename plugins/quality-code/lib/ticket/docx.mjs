// The text of a Word (.docx) file: its word/document.xml, unzipped with node:zlib, tags dropped.
// Only what a ticket's analysis needs: paragraphs, tabs and line breaks; no styles, no images.
import { inflateRawSync } from 'node:zlib'

/** Unzipped document.xml larger than this is refused: a real analysis is far smaller (a zip bomb is not). */
const MAX_XML = 20 * 1024 * 1024
export const DOCX_MAX_CHARS = 20000
/** The largest file read, a .docx or an image. */
export const MAX_BYTES = 5 * 1024 * 1024
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The bytes of one file of a zip archive, or null when it is not there. Throws on what is not a zip. */
export function unzipEntry(buf, name) {
  // The end-of-central-directory record is in the last 22 bytes, plus a comment of at most 64 KB.
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

/** { text, truncated } of a .docx file's body, at most maxChars characters. Throws on what is not a .docx. */
export function docxText(buf, { maxChars = DOCX_MAX_CHARS } = {}) {
  let xml
  try { xml = unzipEntry(buf, 'word/document.xml') } catch (e) {
    throw new Error(e.code === 'ERR_BUFFER_TOO_LARGE' ? 'the .docx is too large to read' : e instanceof RangeError ? 'not a .docx (cut short)' : e.message)
  }
  if (!xml) throw new Error('not a .docx (no word/document.xml)')
  const text = xml.toString('utf8')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, d, h, e) => (d ? char(+d, m) : h ? char(parseInt(h, 16), m) : ENTITIES[e] ?? m))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > maxChars ? { text: text.slice(0, maxChars), truncated: true } : { text, truncated: false }
}
