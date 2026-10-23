// End to end on Java: the real pipeline with the real Maven, JUnit 5 and surefire, on a tiny project
// made here in a temp folder. Runs only with QC_E2E=1 and Maven on PATH (the e2e-java CI job).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ENV } from '../git-env.mjs'
import { runPipeline } from '../../lib/pipeline/pipeline.mjs'
import { dialectFor } from '../../lib/base/dialects/index.mjs'

const skip = process.env.QC_E2E === '1' ? false : 'end to end: set QC_E2E=1 (needs Java 17+ and Maven)'
const LONG = 10 * 60 * 1000

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>demo</groupId>
  <artifactId>pricing</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <version>5.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-surefire-plugin</artifactId>
        <version>3.2.5</version>
      </plugin>
    </plugins>
  </build>
</project>
`

const CODE = `package demo;

public final class LineTotal {
  private LineTotal() {}

  /** The total of a line in cents: quantity times the unit price. */
  public static long cents(int quantity, long unitCents) {
    return quantity * unitCents;
  }
}
`

const spec = (cls, key, body) => `package demo;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("${key} Line totals")
class ${cls} {
${body}
}
`

const GREEN = spec('LineTotalTest', 'DEMO-1', `  @Test
  @DisplayName("three at 4.50 make 13.50")
  void threeItems() {
    assertEquals(1350, LineTotal.cents(3, 450));
  }

  @Test
  void zeroQuantity() {
    assertEquals(0, LineTotal.cents(0, 450));
  }`)

const HOLLOW = spec('HollowTest', 'DEMO-2', `  @Test
  void runsButChecksNothing() {
    LineTotal.cents(3, 450);
  }`)

const RED = spec('RedTest', 'DEMO-3', `  @Test
  void expectsTheWrongTotal() {
    assertEquals(1351, LineTotal.cents(3, 450));
  }`)

const BROKEN = spec('BrokenTest', 'DEMO-4', `  @Test
  void doesNotCompile() {
    assertEquals(1350, LineTotal.total(3, 450));
  }`)

const put = (d, p, s) => { mkdirSync(dirname(join(d, p)), { recursive: true }); writeFileSync(join(d, p), s) }
const SPECS = { green: 'src/test/java/demo/LineTotalTest.java', hollow: 'src/test/java/demo/HollowTest.java', red: 'src/test/java/demo/RedTest.java', broken: 'src/test/java/demo/BrokenTest.java' }

let root = null
function project() {
  if (root) return root
  root = mkdtempSync(join(tmpdir(), 'qc-e2e-java-'))
  const g = (...a) => execFileSync('git', a, { cwd: root, env: ENV })
  g('init', '-q', '-b', 'main')
  put(root, 'pom.xml', POM)
  put(root, 'src/main/java/demo/LineTotal.java', CODE)
  put(root, '.gitignore', 'target/\n')
  g('add', '-A'); g('commit', '-qm', 'sample')
  put(root, SPECS.green, GREEN)
  put(root, SPECS.hollow, HOLLOW)
  put(root, SPECS.red, RED)
  return root
}

async function pipeline(specPath, key) {
  const d = project()
  const t0 = Date.now()
  const out = await runPipeline({ specs: [specPath], key }, { root: d, config: { adapter: 'junit', jira: { projects: ['DEMO'] } }, dialect: dialectFor('junit') })
  const step = name => out.steps.find(s => s.check === name)
  const card = `${out.verdict} in ${((Date.now() - t0) / 1000).toFixed(1)}s, decided by ${out.decidedBy ?? '-'}: ${out.steps.map(s => `${s.check}=${s.status} (${s.summary})`).join('; ')}`
  return { out, step, card }
}

test('a green JUnit spec: the tests pass and every assertion\'s mutant is killed, the spec untouched', { skip, timeout: LONG }, async t => {
  const r = await pipeline(SPECS.green, 'DEMO-1')
  t.diagnostic(r.card)
  assert.equal(r.out.verdict, 'green', r.card)
  assert.equal(r.step('tests').data.passed, 2, r.card)
  assert.deepEqual(r.step('tests').data.list.map(x => x.title).sort(), ['threeItems', 'zeroQuantity'])
  const m = r.step('mutation')
  assert.equal(m.status, 'pass', r.card)
  assert.equal(m.data.killed, 2, r.card)
  assert.equal(readFileSync(join(root, SPECS.green), 'utf8'), GREEN)
})

test('a hollow JUnit spec fails suite honesty', { skip, timeout: LONG }, async t => {
  const r = await pipeline(SPECS.hollow, 'DEMO-2')
  t.diagnostic(r.card)
  assert.equal(r.out.verdict, 'checks_failed', r.card)
  assert.equal(r.out.decidedBy, 'suite-honesty')
  assert.deepEqual(r.step('suite-honesty').findings.map(f => f.test), ['runsButChecksNothing'])
})

test('a red JUnit spec: the tests are red, with the assertion\'s message', { skip, timeout: LONG }, async t => {
  const r = await pipeline(SPECS.red, 'DEMO-3')
  t.diagnostic(r.card)
  assert.equal(r.out.verdict, 'tests_red', r.card)
  assert.equal(r.step('tests').data.failed, 1)
  assert.match(r.step('tests').findings[0].detail, /expected: <1351> but was: <1350>/)
})

test('a spec that does not compile is not verified, with the compiler\'s line', { skip, timeout: LONG }, async t => {
  const d = project()
  put(d, SPECS.broken, BROKEN)
  try {
    const r = await pipeline(SPECS.broken, 'DEMO-4')
    t.diagnostic(r.card)
    assert.equal(r.out.verdict, 'not_verified', r.card)
    assert.equal(r.step('tests').status, 'not_run')
    assert.match(r.step('tests').summary, /BrokenTest\.java/, r.card)
  } finally { rmSync(join(d, SPECS.broken), { force: true }) }
  // Only the build's own output was added to the project.
  assert.deepEqual(readdirSync(d).sort(), ['.git', '.gitignore', 'pom.xml', 'src', 'target'])
})
