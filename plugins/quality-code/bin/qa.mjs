#!/usr/bin/env node
// What /quality-code:qa leaves to a script: the JQL of the tester's runs, the progress of a run (kept between sessions),
// where the screenshot of a failing step goes, which status name a verdict maps to, and which stories are ready to retest.
// The agent follows the test steps in the browser and talks to Jira and Xray; every decision that is a rule is made here.
//   node bin/qa.mjs config
//   node bin/qa.mjs jql runs | jql watch
//   node bin/qa.mjs app get | app set <url>
//   node bin/qa.mjs state show <RUN> [--tests K1,K2,...]
//   node bin/qa.mjs state record <RUN> <TEST> ok|ko|blocked|skipped [--note TEXT] [--step N] [--evidence PATH] [--defect KEY] [--run-id ID] [--xray set] [--story KEY]
//   node bin/qa.mjs state close <RUN> ko|ok|open | state reset <RUN>
//   node bin/qa.mjs evidence <RUN> <TEST> [--step N]
//   node bin/qa.mjs pick ok|ko|blocked --from "A,B,C"            (an Xray status name for a verdict)
//   node bin/qa.mjs pick run-ko|run-done --from "A,B,C"          (a Jira transition for a run or story)
//   node bin/qa.mjs watch fresh --found K1,K2
// Exit 0 done, 2 usage or config error. Progress lives in <audit folder>/qa/ (ignored by git); in the chat place, in a temp folder.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, projectRoot, qaOf } from '../lib/config/config.mjs'
import { isMain, lineWriter } from '../lib/core/script-io.mjs'
import { isTicketKey } from '../lib/core/text.mjs'
import { readJsonOr, tryReadJson } from '../lib/core/files.mjs'

const VERDICTS = ['ok', 'ko', 'blocked', 'skipped']
const TEST_ID = /^[A-Za-z0-9_.-]{1,64}$/
const USAGE = 'usage: qa.mjs config | jql runs|watch | app get|set <url> | state show|record|close|reset <RUN> … | evidence <RUN> <TEST> [--step N] | pick ok|ko|blocked|run-ko|run-done --from "A,B" | watch fresh --found K1,K2'

/** The JQL of the tester's open test executions. */
export function runsJql(qa) {
  const types = qa.executionTypes.map(t => `"${t}"`).join(', ')
  return `assignee = currentUser() AND issuetype in (${types}) AND statusCategory != Done${qa.sprint === 'open' ? ' AND sprint in openSprints()' : ''} ORDER BY Rank ASC, updated DESC`
}

/** The tests answered one after the other: how many blocked tests end the list, and whether the run should stop. */
export function stopCheck(tests, blockedStop) {
  const order = Object.values(tests).sort((a, b) => b.n - a.n)
  let blockedInARow = 0
  for (const t of order) { if (t.verdict !== 'blocked') break; blockedInARow++ }
  return { blockedInARow, stopSuggested: blockedStop > 0 && blockedInARow >= blockedStop }
}

/** One Xray status name for a verdict, from the names the Xray has: exactly one match is a pick, else ask. */
export function pickXray(verdict, names) {
  const re = { ok: /^pass/i, ko: /^fail/i, blocked: /^block/i }[verdict]
  let hits = names.filter(n => re.test(n))
  if (verdict === 'blocked' && !hits.length) hits = names.filter(n => /^abort/i.test(n))
  return hits.length === 1 ? { pick: hits[0], ask: false, candidates: hits, source: 'name' } : { pick: null, ask: true, candidates: hits.length ? hits : names, source: null }
}

/** One Jira transition for a run or story: the configured name when the issue offers it, else the one name that reads as KO. */
export function pickTransition(kind, names, statuses) {
  const own = kind === 'run-ko' ? statuses.ko : statuses.done
  const exact = own && names.find(n => n.toLowerCase() === own.toLowerCase())
  if (exact) return { pick: exact, ask: false, candidates: [exact], source: 'config' }
  if (own) return { pick: null, ask: true, candidates: names, source: null, missing: own }
  if (kind === 'run-ko') {
    const hits = names.filter(n => /\bko\b|fail/i.test(n))
    if (hits.length === 1) return { pick: hits[0], ask: false, candidates: hits, source: 'name' }
    return { pick: null, ask: true, candidates: hits.length ? hits : names, source: null }
  }
  return { pick: null, ask: true, candidates: names, source: null }
}

function write(dir, name, value) {
  mkdirSync(dir, { recursive: true })
  try { writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' }) } catch {}
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`)
}

/** Any error a step throws (a broken saved file, named in the message) ends the command with exit 2, never a stack trace. */
export async function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), io = {}) {
  try { return await handle(argv, env, cwd, io) } catch (e) { (io.stderr ?? (s => process.stderr.write(s)))(`qa.mjs: ${e?.message ?? e}\n`); return 2 }
}

async function handle(argv = process.argv.slice(2), env = process.env, cwd = process.cwd(), { stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s), now = () => new Date().toISOString() } = {}) {
  const printError = lineWriter(stderr)
  const err = m => { printError(m); return 2 }
  const flags = {}
  const pos = []
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x.startsWith('--')) {
      const v = argv[++i]
      if (v === undefined || (v.startsWith('--') && v.length > 2)) return err(`${x} needs a value. ${USAGE}`)
      flags[x.slice(2)] = v
    } else pos.push(x)
  }
  const [cmd, sub, ...rest] = pos
  const root = projectRoot(env, cwd)
  const c = loadConfig(root, env)
  if (!c.ok) return err(c.errors.join('\n'))
  const qa = qaOf(c.config)
  const dir = c.auditDir ? join(c.auditDir, 'qa') : join(tmpdir(), `quality-code-qa-${createHash('sha1').update(root).digest('hex').slice(0, 10)}`)
  const runFile = run => join(dir, `${run}.json`)
  const load = run => readJsonOr(runFile(run), null) ?? { run, story: null, app: null, closed: 'open', startedAt: now(), tests: {} }
  const out = (line, json) => stdout(`${line ? `${line}\n` : ''}${json ? `${json.tag}:${JSON.stringify(json.data)}\n` : ''}`)

  if (cmd === 'config' && !sub) { out('', { tag: 'QA_JSON', data: { ...qa, dir } }); return 0 }

  if (cmd === 'jql') {
    if (sub === 'runs') { out(runsJql(qa), { tag: 'QA_JQL_JSON', data: { jql: runsJql(qa), sprint: qa.sprint } }); return 0 }
    if (sub === 'watch') {
      if (!qa.statuses.ready) return err('qa --watch needs the name of the "ready to test" status: set qa.statuses.ready in the project config.json (for example "Ready to test").')
      const targets = (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.json') && isTicketKey(f.slice(0, -'.json'.length))).map(f => tryReadJson(join(dir, f), null)).filter(s => s?.closed === 'ko' && s.story)
      const stories = [...new Set(targets.map(s => s.story))]
      const jql = stories.length ? `key in (${stories.join(', ')}) AND status = "${qa.statuses.ready}"` : null
      out(jql ?? 'Nothing to watch: no closed run with a failed test.', { tag: 'QA_WATCH_JSON', data: { jql, stories, runs: Object.fromEntries(targets.map(s => [s.story, s.run])) } })
      return 0
    }
    return err(USAGE)
  }

  if (cmd === 'app') {
    const f = join(dir, 'app.json')
    if (sub === 'get') {
      const last = tryReadJson(f, null)?.app ?? null
      out(qa.app ?? last ?? 'none', { tag: 'QA_APP_JSON', data: { app: qa.app ?? last, source: qa.app ? 'config' : last ? 'last run' : null } })
      return 0
    }
    if (sub === 'set') {
      const [url] = rest
      if (!url || rest.length > 1 || !/^https?:\/\/[^\s]+$/.test(url)) return err('app set needs the address of the app, starting with http:// or https://')
      write(dir, 'app.json', { app: url, at: now() })
      out('ok')
      return 0
    }
    return err(USAGE)
  }

  if (cmd === 'evidence') {
    const [run, test] = [sub, rest[0]]
    const step = flags.step ?? '1'
    if (!isTicketKey(run) || !TEST_ID.test(test ?? '') || !/^[1-9]\d{0,3}$/.test(step) || rest.length > 1) return err('usage: qa.mjs evidence <RUN> <TEST KEY> [--step N]')
    const folder = join(dir, 'evidence', run)
    mkdirSync(folder, { recursive: true })
    try { writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' }) } catch {}
    const path = join(folder, `${test}-step${step}.png`)
    out(path, { tag: 'QA_EVIDENCE_JSON', data: { path } })
    return 0
  }

  if (cmd === 'pick') {
    const names = String(flags.from ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (!names.length) return err('pick needs --from "A,B,C", the names to choose from')
    let r
    if (['ok', 'ko', 'blocked'].includes(sub)) r = pickXray(sub, names)
    else if (['run-ko', 'run-done'].includes(sub)) r = pickTransition(sub, names, qa.statuses)
    else return err(USAGE)
    out(r.pick ? `pick: ${r.pick}` : `ask: ${r.candidates.join(', ')}`, { tag: 'QA_PICK_JSON', data: r })
    return 0
  }

  if (cmd === 'state') {
    const run = rest[0] ?? ''
    if (!isTicketKey(run)) return err(`state ${sub ?? ''} needs the run key, like ABC-123. ${USAGE}`)
    const s = load(run)
    if (sub === 'show') {
      const order = String(flags.tests ?? '').split(',').map(x => x.trim()).filter(Boolean)
      const answered = Object.keys(s.tests)
      const counts = Object.fromEntries(VERDICTS.map(v => [v, answered.filter(k => s.tests[k].verdict === v).length]))
      const pending = order.filter(k => !s.tests[k])
      const data = { run, story: s.story, app: s.app, closed: s.closed, startedAt: s.startedAt, counts, answered: answered.length, pending, tests: s.tests, ...stopCheck(s.tests, qa.blockedStop), exists: existsSync(runFile(run)) }
      out(data.exists ? `${run}: ${answered.length} answered (${counts.ok} passed, ${counts.ko} failed, ${counts.blocked} blocked, ${counts.skipped} skipped)${order.length ? `, ${pending.length} still to do` : ''}` : `${run}: no saved progress`, { tag: 'QA_STATE_JSON', data })
      return 0
    }
    if (sub === 'record') {
      const [, test, verdict] = rest
      if (!TEST_ID.test(test ?? '') || !VERDICTS.includes(verdict) || rest.length > 3) return err(`usage: qa.mjs state record <RUN> <TEST KEY> ${VERDICTS.join('|')} [--note TEXT] [--step N] [--evidence PATH] [--defect KEY] [--run-id ID] [--xray set] [--story KEY]`)
      if (flags.defect && !isTicketKey(flags.defect)) return err('--defect must be a Jira key, like ABC-124')
      if (flags.story && !isTicketKey(flags.story)) return err('--story must be a Jira key, like ABC-100')
      if (flags.step && !/^[1-9]\d{0,3}$/.test(flags.step)) return err('--step must be a step number')
      if (flags.xray && flags.xray !== 'set') return err('--xray takes only "set"')
      const before = s.tests[test]
      s.tests[test] = {
        ...(before ?? {}),
        verdict,
        n: Math.max(0, ...Object.values(s.tests).map(t => t.n ?? 0)) + 1,
        at: now(),
        ...(flags.note ? { note: String(flags.note).slice(0, 500) } : {}),
        ...(flags.step ? { step: Number(flags.step) } : {}),
        ...(flags.evidence ? { evidence: flags.evidence } : {}),
        ...(flags.defect ? { defect: flags.defect } : {}),
        ...(flags['run-id'] ? { runId: flags['run-id'] } : {}),
        ...(flags.xray ? { xraySet: true } : {}),
      }
      if (flags.story) s.story = flags.story
      s.closed = 'open'
      write(dir, `${run}.json`, s)
      const stop = stopCheck(s.tests, qa.blockedStop)
      out(stop.stopSuggested ? `${stop.blockedInARow} blocked tests in a row: the environment is probably down. Stop the run?` : 'saved', { tag: 'QA_STATE_JSON', data: { run, test, verdict, ...stop } })
      return 0
    }
    if (sub === 'close') {
      const outcome = rest[1]
      if (!['ko', 'ok', 'open'].includes(outcome) || rest.length > 2) return err('usage: qa.mjs state close <RUN> ko|ok|open')
      s.closed = outcome
      write(dir, `${run}.json`, s)
      // A story that fails again is watched again: forget that its last "ready to retest" was told.
      const w = tryReadJson(join(dir, 'watch.json'), null)
      if (outcome === 'ko' && s.story && w?.seen?.includes(s.story)) write(dir, 'watch.json', { seen: w.seen.filter(k => k !== s.story) })
      out('saved')
      return 0
    }
    if (sub === 'reset') {
      write(dir, `${run}.json`, { run, story: s.story, app: s.app, closed: 'open', startedAt: now(), tests: {} })
      out('reset')
      return 0
    }
    return err(USAGE)
  }

  if (cmd === 'watch' && sub === 'fresh') {
    const found = String(flags.found ?? '').split(',').map(x => x.trim()).filter(Boolean)
    if (found.some(k => !isTicketKey(k))) return err('--found takes Jira keys, like ABC-100,ABC-101')
    const f = join(dir, 'watch.json')
    const seen = readJsonOr(f, null)?.seen ?? []
    const fresh = found.filter(k => !seen.includes(k))
    if (fresh.length) write(dir, 'watch.json', { seen: [...seen, ...fresh] })
    out(fresh.length ? `Ready to retest: ${fresh.join(', ')}` : 'Nothing new.', { tag: 'QA_FRESH_JSON', data: { fresh } })
    return 0
  }

  return err(USAGE)
}

if (isMain(import.meta.url)) process.exitCode = await main()
