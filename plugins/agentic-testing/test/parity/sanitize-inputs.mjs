// Raw (unsanitized) tickets for the sanitize parity check, shared by scripts/capture-parity.mjs and
// test/parity.test.mjs. Every customer id and e-mail is assembled at runtime, so no committed
// file carries one (Ruling R11). mask() replaces each of them with a stable token before an
// output is stored or compared: a glued id is not redacted, today or now, and must not reach disk.

const id = n => 'U' + String(n)
const mail = (user, host) => `${user}${'@'}${host}`
const uuid = (a, v = '4', r = '9') => `${a}-1b2c-${v}d3e-${r}f9a-0b1c2d3e4f5a`

const ID1 = id(232527)
const ID2 = id(1234567)
const ID3 = id(99999)
const GLUED = 'ABC' + id(123456)
const GLUED_RIGHT = id(654321) + 'X'
const SHORT = id(1234)
const MAIL1 = mail('mario.rossi', 'acme-corp.it')
const MAIL2 = mail('a.b+tag', 'sub.example.org')
const UUID1 = uuid('3f2c1e4a')
const UUID2 = uuid('16475e6a', '1', 'b')
const NOT_V = uuid('aaaaaaaa', '0', 'c')

/** The strings mask() hides, longest first so a glued id is masked whole. */
export const SECRETS = [GLUED, GLUED_RIGHT, ID2, ID1, ID3, MAIL2, MAIL1].sort((a, b) => b.length - a.length)

export function mask(text) {
  let s = String(text)
  SECRETS.forEach((secret, i) => { s = s.split(secret).join(`<secret:${i}>`) })
  return s
}

const p = (...content) => ({ type: 'paragraph', content })
const tx = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const doc = (...content) => ({ type: 'doc', version: 1, content })

export function sanitizeInputs() {
  return [
    { name: 'plain-all-fields', raw: { key: 'FIC-100', issuetype: 'Bug', status: 'TO DO', labels: ['Giacenza_Prodotti', ID1], summary: `[${ID1}] stock wrong for ${MAIL1}`, text: { description: `Customer ${ID1} (workspace ${UUID1}) wrote from ${MAIL1}.\nAlso ${ID2} and ${ID3}.`, acField: `Then ${ID1} sees 80; mail ${MAIL2}; ws ${UUID2}` } } },
    { name: 'glued-and-short-ids', raw: { key: 'FIC-101', summary: `code ${GLUED} and ${GLUED_RIGHT}`, text: { description: `glued ${GLUED}, right ${GLUED_RIGHT}, short ${SHORT}, alone ${ID3}.`, acField: '' } } },
    { name: 'uuid-versions', raw: { key: 'FIC-102', summary: 'uuids', text: { description: `v4 ${UUID1}\nv1 ${UUID2.toUpperCase()}\nnot a version ${NOT_V}` } } },
    { name: 'adf-paragraphs-lists-breaks-marks', raw: { key: 'FIC-103', summary: 'adf', text: {
      description: doc(
        { type: 'heading', attrs: { level: 2 }, content: [tx('What happens?')] },
        p(tx('Customer '), tx(ID1, [{ type: 'strong' }]), tx(' sees 150'), { type: 'hardBreak' }, tx('instead of 80.')),
        { type: 'bulletList', content: [
          { type: 'listItem', content: [p(tx(`mail ${MAIL1}`, [{ type: 'em' }, { type: 'link', attrs: { href: `mailto:${MAIL1}` } }]))] },
          { type: 'listItem', content: [p(tx(`ws ${UUID1}`))] },
        ] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [p(tx('open'))] }, { type: 'listItem', content: [p(tx('filter 22'))] }] },
        p(tx('See https://gitlab.example/group/repo/-/merge_requests/42).')),
      ),
      acField: doc(p(tx('Then the KPI shows '), tx('80', [{ type: 'code' }]), tx('.'))),
    } } },
    { name: 'adf-empty-doc', raw: { key: 'FIC-104', summary: '', text: { description: doc(), acField: { type: 'doc', content: [p()] } } } },
    { name: 'adf-summary-and-odd-values', raw: { key: 'FIC-105', summary: doc(p(tx(`${ID2} cost`))), text: { description: 12345, acField: true } } },
    { name: 'missing-text', raw: { key: 'FIC-106', labels: [], summary: `only ${ID1}` } },
    { name: 'null-fields', raw: { key: 'FIC-107', summary: null, text: { description: null, acField: null } } },
    { name: 'no-key', raw: { summary: `no key ${MAIL2}`, text: { description: 'body' } } },
    { name: 'mr-gitlab-style', raw: { key: 'FIC-108', summary: 's', text: { description: 'See https://biosphere.example.com/oneplatform/islands/microsme/repo-be/-/merge_requests/61.' } } },
    { name: 'mr-without-dash', raw: { key: 'FIC-109', summary: 's', text: { description: 'MR: http://git.internal.example/team/repo/merge_requests/7, merged.' } } },
    { name: 'mr-trailing-punctuation', raw: { key: 'FIC-110', summary: 's', text: { description: '(https://gitlab.com/a/b/-/merge_requests/3);]' } } },
    { name: 'mr-remote-link-only', raw: { key: 'FIC-111', remoteLinks: [{ url: 'https://gitlab.example/group/repo/-/merge_requests/9' }], text: { description: 'no link in the body' } } },
    { name: 'mr-first-of-several', raw: { key: 'FIC-112', summary: 'see https://one.example/x/-/merge_requests/11', comments: [{ body: `by ${MAIL1}: https://two.example/y/merge_requests/22` }], text: { description: 'and https://three.example/z/-/merge_requests/33' } } },
    { name: 'mr-in-comment-and-adf', raw: { key: 'FIC-113', comments: [{ author: MAIL2, body: doc(p(tx('fix in https://gitlab.example/g/r/-/merge_requests/1234'))) }], text: { description: doc(p(tx('nothing here'))) } } },
    { name: 'untouched-fields', raw: { key: 'FIC-114', browse: 'https://teamsystem.atlassian.net/browse/FIC-114', issuetype: 'Story', status: 'DONE', labels: ['CS-Tech-bug', 'warehouse'], scenarios: [{ then: `shows ${ID3}` }], flags: ['x'], gitlab: { url: 'stale', iid: 1 }, summary: 'plain', text: { description: 'plain', acField: 'plain', extra: `dropped ${ID1}` } } },
  ]
}
