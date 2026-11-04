import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { touchesData } from '../../lib/base/database.mjs'

const read = p => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

test('ticket text about a table, a migration or a constraint touches data', () => {
  assert.equal(touchesData({ text: 'Add a column status to the orders table' }).touches, true)
  assert.equal(touchesData({ text: 'The migration backfills old rows' }).touches, true)
  assert.equal(touchesData({ text: 'Email must be unique constraint' }).touches, true)
  assert.equal(touchesData({ text: 'Stored in PostgreSQL' }).touches, true)
})

test('plain business text does not touch data', () => {
  assert.deepEqual(touchesData({ text: 'The total shows 108.00 with VAT', target: 'src/pricing.ts' }), { touches: false, reasons: [] })
  assert.equal(touchesData().touches, false)
  assert.equal(touchesData({ text: 'Update the label color' }).touches, false)
})

test('a target path of migrations, sql or a repository touches data', () => {
  for (const t of ['db/migrations/001_init.sql', 'src/main/resources/db/migration/V2__orders.sql', 'src/OrderRepository.java', 'app/orders_repo.py', 'src/orders.repository.ts', 'prisma/schema.prisma', 'src\\migrations\\a.ts']) {
    assert.equal(touchesData({ target: t }).touches, true, t)
  }
  assert.equal(touchesData({ target: 'src/pricing.ts' }).touches, false)
})

test('reasons say what matched', () => {
  const r = touchesData({ text: 'new table', target: 'db/migrations/1.sql' })
  assert.ok(r.reasons.some(x => x.startsWith('text:')) && r.reasons.some(x => x.startsWith('target:')))
})

test('the guide holds the cases and the runner guides point to it', () => {
  const g = read('guides/database-tests.md')
  for (const w of ['unique', 'not null', 'foreign key', 'empty database', 'filled database', 'Testcontainers', 'conventions come first']) assert.ok(g.toLowerCase().includes(w.toLowerCase()), w)
  for (const f of ['junit', 'pytest', 'go', 'dotnet', 'vitest']) {
    const s = read(`guides/${f}-writing.md`)
    assert.ok(s.includes('## Database tests') && s.includes('guides/database-tests.md'), f)
  }
})

test('spec.md plans a Database section when data is touched, conventions first', () => {
  const s = read('commands/spec.md')
  assert.ok(s.includes('Database: N cases') && s.includes('lib/base/database.mjs') && s.includes('guides/database-tests.md'))
  assert.ok(s.includes('Testcontainers') && s.includes('own database test habits come first'))
})
