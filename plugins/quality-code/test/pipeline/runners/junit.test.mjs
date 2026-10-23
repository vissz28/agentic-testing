// The JUnit runner: the XML reports it reads (surefire and Gradle, written as those tools write them),
// the build it picks, and runs of a fake mvn and gradle on PATH that write reports and exit with codes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCommand, collect, compileError, decodeEntities, fillCommand, junitRunner, moduleOf, parseJUnitXml, parseXml, selectorsFor, specInfo, titleOf,
} from '../../../lib/pipeline/runners/junit.mjs'
import { inKeyBlock } from '../../../lib/base/keys.mjs'
import { fakeCommand } from '../../fake-bin.mjs'

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/junit')
const fixture = name => readFileSync(join(FIX, name), 'utf8')
const JAVA = fixture('LineTotalTest.java')
const KT = fixture('TotalsTest.kt')
const JSPEC = 'src/test/java/demo/pricing/LineTotalTest.java'
const KSPEC = 'src/test/kotlin/demo/pricing/TotalsTest.kt'
const INFOS = [specInfo(JSPEC, JAVA), specInfo(KSPEC, KT)]
const KEY = 'ABC-12 Line totals round to the cent'
const cfg = (junit = undefined) => ({ adapter: 'junit', jira: { projects: ['ABC'] }, ...(junit ? { junit } : {}) })

const put = (d, p, s, mode) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s, mode ? { mode } : undefined) }
function project(files) {
  const d = mkdtempSync(join(tmpdir(), 'qc-junit-'))
  for (const [p, s] of Object.entries(files)) put(d, p, s)
  return d
}

test('parseXml: entities, CDATA, comments, quotes holding ">", self-closing tags', () => {
  const doc = parseXml('<?xml version="1.0"?>\n<!-- a <comment> -->\n<a x="1 &gt; 0" y=\'it&apos;s\'><b/><c><![CDATA[<raw> & stuff]]> &amp; &#38;&#x41;</c></a>')
  const a = doc.children[0]
  assert.deepEqual(a.attrs, { x: '1 > 0', y: "it's" })
  assert.deepEqual(a.children.map(c => c.name), ['b', 'c'])
  assert.equal(a.children[1].text, '<raw> & stuff & &A')
  assert.equal(decodeEntities('&unknown; &#10;'), '&unknown; \n')
  assert.throws(() => parseXml('<a><b>'), /unclosed <b>/)
})

test('surefire: passed, a failure with a multi-line stack, an error, a skipped, parameterized invocations', () => {
  const cases = parseJUnitXml(fixture('surefire-TEST-demo.pricing.LineTotalTest.xml'))
  assert.deepEqual(cases.map(c => [c.name, c.status, c.message]), [
    ['threeItems', 'passed', ''],
    ['roundsHalfUp', 'failed', 'expected: <1001> but was: <1000>'],
    ['parsesSku', 'failed', 'Index 3 out of bounds for length 3'],
    ['discount', 'skipped', ''],
    ['quantities(int)[1]', 'passed', ''],
    ['quantities(int)[2]', 'passed', ''],
  ])
  assert.ok(cases.every(c => c.classname === 'demo.pricing.LineTotalTest'))
  assert.equal(cases[2].error, true)
})

test('surefire: results carry the method title, the class\'s @DisplayName as the group, nested classes after it', () => {
  const main = collect(parseJUnitXml(fixture('surefire-TEST-demo.pricing.LineTotalTest.xml')), INFOS)
  const nested = collect(parseJUnitXml(fixture('surefire-TEST-demo.pricing.LineTotalTest$WhenEmpty.xml')), INFOS)
  assert.deepEqual(main.tests.map(t => [t.title, t.status]), [['threeItems', 'passed'], ['roundsHalfUp', 'failed'], ['parsesSku', 'failed'], ['discount', 'skipped'], ['quantities', 'passed'], ['quantities', 'passed']])
  assert.ok(main.tests.every(t => t.file === JSPEC && t.path.length === 1 && t.path[0] === KEY))
  assert.deepEqual(nested.tests, [{ title: 'zero', path: [KEY, 'WhenEmpty'], file: JSPEC, status: 'passed', message: '' }])
  assert.ok(inKeyBlock(nested.tests[0], 'ABC-12'))
  assert.deepEqual(main.broken, [])
})

test('surefire with phrased names: the class and the test by their display names', () => {
  const r = collect(parseJUnitXml(fixture('surefire-phrased-TEST-demo.pricing.LineTotalTest.xml')), INFOS)
  assert.deepEqual(r.tests.map(t => [t.title, t.status, t.path[0]]), [['threeItems', 'passed', KEY], ['roundsHalfUp', 'failed', KEY]])
})

test('Gradle: display names and "method()" both come back as the method title', () => {
  const r = collect(parseJUnitXml(fixture('gradle-TEST-demo.pricing.LineTotalTest.xml')), INFOS)
  assert.deepEqual(r.tests.map(t => [t.title, t.status]), [['threeItems', 'passed'], ['roundsHalfUp', 'failed'], ['discount', 'skipped'], ['quantities', 'passed'], ['parsesSku', 'passed']])
  assert.equal(r.tests[1].message, 'org.opentest4j.AssertionFailedError: expected: <1001> but was: <1000>')
})

test('Gradle on Kotlin: a `name with spaces`; a class-level error leaves the file broken, not a test', () => {
  const r = collect(parseJUnitXml(fixture('gradle-TEST-demo.pricing.TotalsTest.xml')), INFOS)
  assert.deepEqual(r.tests.map(t => [t.title, t.path[0], t.file]), [['sums three lines', 'ABC-14 Order totals', KSPEC]])
  assert.deepEqual(r.broken, [{ file: KSPEC, message: 'java.lang.IllegalStateException: no price list' }])
})

test('a report of a class no requested spec declares is left out', () => {
  const r = collect([{ classname: 'demo.Other', name: 'x', status: 'passed', message: '' }], INFOS)
  assert.deepEqual(r, { tests: [], broken: [] })
})

test('titleOf: method names, "m()", "m(int)[2]", display names, and an unknown name as written', () => {
  const info = INFOS[0]
  assert.equal(titleOf('threeItems()', info), 'threeItems')
  assert.equal(titleOf('quantities(int)[2]', info), 'quantities')
  assert.equal(titleOf('three at 4.50 make 13.50', info), 'threeItems')
  assert.equal(titleOf('somethingElse()', info), 'somethingElse')
})

test('compileError: Maven and Gradle (javac, kotlinc), the line naming the spec first', () => {
  const mvn = '[ERROR] COMPILATION ERROR : \n[ERROR] /w/src/test/java/demo/pricing/LineTotalTest.java:[12,5] cannot find symbol\n  symbol:   variable total\n[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:testCompile\n'
  assert.equal(compileError(mvn, JSPEC), '[ERROR] /w/src/test/java/demo/pricing/LineTotalTest.java:[12,5] cannot find symbol')
  assert.equal(compileError('> Task :compileTestKotlin FAILED\ne: file:///w/src/test/kotlin/demo/pricing/TotalsTest.kt:17:9 Unresolved reference: total\n', KSPEC), 'e: file:///w/src/test/kotlin/demo/pricing/TotalsTest.kt:17:9 Unresolved reference: total')
  assert.equal(compileError('/w/src/test/java/demo/pricing/LineTotalTest.java:12: error: cannot find symbol\n', JSPEC), '/w/src/test/java/demo/pricing/LineTotalTest.java:12: error: cannot find symbol')
  assert.equal(compileError('all good', JSPEC), '')
})

test('the build: the nearest pom.xml or build.gradle(.kts) above the spec', () => {
  const d = project({ 'pom.xml': '<project/>', 'svc/pom.xml': '<project/>', 'app/build.gradle.kts': '', [`svc/${JSPEC}`]: JAVA, [`app/${KSPEC}`]: KT, 'loose/ATest.java': '' })
  assert.deepEqual(moduleOf(d, `svc/${JSPEC}`), { tool: 'maven', dir: join(d, 'svc') })
  assert.deepEqual(moduleOf(d, `app/${KSPEC}`), { tool: 'gradle', dir: join(d, 'app') })
  assert.deepEqual(moduleOf(d, 'loose/ATest.java'), { tool: 'maven', dir: d })
  assert.equal(moduleOf(project({ 'ATest.java': '' }), 'ATest.java'), null)
})

test('Maven: one module runs where it is; a module below the reactor top runs from the top with -pl -am', () => {
  const one = project({ 'pom.xml': '<project/>' })
  const b = buildCommand(one, { tool: 'maven', dir: one }, [{ cls: 'demo.pricing.LineTotalTest' }])
  assert.equal(b.cmd, 'mvn')
  assert.equal(b.cwd, one)
  assert.deepEqual(b.args, ['-B', '-q', 'test', '-Dtest=demo.pricing.LineTotalTest', '-DfailIfNoTests=false', '-Dsurefire.failIfNoSpecifiedTests=false', '-Dsurefire.rerunFailingTestsCount=0'])
  assert.equal(b.reports, join(one, 'target/surefire-reports'))
  const multi = project({ 'pom.xml': '<project/>', 'services/orders/pom.xml': '<project/>', mvnw: '#!/bin/sh\n' })
  const m = buildCommand(multi, { tool: 'maven', dir: join(multi, 'services/orders') }, [{ cls: 'a.BTest', method: 'm' }, { cls: 'a.CTest$Inner', method: 'm' }])
  assert.equal(m.cmd, join(multi, 'mvnw'))
  assert.equal(m.cwd, multi)
  assert.deepEqual(m.args.slice(0, 6), ['-B', '-q', '-pl', 'services/orders', '-am', 'test'])
  assert.equal(m.args[6], '-Dtest=a.BTest#m,a.CTest$Inner#m')
  assert.equal(m.reports, join(multi, 'services/orders/target/surefire-reports'))
})

test('Gradle: the wrapper, the module\'s project path, cleanTest so the test task always runs', () => {
  const d = project({ 'settings.gradle.kts': '', gradlew: '#!/bin/sh\n', 'app/build.gradle.kts': '' })
  const b = buildCommand(d, { tool: 'gradle', dir: join(d, 'app') }, [{ cls: 'demo.ATest' }, { cls: 'demo.BTest', method: 'sums three lines' }])
  assert.equal(b.cmd, join(d, 'gradlew'))
  assert.equal(b.cwd, d)
  assert.deepEqual(b.args, [':app:cleanTest', ':app:test', '--tests', 'demo.ATest', '--tests', 'demo.BTest.sums three lines', '--console=plain'])
  assert.equal(b.reports, join(d, 'app/build/test-results/test'))
  const single = project({ 'build.gradle': '' })
  assert.deepEqual(buildCommand(single, { tool: 'gradle', dir: single }, [{ cls: 'X' }]).args.slice(0, 2), [':cleanTest', ':test'])
  assert.equal(buildCommand(single, { tool: 'gradle', dir: single }, [{ cls: 'X' }]).cmd, 'gradle')
})

test('selectors: whole top-level classes, or the named method in the class that declares it', () => {
  assert.deepEqual(selectorsFor(INFOS, undefined), [{ cls: 'demo.pricing.LineTotalTest' }, { cls: 'demo.pricing.TotalsTest' }, { cls: 'demo.pricing.RefundTotalsTest' }])
  assert.deepEqual(selectorsFor([INFOS[0]], 'zero'), [{ cls: 'demo.pricing.LineTotalTest$WhenEmpty', method: 'zero' }])
  assert.deepEqual(selectorsFor([INFOS[0]], 'nope'), [{ cls: 'demo.pricing.LineTotalTest', method: 'nope' }])
})

test('fillCommand: {files}, {report} and {test} in the build tool\'s own filter, each quoted', () => {
  const sel = [{ cls: 'a.BTest', method: 'm' }]
  assert.equal(fillCommand('mvn test {test} -Dout={report} # {files}', { files: ['x y/ATest.java'], report: '/tmp/r', tool: 'maven', selectors: sel }),
    "mvn test -Dtest='a.BTest#m' -Dout='/tmp/r' # 'x y/ATest.java'")
  assert.equal(fillCommand('./gradlew test {test}', { files: [], report: '/r', tool: 'gradle', selectors: sel }), "./gradlew test --tests 'a.BTest.m'")
})

// A fake build tool first on PATH: it logs its cwd and argv, copies the given reports into the
// module's report folder and exits with the given code.
function fakeTool(name, { reports = [], into, exit = 0, say = '', sleep = 0 }) {
  const f = fakeCommand(name)
  const log = join(mkdtempSync(join(tmpdir(), 'qc-fake-log-')), 'calls')
  const copy = reports.map(r => `cp '${join(FIX, r.from)}' '${join(into, r.to)}'`).join('\n')
  f.act(`printf '%s|%s\\n' "$PWD" "$*" >> '${log}'\n${sleep ? `exec sleep ${sleep}` : ''}\nmkdir -p '${into}'\n${copy}\nprintf '%b' '${say}'\nexit ${exit}`)
  return { ...f, calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []) }
}

test('Maven run: reads only this run\'s reports of the requested class, failures included, exit 1 is no error', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const reports = join(d, 'target/surefire-reports')
  // The last run's report of this class (gone before the run) and another class's (never read).
  put(d, 'target/surefire-reports/TEST-demo.pricing.LineTotalTest.xml', '<testsuite><testcase classname="demo.pricing.LineTotalTest" name="stale"/></testsuite>')
  put(d, 'target/surefire-reports/TEST-demo.Other.xml', '<testsuite><testcase classname="demo.Other" name="x"/></testsuite>')
  const mvn = fakeTool('mvn', { into: reports, exit: 1, reports: [
    { from: 'surefire-TEST-demo.pricing.LineTotalTest.xml', to: 'TEST-demo.pricing.LineTotalTest.xml' },
    { from: 'surefire-TEST-demo.pricing.LineTotalTest$WhenEmpty.xml', to: 'TEST-demo.pricing.LineTotalTest$WhenEmpty.xml' }] })
  try {
    const r = await junitRunner(d, cfg())({ files: [JSPEC] })
    assert.equal(r.ran, true)
    assert.deepEqual(r.broken, [])
    assert.deepEqual(r.tests.map(t => `${t.title}:${t.status}`).sort(), ['discount:skipped', 'parsesSku:failed', 'quantities:passed', 'quantities:passed', 'roundsHalfUp:failed', 'threeItems:passed', 'zero:passed'])
    const [cwd, args] = mvn.calls()[0].split('|')
    assert.equal(cwd.replace(/^\/private/, ''), d.replace(/^\/private/, ''))
    assert.match(args, /-B -q test -Dtest=demo\.pricing\.LineTotalTest -DfailIfNoTests=false/)
  } finally { mvn.restore() }
})

test('Maven run by name: -Dtest=Class#method, and the results of that test', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const mvn = fakeTool('mvn', { into: join(d, 'target/surefire-reports'), reports: [{ from: 'surefire-TEST-demo.pricing.LineTotalTest$WhenEmpty.xml', to: 'TEST-demo.pricing.LineTotalTest$WhenEmpty.xml' }] })
  try {
    const r = await junitRunner(d, cfg())({ files: [JSPEC], testName: 'zero' })
    assert.deepEqual(r.tests.map(t => t.title), ['zero'])
    assert.match(mvn.calls()[0], /-Dtest=demo\.pricing\.LineTotalTest\$WhenEmpty#zero /)
  } finally { mvn.restore() }
})

test('a compile error: the build fails with no report, the spec is broken with the compiler\'s line', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const say = `[ERROR] COMPILATION ERROR : \\n[ERROR] ${join(d, JSPEC)}:[19,5] cannot find symbol\\n[ERROR] Failed to execute goal`
  const mvn = fakeTool('mvn', { into: join(d, 'target/surefire-reports'), exit: 1, say })
  try {
    const r = await junitRunner(d, cfg())({ files: [JSPEC] })
    assert.equal(r.ran, true)
    assert.deepEqual(r.tests, [])
    assert.deepEqual(r.broken, [{ file: JSPEC, message: `[ERROR] ${join(d, JSPEC)}:[19,5] cannot find symbol` }])
  } finally { mvn.restore() }
})

test('Gradle run: the project\'s wrapper from the top, cleanTest, the module\'s test-results', async () => {
  const d = project({ 'settings.gradle.kts': '', 'app/build.gradle.kts': '', [`app/${KSPEC}`]: KT })
  const log = join(d, '.calls')
  put(d, 'gradlew', `#!/bin/sh\nprintf '%s|%s\\n' "$PWD" "$*" >> '${log}'\nmkdir -p app/build/test-results/test\ncp '${join(FIX, 'gradle-TEST-demo.pricing.TotalsTest.xml')}' app/build/test-results/test/TEST-demo.pricing.TotalsTest.xml\nexit 1\n`, 0o755)
  const r = await junitRunner(d, cfg())({ files: [`app/${KSPEC}`] })
  assert.equal(r.ran, true)
  assert.deepEqual(r.tests.map(t => [t.title, t.status]), [['sums three lines', 'passed']])
  assert.deepEqual(r.broken.map(b => b.message), ['java.lang.IllegalStateException: no price list'])
  const call = readFileSync(log, 'utf8').trim()
  assert.match(call, /\|:app:cleanTest :app:test --tests demo\.pricing\.TotalsTest --tests demo\.pricing\.RefundTotalsTest --console=plain$/)
})

test('Gradle on PATH when the project has no wrapper', async () => {
  const d = project({ 'build.gradle': '', [JSPEC]: JAVA })
  const gradle = fakeTool('gradle', { into: join(d, 'build/test-results/test'), reports: [{ from: 'gradle-TEST-demo.pricing.LineTotalTest.xml', to: 'TEST-demo.pricing.LineTotalTest.xml' }] })
  try {
    const r = await junitRunner(d, cfg())({ files: [JSPEC], testName: 'roundsHalfUp' })
    assert.equal(r.tests.find(t => t.title === 'roundsHalfUp').status, 'failed')
    assert.match(gradle.calls()[0], /:cleanTest :test --tests demo\.pricing\.LineTotalTest\.roundsHalfUp/)
  } finally { gradle.restore() }
})

test('a build that outlasts the timeout is killed with its group: not run, never a pass', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const mvn = fakeTool('mvn', { into: join(d, 'target/surefire-reports'), sleep: 30 })
  try {
    const t0 = Date.now()
    const r = await junitRunner(d, cfg())({ files: [JSPEC], timeoutMs: 300 })
    assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'took longer than 300ms' })
    assert.ok(Date.now() - t0 < 5000)
  } finally { mvn.restore() }
})

test('no Maven: no wrapper and no mvn on PATH is an error, not a broken spec', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const before = process.env.PATH
  process.env.PATH = mkdtempSync(join(tmpdir(), 'qc-empty-path-'))
  try {
    const r = await junitRunner(d, cfg())({ files: [JSPEC] })
    assert.deepEqual(r, { ran: false, tests: [], broken: [], error: 'Maven is not installed: no mvnw in the project and no mvn on PATH' })
  } finally { process.env.PATH = before }
})

test('no build file above the spec is an error', async () => {
  const d = project({ [JSPEC]: JAVA })
  const r = await junitRunner(d, cfg())({ files: [JSPEC] })
  assert.equal(r.ran, false)
  assert.equal(r.error, `no pom.xml or build.gradle above ${JSPEC}`)
})

test('junit.command: the project\'s own command, its reports read from {report}', async () => {
  const d = project({ 'pom.xml': '<project/>', [JSPEC]: JAVA })
  const bin = mkdtempSync(join(tmpdir(), 'qc-own-build-'))
  const log = join(bin, 'calls')
  put(bin, 'own-build', `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nout=$2\ncp '${join(FIX, 'surefire-TEST-demo.pricing.LineTotalTest.xml')}' "$out/TEST-x.xml"\nexit 1\n`, 0o755)
  const before = process.env.PATH
  process.env.PATH = `${bin}${delimiter}${before}`
  try {
    const r = await junitRunner(d, cfg({ command: 'own-build --out {report} {test}' }))({ files: [JSPEC] })
    assert.equal(r.ran, true)
    assert.equal(r.tests.length, 6)
    assert.match(readFileSync(log, 'utf8'), /--out \S+qc-junit-\S+ -Dtest=demo\.pricing\.LineTotalTest/)
    // The temp report folder is gone; nothing was written into the project.
    assert.deepEqual(readdirSync(d).sort(), ['pom.xml', 'src'])
  } finally { process.env.PATH = before }
})
