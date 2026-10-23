// A fake dialect of a made-up compiled language, for the in-place mutation tests: "test name" opens a
// test, "check(x == n)" is its assertion, and the one flip adds 1 to the number.
export const FAKE = {
  name: 'fake',
  mutation: {
    inPlace: true,
    expectRe: /\bcheck\s*\(/,
    testRe: /\btest\s+()()(\w+)/g,
    rank: () => 0,
    eligible: (b, passed) => passed.has(b.title),
    flips: src => [{ kind: 'num→n+1', text: src.replace(/(\d+)\)/, (_, n) => `${Number(n) + 1})`) }],
    plan: ({ src, passedTitles, blocks, expects }) => expects.flatMap(ex => {
      const block = blocks.find(b => ex.start >= b.start && ex.start < b.end)
      if (!block || !passedTitles.includes(block.title)) return []
      const original = src.slice(ex.start, ex.end)
      return FAKE.mutation.flips(original).map(f => ({ title: block.title, start: ex.start, end: ex.end, kind: f.kind, replacement: f.text, snippet: `${f.kind}: ${original.trim()}` }))
    }),
  },
}

// Odd bytes on purpose: a BOM, CRLF line ends and no final newline must all come back as they were.
export const SRC = '﻿test total {\r\n  check(total() == 108)\r\n}\r\ntest count {\r\n  check(count() == 3)\r\n}'
