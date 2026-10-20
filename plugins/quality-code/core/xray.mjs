#!/usr/bin/env node
// XRay test cases for QA, the way the old in-repo harness wrote them: one CSV with every case (the
// traceability record), and per ticket a case.csv plus, when the project has exceljs, a styled
// case.xlsx. Xray imports either (Test Repository, Import, Excel or CSV). One row per step: a case's
// first row carries TC ID and the metadata, its next rows leave them blank. TC ID is numbered per
// ticket; the Playwright test a case belongs to is the "Automated: <test name>" line of its Description.
//   node core/xray.mjs add <json|@file>   one case or a list of cases, then the ticket's files
//   node core/xray.mjs sync [KEY]         rebuild the per-ticket files from the CSV
// A case: { key, summary, ticket, steps: [{ action, data?, expected? }], description?, feature?,
//           label?, priority?, epic?, testType? }   key is the Playwright test's name.
// Exit 0 done, 2 usage, config or input error.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { XRAY_COLUMNS, loadConfig, projectRoot, xrayOf } from './config.mjs'

const TICKET = /^[A-Z][A-Z0-9]+-\d+$/
const AUTOMATED = /^Automated:[ \t]*(.+?)[ \t]*$/m
// A cell Excel would run as a formula when it opens the CSV. Ticket text is anyone's text.
const FORMULA = /^[=+@\t\r]|^-(?=[^\s\d])/
const safe = v => (typeof v === 'string' && FORMULA.test(v) ? `'${v}` : v)
const esc = v => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toLine = cells => cells.map(esc).join(',')
export const headerRow = headers => XRAY_COLUMNS.map(c => headers[c])

/** RFC 4180 CSV to rows of text cells: quoted cells may hold commas, quotes and line breaks. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch !== '"') cell += ch
      else if (s[i + 1] === '"') { cell += '"'; i++ }
      else quoted = false
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

/** What is wrong with one case, or null. */
export function caseError(tc, i = 0) {
  const at = `case ${i + 1}`
  if (!tc || typeof tc !== 'object' || Array.isArray(tc)) return `${at}: must be an object`
  if (typeof tc.key !== 'string' || !tc.key.trim() || /[\r\n]/.test(tc.key)) return `${at}: key must be the test's name, one line`
  if (typeof tc.summary !== 'string' || !tc.summary.trim()) return `${at} (${tc.key}): summary must be a non-empty text`
  if (typeof tc.ticket !== 'string' || !TICKET.test(tc.ticket)) return `${at} (${tc.key}): ticket must be a Jira key like ABC-123`
  if (!Array.isArray(tc.steps) || !tc.steps.length) return `${at} (${tc.key}): steps must list at least one { action, expected }`
  for (const [j, s] of tc.steps.entries()) {
    if (!s || typeof s.action !== 'string' || !s.action.trim()) return `${at} (${tc.key}): step ${j + 1} needs an action`
    for (const f of ['data', 'expected']) if (s[f] !== undefined && typeof s[f] !== 'string') return `${at} (${tc.key}): step ${j + 1} ${f} must be text`
  }
  for (const f of ['description', 'feature', 'label', 'priority', 'epic', 'testType']) if (tc[f] !== undefined && typeof tc[f] !== 'string') return `${at} (${tc.key}): ${f} must be text`
  return null
}

/** The CSV rows of one case: one per step, the metadata on the first row only, Step on every row. */
export function buildRows(tc, tcid, headers) {
  const action = s => (s.data ? `${s.action}\n${headers.data}: ${s.data}` : s.action)
  const description = [tc.description, `Automated: ${tc.key}`].filter(Boolean).join('\n\n')
  const first = { tcid, summary: tc.summary, description, label: tc.label, priority: tc.priority, component: tc.feature, ticket: tc.ticket, epic: tc.epic, testType: tc.testType || 'Cucumber' }
  return tc.steps.map((s, i) => {
    const v = { ...(i === 0 ? first : {}), step: i + 1, action: action(s), expected: s.expected ?? '' }
    return XRAY_COLUMNS.map(c => safe(v[c] ?? ''))
  })
}

/** The CSV's rows; throws when its header is not the config's columns (rows would land in the wrong ones). */
export function readCsv(path, headers) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const want = headerRow(headers)
  if ((rows[0] ?? []).join(',') !== want.join(',')) throw new Error(`${path} has the columns ${JSON.stringify((rows[0] ?? []).join(','))}, the config's xray.headers make ${JSON.stringify(want.join(','))}`)
  return rows.slice(1).filter(r => r.some(c => String(c).trim()))
}

/** Rows grouped by ticket: a step row belongs to the ticket of the case above it. */
function byTicket(rows) {
  const at = XRAY_COLUMNS.indexOf('ticket')
  const map = new Map()
  let current = null
  for (const r of rows) {
    if (String(r[at] ?? '').trim()) current = String(r[at]).trim()
    if (!current) continue
    if (!map.has(current)) map.set(current, [])
    map.get(current).push(r)
  }
  return map
}

/** Each case in the rows: its test name (from "Automated:"), its ticket and its TC ID. */
export function casesIn(rows) {
  const [d, t, id] = ['description', 'ticket', 'tcid'].map(c => XRAY_COLUMNS.indexOf(c))
  const out = []
  for (const [ticket, rs] of byTicket(rows)) for (const r of rs) {
    const key = String(r[d] ?? '').match(AUTOMATED)?.[1]
    if (key) out.push({ key, ticket: String(r[t] ?? '').trim() || ticket, tcid: Number.parseInt(String(r[id]), 10) })
  }
  return out
}

/** The cases of the project's XRay CSV, or [] when it does not exist yet. */
export function readCases(root, x) {
  const p = join(root, x.csv)
  return existsSync(p) ? casesIn(readCsv(p, x.headers)) : []
}

/** Appends the cases not yet in the CSV (same ticket and test name); returns a line per case. */
export function append(root, x, cases) {
  const p = join(root, x.csv)
  if (!existsSync(p)) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, `${toLine(headerRow(x.headers))}\n`)
  }
  let rows = readCsv(p, x.headers)
  if (!readFileSync(p, 'utf8').endsWith('\n')) appendFileSync(p, '\n')
  return cases.map(tc => {
    const known = casesIn(rows)
    if (known.some(c => c.ticket === tc.ticket && c.key === tc.key)) return `already there: ${tc.key} (delete its rows to write it again)`
    const tcid = Math.max(0, ...known.filter(c => c.ticket === tc.ticket && Number.isInteger(c.tcid)).map(c => c.tcid)) + 1
    const add = buildRows(tc, tcid, x.headers)
    appendFileSync(p, `${add.map(toLine).join('\n')}\n`)
    rows = rows.concat(add.map(r => r.map(String)))
    return `TC ${tcid}: ${tc.key}`
  })
}

/** exceljs from the project's own node_modules, or null: the plugin brings no packages. */
async function excel(root) {
  try {
    const m = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('exceljs')).href)
    return m.default ?? m
  } catch {
    return null
  }
}

/** The per-ticket workbook: frozen bold header, filter, wrapped cells, borders, a band per case. */
async function writeXlsx(ExcelJS, rows, headers, path) {
  const GRID = { style: 'thin', color: { argb: 'FFBFBFBF' } }
  const box = { top: GRID, left: GRID, bottom: GRID, right: GRID }
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const width = c => (c === 'description' ? 60 : c === 'action' || c === 'expected' ? 44 : c === 'testType' ? 14 : 18)
  const tcidCol = XRAY_COLUMNS.indexOf('tcid') + 1
  const typeCol = XRAY_COLUMNS.indexOf('testType') + 1
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Test Cases', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = XRAY_COLUMNS.map(c => ({ header: headers[c], width: width(c) }))
  const head = ws.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = fill('FF1F4E78')
  head.alignment = { vertical: 'middle', wrapText: true }
  head.height = 22
  head.eachCell(c => { c.border = box })
  let shade = false
  for (const cells of rows) {
    const start = String(cells[tcidCol - 1] ?? '').trim() !== ''
    if (start) shade = !shade
    const row = ws.addRow(cells.map((v, i) => (i === tcidCol - 1 || XRAY_COLUMNS[i] === 'step') && /^\d+$/.test(String(v)) ? Number(v) : v))
    row.alignment = { vertical: 'top', wrapText: true }
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = box
      if (shade) cell.fill = fill('FFF2F6FB')
      if (col === tcidCol && start) cell.font = { bold: true }
      if (col === typeCol && String(cell.value ?? '').trim()) cell.fill = fill('FFE2EFDA')
    })
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: XRAY_COLUMNS.length } }
  await wb.xlsx.writeFile(path)
}

/** Rewrites <folder><KEY>/case.csv (and case.xlsx with exceljs) for one ticket, or every ticket. */
export async function sync(root, x, only = null) {
  const p = join(root, x.csv)
  if (!existsSync(p)) return [`No XRay test cases yet: ${x.csv} does not exist.`]
  const groups = byTicket(readCsv(p, x.headers))
  const keys = only ? [only] : [...groups.keys()]
  const ExcelJS = await excel(root)
  const lines = []
  for (const key of keys) {
    if (!TICKET.test(key)) { lines.push(`skipped ${JSON.stringify(key)}: not a Jira key`); continue }
    const rows = groups.get(key)
    if (!rows) { lines.push(`No XRay test case for ${key} in ${x.csv}.`); continue }
    const dir = join(x.folder, key).replace(/\\/g, '/')
    mkdirSync(join(root, dir), { recursive: true })
    writeFileSync(join(root, dir, 'case.csv'), `${[headerRow(x.headers), ...rows].map(toLine).join('\n')}\n`)
    if (ExcelJS) await writeXlsx(ExcelJS, rows, x.headers, join(root, dir, 'case.xlsx'))
    lines.push(`For QA: ${ExcelJS ? `${dir}/case.xlsx and ` : ''}${dir}/case.csv`)
  }
  if (!ExcelJS && lines.some(l => l.startsWith('For QA'))) lines.push('No exceljs in this project, so no case.xlsx: Xray imports case.csv as well.')
  return lines
}

export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const [cmd, arg, ...extra] = argv
  const usage = () => { stderr('usage: xray.mjs add <json|@file> | sync [KEY]\n'); return 2 }
  if (extra.length || !['add', 'sync'].includes(cmd) || (cmd === 'add' && !arg) || (cmd === 'sync' && arg && !TICKET.test(arg))) return usage()
  const root = projectRoot(env, cwd)
  const c = loadConfig(root)
  if (!c.ok) { stderr(`${c.errors.join('\n')}\n`); return 2 }
  const x = xrayOf(c.config)
  if (!x) { stderr('XRay test cases are off in this project: add an "xray" block to .claude/quality-code.json (README, "XRay test cases").\n'); return 2 }
  try {
    if (cmd === 'sync') { stdout(`${(await sync(root, x, arg ?? null)).join('\n')}\n`); return 0 }
    let input
    try { input = JSON.parse(arg.startsWith('@') ? readFileSync(resolve(root, arg.slice(1)), 'utf8') : arg) } catch (e) { stderr(`not valid JSON: ${String(e.message).split('\n')[0]}\n`); return 2 }
    const cases = Array.isArray(input) ? input : [input]
    const errors = cases.map(caseError).filter(Boolean)
    if (!cases.length) errors.push('no case given')
    if (errors.length) { stderr(`${errors.join('\n')}\nNothing was written.\n`); return 2 }
    const lines = append(root, x, cases)
    for (const t of new Set(cases.map(tc => tc.ticket))) lines.push(...(await sync(root, x, t)))
    stdout(`XRay test cases in ${x.csv}:\n${lines.join('\n')}\n`)
    return 0
  } catch (e) {
    stderr(`${String(e.message).split('\n')[0]}\n`)
    return 2
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exitCode = await main()
