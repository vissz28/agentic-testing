#!/usr/bin/env node
// Xray test cases: a master CSV plus per-ticket case.csv/case.xlsx. One row per step, metadata on the first.
// A case links to its Playwright test via the "Automated: <test name>" line. Exit 0 done, 2 usage/config/input error.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { XRAY_COLUMNS, loadConfig, projectRoot, xrayOf } from '../lib/config/config.mjs'
import { isMain, tag, lineWriter } from '../lib/core/script-io.mjs'
import { readJsonOr } from '../lib/core/files.mjs'
import { toForwardSlashes, plural } from '../lib/core/text.mjs'
import { isLine, isObject } from '../lib/core/is.mjs'

const TICKET = /^[A-Z][A-Z0-9_]+-\d+$/
// Anchored to the cell's last line (buildRows puts it there) so a description line starting "Automated:" isn't taken.
const AUTOMATED = /(?:^|\n)Automated:[ \t]*([^\n]*?\S)\s*$/
// CSV formula injection: ticket text is untrusted. A leading "-" is safe unless an operator follows (-2+3+cmd|' /C calc'!A0).
const FORMULA = /^[=+@\t\r]|^-[\s\S]*[=+*/^&|!(@]/
const safe = v => (typeof v === 'string' && FORMULA.test(v) ? `'${v}` : v)
const esc = v => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toLine = cells => cells.map(esc).join(',')
const TCID = XRAY_COLUMNS.indexOf('tcid')
export const headerRow = headers => XRAY_COLUMNS.map(c => headers[c])

// RFC 4180: quoted cells may hold commas, quotes and line breaks.
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

export function caseError(tc, i = 0) {
  const at = `case ${i + 1}`
  if (!isObject(tc)) return `${at}: must be an object`
  if (!isLine(tc.key)) return `${at}: key must be the test's name, one line`
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

export function buildRows(tc, tcid, headers) {
  const action = s => (s.data ? `${s.action}\n${headers.data}: ${s.data}` : s.action)
  const description = [tc.description, `Automated: ${tc.key}`].filter(Boolean).join('\n\n')
  const first = { tcid, summary: tc.summary, description, label: tc.label, priority: tc.priority, component: tc.feature, ticket: tc.ticket, epic: tc.epic, testType: tc.testType || 'Cucumber' }
  return tc.steps.map((s, i) => {
    const v = { ...(i === 0 ? first : {}), step: i + 1, action: action(s), expected: s.expected ?? '' }
    return XRAY_COLUMNS.map(c => safe(v[c] ?? ''))
  })
}

// Throws on a header mismatch, else rows would land in the wrong columns.
export function readCsv(path, headers) {
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const want = headerRow(headers)
  if ((rows[0] ?? []).join(',') !== want.join(',')) throw new Error(`${path} has the columns ${JSON.stringify((rows[0] ?? []).join(','))}, the config's xray.headers make ${JSON.stringify(want.join(','))}`)
  return rows.slice(1).filter(r => r.some(c => String(c).trim()))
}

// Step rows have a blank ticket and belong to the case above.
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

export function casesIn(rows) {
  const [d, t, id] = ['description', 'ticket', 'tcid'].map(c => XRAY_COLUMNS.indexOf(c))
  const out = []
  for (const [ticket, rs] of byTicket(rows)) for (const r of rs) {
    const key = String(r[d] ?? '').match(AUTOMATED)?.[1]
    if (key) out.push({ key, ticket: String(r[t] ?? '').trim() || ticket, tcid: Number.parseInt(String(r[id]), 10) })
  }
  return out
}

export function readCases(root, x) {
  const p = join(root, x.csv)
  return existsSync(p) ? casesIn(readCsv(p, x.headers)) : []
}

// Skips cases already present (same ticket and test name).
export function append(root, x, cases) {
  const p = join(root, x.csv)
  if (!existsSync(p) || !readFileSync(p, 'utf8').trim()) {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, `${toLine(headerRow(x.headers))}\n`)
  }
  let rows = readCsv(p, x.headers)
  if (!readFileSync(p, 'utf8').endsWith('\n')) appendFileSync(p, '\n')
  return cases.map(tc => {
    const known = casesIn(rows)
    if (known.some(c => c.ticket === tc.ticket && c.key === tc.key)) return `already there: ${tc.key} (delete its rows to write it again)`
    // Count hand-written cases (no "Automated:") too.
    const tcid = Math.max(0, ...(byTicket(rows).get(tc.ticket) ?? []).map(r => Number.parseInt(String(r[TCID]), 10)).filter(Number.isInteger)) + 1
    const add = buildRows(tc, tcid, x.headers)
    appendFileSync(p, `${add.map(toLine).join('\n')}\n`)
    rows = rows.concat(add.map(r => r.map(String)))
    return `TC ${tcid}: ${tc.key}`
  })
}

// The plugin ships no packages: use the project's exceljs if it has one.
async function excel(root) {
  try {
    const m = await import(pathToFileURL(createRequire(join(root, 'package.json')).resolve('exceljs')).href)
    return m.default ?? m
  } catch {
    return null
  }
}

async function writeXlsx(ExcelJS, rows, headers, path) {
  const GRID = { style: 'thin', color: { argb: 'FFBFBFBF' } }
  const box = { top: GRID, left: GRID, bottom: GRID, right: GRID }
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const WIDTH = { description: 60, action: 44, expected: 44, testType: 14 }
  const width = c => WIDTH[c] ?? 18
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

export async function sync(root, x, only = null) {
  const p = join(root, x.csv)
  if (!existsSync(p)) return [`No Xray test cases yet: ${x.csv} does not exist.`]
  const groups = byTicket(readCsv(p, x.headers))
  const keys = only ? [only] : [...groups.keys()]
  const ExcelJS = await excel(root)
  const lines = []
  for (const key of keys) {
    if (!TICKET.test(key)) { lines.push(`skipped ${JSON.stringify(key)}: not a Jira key`); continue }
    const rows = groups.get(key)
    if (!rows) { lines.push(`No Xray test case for ${key} in ${x.csv}.`); continue }
    const dir = toForwardSlashes(join(x.folder, key))
    mkdirSync(resolve(root, dir), { recursive: true })
    writeFileSync(resolve(root, dir, 'case.csv'), `${[headerRow(x.headers), ...rows].map(toLine).join('\n')}\n`)
    if (ExcelJS) await writeXlsx(ExcelJS, rows, x.headers, resolve(root, dir, 'case.xlsx'))
    lines.push(`For QA: ${ExcelJS ? `${dir}/case.xlsx and ` : ''}${dir}/case.csv`)
  }
  if (!ExcelJS && lines.some(l => l.startsWith('For QA'))) lines.push('No exceljs in this project, so no case.xlsx: Xray imports case.csv as well.')
  return lines
}

// { "<case name>": "<test key>" }, so no case is created in Xray twice.
export function createdOf(root, x, key) {
  return readJsonOr(resolve(root, x.folder, key, 'xray-created.json'), {})
}

// Any thrown error (e.g. a broken saved file) exits 2 with its message, not a stack trace.
export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), io = {}) {
  try { return await handle(argv, env, cwd, io) } catch (e) { (io.stderr ?? (s => process.stderr.write(s)))(`xray.mjs: ${e?.message ?? e}\n`); return 2 }
}

async function handle(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  if (argv[0] === 'created') {
    const [, key, verb, name, testKey, ...more] = argv
    const bad = !TICKET.test(key ?? '') || more.length || (verb !== undefined && (verb !== 'add' || !isLine(name) || !TICKET.test(testKey ?? '')))
    if (bad) { printError('usage: xray.mjs created <KEY> [add "<case name>" <TEST KEY>]'); return 2 }
    const root = projectRoot(env, cwd)
    const c = loadConfig(root, env)
    if (!c.ok) { printError(c.errors.join('\n')); return 2 }
    const x = xrayOf(c.config, c.source)
    if (!x) { printError('Xray test cases are off in this project: add an "xray" block to the project config.json (docs/GUIDE.md, "Xray test cases").'); return 2 }
    const created = createdOf(root, x, key)
    if (verb === 'add') {
      created[name.trim()] = testKey
      mkdirSync(resolve(root, x.folder, key), { recursive: true })
      writeFileSync(resolve(root, x.folder, key, 'xray-created.json'), `${JSON.stringify(created, null, 2)}\n`)
    }
    printLine(`${plural(Object.keys(created).length, 'case')} of ${key} created in Xray\n${tag('XRAY_CREATED', { key, created })}`)
    return 0
  }
  const [cmd, arg, ...extra] = argv
  const usage = () => { printError('usage: xray.mjs add <json|@file> | sync [KEY] | created <KEY> [add "<case name>" <TEST KEY>]'); return 2 }
  if (extra.length || !['add', 'sync'].includes(cmd) || (cmd === 'add' && !arg) || (cmd === 'sync' && arg && !TICKET.test(arg))) return usage()
  const root = projectRoot(env, cwd)
  const c = loadConfig(root, env)
  if (!c.ok) { printError(c.errors.join('\n')); return 2 }
  const x = xrayOf(c.config, c.source)
  if (!x) { printError('Xray test cases are off in this project: add an "xray" block to the project config.json (docs/GUIDE.md, "Xray test cases").'); return 2 }
  try {
    if (cmd === 'sync') { printLine((await sync(root, x, arg ?? null)).join('\n')); return 0 }
    let input
    try { input = JSON.parse(arg.startsWith('@') ? readFileSync(resolve(root, arg.slice(1)), 'utf8') : arg) } catch (e) { printError(`not valid JSON: ${String(e.message).split('\n')[0]}`); return 2 }
    const given = Array.isArray(input) ? input : [input]
    const errors = given.map(caseError).filter(Boolean)
    if (!given.length) errors.push('no case given')
    if (errors.length) { printError(`${errors.join('\n')}\nNothing was written.`); return 2 }
    // CSV reads keys back trimmed; store them trimmed or the same case is added twice.
    const cases = given.map(tc => ({ ...tc, key: tc.key.trim() }))
    const lines = append(root, x, cases)
    for (const t of new Set(cases.map(tc => tc.ticket))) lines.push(...(await sync(root, x, t)))
    printLine(`Xray test cases in ${x.csv}:\n${lines.join('\n')}`)
    return 0
  } catch (e) {
    printError(String(e.message).split('\n')[0])
    return 2
  }
}

if (isMain(import.meta.url)) process.exitCode = await main()
