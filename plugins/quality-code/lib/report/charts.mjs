// Inline SVG charts for the HTML report. Pure functions: numbers in, markup out. Colours come from the page's
// CSS custom properties through the tone classes (t-pass, t-warn, t-fail, t-idle, t-accent), so both themes work.
import { empty, esc } from './page.mjs'

const W = 360
const num = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0)
const cut = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

/** A tone's colour dot and name, for under a chart. */
export const legend = items => `<ul class="legend">${items.map(([tone, name]) => `<li><i class="t-${tone}"></i>${esc(name)}</li>`).join('')}</ul>`

/** Horizontal bars, one row per item { label, value, text?, tone? }. `marker` draws a dashed line at that value. */
export function hbar(items, { max = null, marker = null, name = 'Bar chart', emptyText = 'No data in this period.' } = {}) {
  if (!items.length) return empty(emptyText)
  const top = (max ?? Math.max(...items.map(i => i.value), 0)) || 1
  const x0 = 118, x1 = W - 64, row = 26
  const h = items.length * row + 6
  const x = v => num(x0 + (Math.max(0, Math.min(v, top)) / top) * (x1 - x0))
  const rows = items.map((it, i) => {
    const y = i * row + 4
    const w = Math.max(it.value > 0 ? 2 : 0, x(it.value) - x0)
    return `<text x="0" y="${y + 13}">${esc(cut(it.label, 18))}</text><rect class="t-${it.tone ?? 'accent'}" x="${x0}" y="${y + 2}" width="${num(w)}" height="14" rx="2"/><text class="m" x="${W}" y="${y + 13}" text-anchor="end">${esc(it.text ?? it.value)}</text>`
  }).join('')
  const mark = marker === null ? '' : `<line class="mark" x1="${x(marker)}" x2="${x(marker)}" y1="0" y2="${h}"/>`
  const label = `${name}: ${items.map(i => `${i.label} ${i.text ?? i.value}`).join(', ')}`
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(name)}</title>${rows}${mark}</svg>`
}

/**
 * Stacked columns, one per item { label, parts: [{ tone, value, name? }] }. Labels show for about six columns,
 * so a long period stays readable on a phone.
 */
export function columns(items, { name = 'Column chart', emptyText = 'No data in this period.', unit = '' } = {}) {
  const sums = items.map(i => i.parts.reduce((n, p) => n + p.value, 0))
  if (!items.length || !sums.some(s => s > 0)) return empty(emptyText)
  const top = Math.max(...sums)
  const left = 30, base = 140, h = 162, plot = base - 10
  const slot = (W - left) / items.length
  const bw = Math.max(2, Math.min(28, slot * 0.7))
  const step = Math.ceil(items.length / 6)
  let bars = ''
  items.forEach((it, i) => {
    const cx = left + slot * i + slot / 2
    let y = base
    for (const p of it.parts) {
      if (p.value <= 0) continue
      const ph = (p.value / top) * plot
      y -= ph
      bars += `<rect class="t-${p.tone}" x="${num(cx - bw / 2)}" y="${num(y)}" width="${num(bw)}" height="${num(ph)}"><title>${esc(`${it.label}: ${p.name ?? p.tone} ${p.value}${unit}`)}</title></rect>`
    }
    if (i % step === 0) bars += `<text class="m" x="${num(cx)}" y="${base + 14}" text-anchor="middle">${esc(it.label)}</text>`
  })
  const axis = `<line class="grid-line" x1="${left}" x2="${W}" y1="${base}" y2="${base}"/><line class="grid-line" x1="${left}" x2="${W}" y1="${base - plot}" y2="${base - plot}"/><text class="m" x="${left - 4}" y="${base - plot + 4}" text-anchor="end">${esc(num(top))}</text><text class="m" x="${left - 4}" y="${base + 4}" text-anchor="end">0</text>`
  const label = `${name}: ${items.map((it, i) => `${it.label} ${num(sums[i])}${unit}`).join(', ')}`
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(name)}</title>${axis}${bars}</svg>`
}

/** A line over points { label, value } (values 0 to `max`, default 100). */
export function line(points, { max = 100, name = 'Line chart', emptyText = 'No data in this period.', unit = '%' } = {}) {
  if (!points.length) return empty(emptyText)
  const left = 30, base = 140, h = 162, plot = base - 10
  const slot = points.length > 1 ? (W - left - 8) / (points.length - 1) : 0
  const px = i => num(points.length > 1 ? left + 4 + slot * i : (left + W) / 2)
  const py = v => num(base - (Math.max(0, Math.min(v, max)) / max) * plot)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${px(i)} ${py(p.value)}`).join(' ')
  const step = Math.ceil(points.length / 6)
  const dots = points.map((p, i) => `<circle class="dot" cx="${px(i)}" cy="${py(p.value)}" r="3"><title>${esc(`${p.label}: ${p.value}${unit}`)}</title></circle>${i % step === 0 ? `<text class="m" x="${px(i)}" y="${base + 14}" text-anchor="middle">${esc(p.label)}</text>` : ''}`).join('')
  const axis = `<line class="grid-line" x1="${left}" x2="${W}" y1="${base}" y2="${base}"/><line class="grid-line" x1="${left}" x2="${W}" y1="${base - plot}" y2="${base - plot}"/><text class="m" x="${left - 4}" y="${base - plot + 4}" text-anchor="end">${max}</text><text class="m" x="${left - 4}" y="${base + 4}" text-anchor="end">0</text>`
  const label = `${name}: ${points.map(p => `${p.label} ${p.value}${unit}`).join(', ')}`
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(label)}"><title>${esc(name)}</title>${axis}<path class="line" d="${path}"/>${dots}</svg>`
}

/** A half-circle gauge for a 0 to 100 number; null shows "no data". `target` is shown as text and sets the tone. */
export function gauge(value, { label, target = null, unit = '%' } = {}) {
  const has = typeof value === 'number' && Number.isFinite(value)
  const v = has ? Math.max(0, Math.min(100, value)) : 0
  const cx = 60, cy = 58, r = 46
  const at = f => { const a = Math.PI * (1 - f); return `${num(cx + r * Math.cos(a))} ${num(cy - r * Math.sin(a))}` }
  const tone = !has ? 'idle' : target === null ? 'accent' : value >= target ? 'pass' : 'warn'
  const track = `<path class="track" d="M${at(0)} A${r} ${r} 0 0 1 ${at(1)}"/>`
  const arc = has && v > 0 ? `<path class="arc t-${tone}" d="M${at(0)} A${r} ${r} 0 0 1 ${at(v / 100)}"/>` : ''
  const text = `<text class="big" x="${cx}" y="${cy - 8}">${has ? esc(`${value}${unit}`) : '—'}</text>`
  const sub = `<text class="m" x="${cx}" y="${cy + 12}" text-anchor="middle">${has ? (target === null ? '' : esc(`target ${target}${unit}`)) : 'no data'}</text>`
  const aria = `${label}: ${has ? `${value}${unit}` : 'no data'}${has && target !== null ? `, target ${target}${unit}` : ''}`
  return `<svg viewBox="0 0 120 76" role="img" aria-label="${esc(aria)}"><title>${esc(label)}</title>${track}${arc}${text}${sub}</svg><p class="note" style="text-align:center;margin:0">${esc(label)}</p>`
}
