// XRay test cases: the CSV rows the old warehouse harness wrote, the per-ticket files, and the script's CLI.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { XRAY_HEADERS, xrayOf } from '../../lib/base/config.mjs'
import { append, buildRows, caseError, casesIn, headerRow, main, parseCsv, readCases, toLine } from '../../bin/xray.mjs'

const IT = { ...XRAY_HEADERS, action: 'Azione', expected: 'Risultato atteso', priority: 'Piorità', component: 'Componenti', ticket: 'Ticket collegati', epic: 'Epica', data: 'Dati' }
const CASE = { key: 'Shows the empty message', summary: 'demo, "x"', description: 'When I filter:\n- nothing matches', feature: 'Giacenza_Prodotti', ticket: 'ABC-1', steps: [{ action: 'Open /stock', expected: 'grid, visible' }, { action: 'Filter', data: 'a, b', expected: 'ok' }] }
const col = c => Object.keys(XRAY_HEADERS).filter(k => k !== 'data').indexOf(c)

function project(xray = { csv: 'qa/cases.csv', folder: 'e2e/tickets/', headers: { action: 'Azione', expected: 'Risultato atteso', priority: 'Piorità', component: 'Componenti', ticket: 'Ticket collegati', epic: 'Epica', data: 'Dati' } }, files = {}) {
  const d = mkdtempSync(join(tmpdir(), 'qc-xray-'))
  const cfg = { version: 1, adapter: 'playwright', jira: { site: 'https://x.atlassian.net', projects: ['ABC'] }, ...(xray ? { xray } : {}) }
  for (const [p, s] of Object.entries({ '.claude/quality-code.json': JSON.stringify(cfg), 'package.json': '{}', ...files })) {
    mkdirSync(dirname(join(d, p)), { recursive: true })
    writeFileSync(join(d, p), s)
  }
  return d
}
async function run(d, ...argv) {
  let out = ''
  let err = ''
  const code = await main(argv, { CLAUDE_PROJECT_DIR: d }, d, { stdout: s => { out += s }, stderr: s => { err += s } })
  return { code, out, err }
}

test('one row per step: the metadata on the first row, Step on every row, data folded into the action', () => {
  const rows = buildRows(CASE, 7, IT)
  assert.equal(rows.length, 2)
  assert.equal(rows[0][col('tcid')], 7)
  assert.deepEqual([rows[0][col('step')], rows[1][col('step')]], [1, 2])
  assert.equal(rows[0][col('description')], 'When I filter:\n- nothing matches\n\nAutomated: Shows the empty message')
  assert.equal(rows[1][col('action')], 'Filter\nDati: a, b')
  assert.equal(rows[0][col('testType')], 'Cucumber')
  assert.equal(rows[0][col('component')], 'Giacenza_Prodotti')
  assert.ok(rows[1].slice(col('label')).every(c => c === ''), 'step rows leave the metadata blank')
  assert.ok(toLine(rows[0]).includes('"demo, ""x"""'))
  assert.ok(toLine(rows[1]).startsWith(',,,2,'))
})

test('a cell Excel would run as a formula is quoted with a leading apostrophe; bullets and numbers are not', () => {
  const rows = buildRows({ ...CASE, summary: '=HYPERLINK("x")', steps: [{ action: '@SUM(1)', expected: '-cmd|calc' }, { action: '- a bullet', expected: '-5 pieces' }] }, 1, XRAY_HEADERS)
  assert.equal(rows[0][col('summary')], `'=HYPERLINK("x")`)
  assert.equal(rows[0][col('action')], "'@SUM(1)")
  assert.equal(rows[0][col('expected')], "'-cmd|calc")
  assert.equal(rows[1][col('action')], '- a bullet')
  assert.equal(rows[1][col('expected')], '-5 pieces')
})

test('the CSV parser reads quoted commas, quotes, line breaks, CRLF and a BOM', () => {
  const rows = buildRows(CASE, 1, IT)
  const text = `﻿${[headerRow(IT), ...rows].map(toLine).join('\r\n')}\r\n`
  const back = parseCsv(text)
  assert.deepEqual(back[0], headerRow(IT))
  assert.deepEqual(back.slice(1), rows.map(r => r.map(String)))
  assert.deepEqual(casesIn(back.slice(1)), [{ key: 'Shows the empty message', ticket: 'ABC-1', tcid: 1 }])
})

test('a case must have a key on one line, a summary, a Jira key and steps with an action', () => {
  assert.equal(caseError(CASE), null)
  assert.match(caseError({ ...CASE, key: 'a\nb' }), /key must be the test's name, one line/)
  assert.match(caseError({ ...CASE, ticket: '../x' }), /ticket must be a Jira key/)
  assert.match(caseError({ ...CASE, steps: [] }), /at least one/)
  assert.match(caseError({ ...CASE, steps: [{ expected: 'x' }] }), /step 1 needs an action/)
  assert.match(caseError({ ...CASE, epic: 5 }), /epic must be text/)
})

test('append numbers cases per ticket, skips one already there, and keeps the old slug keys readable', () => {
  const old = [headerRow(IT), ...buildRows({ ...CASE, key: 'ABC-1-1-old-slug', ticket: 'ABC-1' }, 1, IT)].map(toLine).join('\n')
  const d = project(undefined, { 'qa/cases.csv': old }) // no newline at the end: append adds one
  const x = xrayOf({ ...JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')) })
  assert.deepEqual(append(d, x, [CASE, { ...CASE, ticket: 'ABC-2' }, CASE]), ['TC 2: Shows the empty message', 'TC 1: Shows the empty message', 'already there: Shows the empty message (delete its rows to write it again)'])
  assert.deepEqual(readCases(d, x).map(c => `${c.ticket} ${c.tcid} ${c.key}`), ['ABC-1 1 ABC-1-1-old-slug', 'ABC-1 2 Shows the empty message', 'ABC-2 1 Shows the empty message'])
})

test('a CSV whose header is not the configured columns is refused, nothing appended', () => {
  const d = project(undefined, { 'qa/cases.csv': `${toLine(headerRow(XRAY_HEADERS))}\n` })
  const x = xrayOf(JSON.parse(readFileSync(join(d, '.claude/quality-code.json'), 'utf8')))
  assert.throws(() => append(d, x, [CASE]), /has the columns .* the config's xray.headers make/)
  assert.equal(readFileSync(join(d, 'qa/cases.csv'), 'utf8'), `${toLine(headerRow(XRAY_HEADERS))}\n`)
})

test('add: creates the CSV, writes the ticket case.csv, says there is no case.xlsx without exceljs', async () => {
  const d = project()
  writeFileSync(join(d, 'cases.json'), JSON.stringify([CASE, { ...CASE, key: 'Extra: a long code', steps: [{ action: 'Type 250 Z' }] }]))
  const r = await run(d, 'add', '@cases.json')
  assert.equal(r.code, 0, r.err)
  assert.equal(r.out, 'XRay test cases in qa/cases.csv:\nTC 1: Shows the empty message\nTC 2: Extra: a long code\nFor QA: e2e/tickets/ABC-1/case.csv\nNo exceljs in this project, so no case.xlsx: Xray imports case.csv as well.\n')
  assert.equal(readFileSync(join(d, 'e2e/tickets/ABC-1/case.csv'), 'utf8'), readFileSync(join(d, 'qa/cases.csv'), 'utf8'))
  assert.equal(existsSync(join(d, 'e2e/tickets/ABC-1/case.xlsx')), false)
})

test('add: one bad case writes nothing; bad JSON, usage and a missing xray block exit 2', async () => {
  const d = project()
  const r = await run(d, 'add', JSON.stringify([CASE, { ...CASE, ticket: 'nope' }]))
  assert.equal(r.code, 2)
  assert.match(r.err, /case 2 \(Shows the empty message\): ticket must be a Jira key like ABC-123\nNothing was written\./)
  assert.equal(existsSync(join(d, 'qa/cases.csv')), false)
  assert.equal((await run(d, 'add', '{nope')).code, 2)
  assert.equal((await run(d, 'add')).code, 2)
  assert.equal((await run(d, 'sync', '../x')).code, 2)
  const off = await run(project(null), 'add', JSON.stringify(CASE))
  assert.equal(off.code, 2)
  assert.match(off.err, /XRay test cases are off in this project/)
})

test('sync rewrites one ticket or all from the CSV; a ticket that is not a Jira key gets no folder', async () => {
  const rows = [headerRow(IT), ...buildRows(CASE, 1, IT), ...buildRows({ ...CASE, ticket: 'ABC-2' }, 1, IT), ...buildRows({ ...CASE, ticket: '../evil' }, 1, IT)]
  const d = project(undefined, { 'qa/cases.csv': `${rows.map(toLine).join('\n')}\n` })
  const all = await run(d, 'sync')
  assert.equal(all.code, 0, all.err)
  assert.match(all.out, /For QA: e2e\/tickets\/ABC-1\/case\.csv\nFor QA: e2e\/tickets\/ABC-2\/case\.csv\nskipped "\.\.\/evil": not a Jira key/)
  assert.equal(existsSync(join(d, 'e2e/evil')), false)
  assert.match((await run(d, 'sync', 'ABC-9')).out, /No XRay test case for ABC-9/)
  assert.match((await run(project(), 'sync')).out, /No XRay test cases yet: qa\/cases\.csv does not exist/)
})

test('the folder defaults to the tickets folder', () => {
  assert.deepEqual(xrayOf({ xray: { csv: 'a.csv' } }), { csv: 'a.csv', folder: '.claude/quality-code/tickets/', headers: XRAY_HEADERS })
  assert.equal(xrayOf({ ticketsDir: 'qc/t/', xray: { csv: 'a.csv' } }).folder, 'qc/t/')
  assert.equal(xrayOf({}), null)
})

// exceljs is the project's, not the plugin's: set QC_EXCELJS_NODE_MODULES to a node_modules that has it.
const EXCEL = [process.env.QC_EXCELJS_NODE_MODULES].find(p => p && existsSync(join(p, 'exceljs')))
test('with the project\'s exceljs, case.xlsx is written next to case.csv', { skip: !EXCEL && 'set QC_EXCELJS_NODE_MODULES to run it' }, async () => {
  const d = project()
  symlinkSync(EXCEL, join(d, 'node_modules'))
  const r = await run(d, 'add', JSON.stringify(CASE))
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /For QA: e2e\/tickets\/ABC-1\/case\.xlsx and e2e\/tickets\/ABC-1\/case\.csv\n$/)
  assert.ok(readFileSync(join(d, 'e2e/tickets/ABC-1/case.xlsx')).subarray(0, 2).equals(Buffer.from('PK')), 'an xlsx is a zip')
})
