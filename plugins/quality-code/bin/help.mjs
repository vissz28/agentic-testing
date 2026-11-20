// /help: setup status and next steps per role. Examples come from each command file so they never drift.
import { readdirSync, readFileSync } from 'node:fs'
import { loadConfig, projectRoot } from '../lib/config/config.mjs'
import { readJson } from '../lib/core/files.mjs'
import { isMain, lineWriter } from '../lib/core/script-io.mjs'

const COMMANDS = new URL('../commands/', import.meta.url)
const USAGE = 'usage: help.mjs [<command>] [--dev | --qa | --po] [--all] [--version]'
const MAX_EXAMPLES = 3

const ROLES = {
  dev: {
    name: 'Developer',
    steps: [
      [null, 'Create a feature branch for the ticket.'],
      ['spec', 'checks the ticket is ready, writes its tests and checks them.'],
      ['seed', 'loads mock data for the ticket into your local database, to try it by hand.'],
      ['check', 'with `--branch`, before the merge request, checks the tests changed on your branch.', '--branch']
    ],
    also: ['ticket', 'ci', 'routine', 'report']
  },
  qa: {
    name: 'QA',
    steps: [
      ['ticket', 'with `<KEY> --eval`, checks the ticket is ready for tests and says what is missing.', '--eval'],
      ['xray', 'writes the ticket\'s Xray test cases, ready to import.'],
      ['qa', 'runs your test execution with you in the browser and drafts each defect.']
    ],
    also: ['report']
  },
  po: {
    name: 'PO',
    steps: [
      ['transcript-goal', 'after sprint planning, turns the meeting into a sprint goal and its tasks.'],
      ['ticket', 'with `<PROJECT> --eval`, shows how ready the backlog is; with `<KEY> --eval`, what to add to a weak ticket.', '--eval']
    ],
    also: ['report']
  }
}
const EVERYONE = ['config', 'update', 'clean']

export function commandInfo(name) {
  let t
  try { t = readFileSync(new URL(`${name}.md`, COMMANDS), 'utf8') } catch { return null }
  // Some values are YAML single-quoted ('' is one quote) because Copilot parses frontmatter as strict YAML.
  const field = k => { const v = new RegExp(`^${k}: (.*)$`, 'm').exec(t.split('\n---\n')[0])?.[1] ?? ''; return /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v }
  const section = /\n## Examples\n([\s\S]*?)(?=\n## |$)/.exec(t)?.[1] ?? ''
  return { description: field('description'), hint: field('argument-hint'), examples: section.split('\n').filter(l => l.startsWith('- ')) }
}
const commandNames = () => readdirSync(COMMANDS).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3)).sort()
const firstSentence = s => /^.*?\.(?=\s|$)/.exec(s)?.[0] ?? s
const cmd = n => `\`/quality-code:${n}\``

export function rolePath(role) {
  const r = ROLES[role]
  const lines = [`### What you can do now (${r.name})`, '']
  r.steps.forEach(([name, what, flag], i) => {
    lines.push(name ? `${i + 1}. ${cmd(name)}: ${what}` : `${i + 1}. ${what}`)
    const examples = name ? commandInfo(name).examples : []
    for (const e of examples.filter(x => !flag || x.includes(flag)).slice(0, MAX_EXAMPLES)) lines.push(`   ${e}`)
  })
  lines.push('', `Also: ${[...r.also, ...EVERYONE].map(cmd).join(', ')}. More on any command: \`/quality-code:help <command>\`.`)
  return lines.join('\n')
}

export function oneCommand(name) {
  const c = commandInfo(name)
  if (!c) return null
  const lines = [`### ${cmd(name)}${c.hint && c.hint !== '(no arguments)' ? ` ${c.hint}` : ''}`, '', c.description]
  if (c.examples.length) lines.push('', '**Examples**', ...c.examples)
  return lines.join('\n')
}

export const allCommands = () => ['### Every command', '', '| Command | What it does |', '|---|---|', ...commandNames().map(n => `| ${cmd(n)} | ${firstSentence(commandInfo(n).description).replace(/\|/g, '\\|')} |`)].join('\n')

export function main(argv = process.argv.slice(2), { env = process.env, cwd = process.cwd(), stdout = s => process.stdout.write(s), stderr = s => process.stderr.write(s) } = {}) {
  const printLine = lineWriter(stdout), printError = lineWriter(stderr)
  const flags = argv.filter(a => a.startsWith('-'))
  const names = argv.filter(a => !a.startsWith('-'))
  const roleFlags = flags.filter(f => ['--dev', '--qa', '--po'].includes(f))
  const bad = flags.find(f => !roleFlags.includes(f) && !['--all', '--version'].includes(f))
  if (bad || names.length > 1 || roleFlags.length > 1) { printError(`${bad ? `unknown option ${bad}. ` : ''}${USAGE}`); return 2 }
  if (flags.includes('--version')) { printLine(`Quality Code ${readJson(new URL('../.claude-plugin/plugin.json', import.meta.url)).version}`); return 0 }
  if (flags.includes('--all')) { printLine(allCommands()); return 0 }
  if (names.length) {
    const one = oneCommand(names[0].replace(/^\/?(quality-code:)?/, ''))
    if (!one) { printError(`no command ${names[0]}. Every command: /quality-code:help --all`); return 2 }
    printLine(one)
    return 0
  }
  const cfg = loadConfig(projectRoot(env, cwd), env)
  const asked = roleFlags[0]?.slice(2)
  if (!cfg.ok) {
    printLine(cfg.missing
      ? 'Quality Code is not set up here yet. Run `/quality-code:setup` first: in your repo as a developer, or from any folder as QA or PO (Jira only, no repo).'
      : `Quality Code's config has a problem:\n${cfg.errors.map(e => `- ${e}`).join('\n')}\nFix it with \`/quality-code:setup\`.`)
    // Still show the asked role as a preview.
    if (asked) printLine(`\n${rolePath(asked)}`)
    return 0
  }
  const c = cfg.config
  printLine(`Set up: Jira ${c.jira.site.replace(/^https:\/\//, '')}, project(s) ${c.jira.projects.includes('*') ? 'any' : c.jira.projects.join(', ')} (${cfg.source === 'repo' ? 'this repo' : 'personal, no repo'}).\n`)
  // Personal config from before setup stored the role: show both.
  const roles = asked ? [asked] : cfg.source === 'repo' ? ['dev'] : c.role ? [c.role] : ['qa', 'po']
  printLine(roles.map(rolePath).join('\n\n'))
  printLine(`\nAnother role: \`--dev\`, \`--qa\` or \`--po\`. Every command: \`--all\`.`)
  return 0
}

if (isMain(import.meta.url)) process.exitCode = main()
