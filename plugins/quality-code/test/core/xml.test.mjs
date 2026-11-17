// lib/core/xml.mjs: the one XML reader for test and coverage reports.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { child, decodeEntities, descendants, parseXml } from '../../lib/core/xml.mjs'

test('parseXml: entities, CDATA, comments, quotes holding ">", self-closing tags; the declaration and DOCTYPE skipped', () => {
  const doc = parseXml('\uFEFF<?xml version="1.0"?>\n<!DOCTYPE x><!-- a <comment> -->\n<a x="1 &gt; 0" y=\'it&apos;s\'><b/><c>t&#x41;&#66;<![CDATA[<raw> &amp;]]></c></a>')
  const a = doc.children[0]
  assert.deepEqual([doc.name, a.name, doc.unclosed], ['#document', 'a', null])
  assert.deepEqual(a.attrs, { x: '1 > 0', y: "it's" })
  assert.deepEqual(a.children.map(c => c.name), ['b', 'c'])
  assert.equal(a.children[1].text, 'tAB<raw> &amp;')
  assert.deepEqual(parseXml('').children, [])
})

test('decodeEntities: an unknown entity or one that is not a character stays as it is, never a crash', () => {
  assert.equal(decodeEntities('&lt;&unknown;&#10;&#xZZ;&#X41;'), '<&unknown;\n&#xZZ;A')
  assert.equal(decodeEntities('&#99999999;'), '&#99999999;')
  assert.equal(parseXml('<a>&#99999999;</a>').children[0].text, '&#99999999;')
})

test('parseXml: a stray end tag closes nothing; an end tag closes what it skipped; a cut-off report says what is open', () => {
  assert.deepEqual(parseXml('<a></x><b><c/></a>').children[0].children.map(c => c.name), ['b'])
  const doc = parseXml('<a><b><c></a><d/>')
  assert.deepEqual(doc.children.map(c => c.name), ['a', 'd'])
  assert.equal(parseXml('<a><b>').unclosed, 'b')
  assert.equal(parseXml('<a>1 < 2</a>').children[0].text, '1 < 2')
})

test('parseXml: a namespace prefix is dropped from names and attributes (TRX)', () => {
  const doc = parseXml('<t:TestRun xmlns:t="x"><t:Results><t:UnitTestResult t:outcome="Passed"/></t:Results></t:TestRun>')
  const r = child(child(doc, 'TestRun'), 'Results').children[0]
  assert.deepEqual([r.name, r.attrs.outcome], ['UnitTestResult', 'Passed'])
})

test('descendants: every match at any depth, in document order; child: the first direct one', () => {
  const doc = parseXml('<s><c n="1"/><g><c n="2"><c n="3"/></c></g></s>')
  assert.deepEqual(descendants(doc, 'c').map(c => c.attrs.n), ['1', '2', '3'])
  assert.equal(child(child(doc, 's'), 'c').attrs.n, '1')
  assert.equal(child(undefined, 'c'), undefined)
  assert.deepEqual(descendants(undefined, 'c'), [])
})

test('no script or library file has its own XML reader', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const walk = p => readdirSync(join(root, p), { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(p, e.name)) : e.name.endsWith('.mjs') ? [join(p, e.name)] : []))
  const HAND = /\b(?:function|const) (?:parseXml|decodeEntities|decode)\b|\{ lt: '<', gt: '>'/
  const own = [...walk('bin'), ...walk('lib')].filter(f => !f.startsWith(join('lib', 'core')) && HAND.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(own, [])
})
