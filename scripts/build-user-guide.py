#!/usr/bin/env python3
"""Builds docs/quality-code-user-guide.pdf: how to use quality-code, step by step.

    python3 scripts/build-user-guide.py

Colours: TeamSystem's palette (Vapor design system). Change them here if the brand team says otherwise.
"""
from pathlib import Path
import json

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle, Preformatted)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'quality-code-user-guide.pdf'
VERSION = json.loads((ROOT / 'plugins/quality-code/.claude-plugin/plugin.json').read_text())['version']

TS_BLUE = colors.HexColor('#0090D1')
TS_DARK = colors.HexColor('#005075')
TS_LIGHT = colors.HexColor('#00C3EA')
TS_PALE = colors.HexColor('#E5F4FB')
INK = colors.HexColor('#1F2731')
GREY = colors.HexColor('#5A6872')
RULE = colors.HexColor('#C9D9E3')

FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
pdfmetrics.registerFont(TTFont('Sans', FONT_DIR / 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('Sans-Bold', FONT_DIR / 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FONT_DIR / 'DejaVuSansMono.ttf'))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')

S = {
    'title': ParagraphStyle('title', fontName='Sans-Bold', fontSize=26, leading=31, textColor=colors.white),
    'subtitle': ParagraphStyle('subtitle', fontName='Sans', fontSize=12.5, leading=17, textColor=colors.white),
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=16, leading=20, textColor=TS_DARK, spaceBefore=4, spaceAfter=8),
    'h2': ParagraphStyle('h2', fontName='Sans-Bold', fontSize=12, leading=15, textColor=TS_BLUE, spaceBefore=10, spaceAfter=4),
    'body': ParagraphStyle('body', fontName='Sans', fontSize=9.6, leading=13.6, textColor=INK, alignment=TA_LEFT, spaceAfter=5),
    'small': ParagraphStyle('small', fontName='Sans', fontSize=8.4, leading=11.5, textColor=GREY),
    'cell': ParagraphStyle('cell', fontName='Sans', fontSize=8.8, leading=11.8, textColor=INK),
    'cellb': ParagraphStyle('cellb', fontName='Sans-Bold', fontSize=8.8, leading=11.8, textColor=colors.white),
    'step': ParagraphStyle('step', fontName='Sans', fontSize=9.6, leading=13.6, textColor=INK, leftIndent=16, firstLineIndent=-16, spaceAfter=4),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.6, leading=11.6, textColor=TS_DARK),
}


def p(text, style='body'):
    return Paragraph(text, S[style])


def code(text):
    t = Table([[Preformatted(text.strip('\n'), S['code'])]], colWidths=[170 * mm])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), TS_PALE),
        ('LINEBEFORE', (0, 0), (0, -1), 2.2, TS_BLUE),
        ('LEFTPADDING', (0, 0), (-1, -1), 8), ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 5), ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return KeepTogether([t, Spacer(1, 6)])


def table(header, rows, widths):
    data = [[p(h, 'cellb') for h in header]] + [[p(c, 'cell') for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), TS_DARK),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TS_PALE]),
        ('LINEBELOW', (0, 0), (-1, -1), 0.4, RULE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    return KeepTogether([t, Spacer(1, 8)])


def steps(items, start=1):
    return [p(f'<font color="#0090D1"><b>{i}.</b></font>&nbsp;&nbsp;{t}', 'step') for i, t in enumerate(items, start)]


def cover(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(TS_DARK)
    canvas.rect(0, h - 105 * mm, w, 105 * mm, stroke=0, fill=1)
    canvas.setFillColor(TS_BLUE)
    canvas.rect(0, h - 109 * mm, w, 4 * mm, stroke=0, fill=1)
    canvas.setFillColor(TS_LIGHT)
    canvas.rect(0, h - 111 * mm, w * 0.35, 2 * mm, stroke=0, fill=1)
    canvas.setFont('Sans', 8)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 12 * mm, f'quality-code {VERSION} · github.com/vissz28/agentic-testing')
    canvas.restoreState()


def page(canvas, doc):
    w, h = A4
    canvas.saveState()
    canvas.setFillColor(TS_DARK)
    canvas.rect(0, h - 11 * mm, w, 11 * mm, stroke=0, fill=1)
    canvas.setFillColor(TS_BLUE)
    canvas.rect(0, h - 12.2 * mm, w, 1.2 * mm, stroke=0, fill=1)
    canvas.setFont('Sans-Bold', 8.5)
    canvas.setFillColor(colors.white)
    canvas.drawString(20 * mm, h - 7.3 * mm, 'quality-code · user guide')
    canvas.setFont('Sans', 8.5)
    canvas.drawRightString(w - 20 * mm, h - 7.3 * mm, f'version {VERSION}')
    canvas.setFillColor(GREY)
    canvas.setFont('Sans', 8)
    canvas.drawRightString(w - 20 * mm, 12 * mm, f'{doc.page}')
    canvas.restoreState()


story = []
story += [Spacer(1, 22 * mm), p('quality-code', 'title'), Spacer(1, 4 * mm),
          p('From a Jira ticket to tests you can trust.<br/>How to use it, step by step.', 'subtitle'),
          Spacer(1, 52 * mm)]
story += [p('What it is', 'h1'),
          p('quality-code is a Claude Code plugin for any Jira project and any repo with Vitest or Playwright. '
            'It checks that a ticket is clear enough to test, helps its author fill the gaps, writes the tests '
            'from the ticket and grades them. <b>Claude writes; scripts decide.</b> A score, a verdict, a pass or '
            'a refusal always comes from a script, never from the model\'s opinion.'),
          table(['You want to', 'Command'], [
              ['Set up a repo (once)', '<font name="Mono">/quality-code:setup</font>'],
              ['Start your day on a feature branch', '<font name="Mono">/quality-code:start</font>'],
              ['Check whether a ticket is ready to test', '<font name="Mono">/quality-code:ticket-eval ABC-123</font>'],
              ['Run and grade the tests on your branch', '<font name="Mono">/quality-code:check</font>'],
              ['Have tests written from a ticket', '<font name="Mono">/quality-code:write ABC-123</font>'],
              ['Write only the test data a ticket needs', '<font name="Mono">/quality-code:seed ABC-123</font>'],
              ['See how the team uses it', '<font name="Mono">/quality-code:kpi</font>'],
              ['See what the AI runs cost', '<font name="Mono">/quality-code:consumption</font>'],
          ], [80, 90]),
          PageBreak()]

story += [p('1. Install (each person, once)', 'h1'),
          p('<b>You need:</b> Claude Code (desktop app, terminal or IDE), Node 18 or newer, a repo whose '
            '<font name="Mono">package.json</font> has <font name="Mono">vitest</font> or '
            '<font name="Mono">@playwright/test</font>, and access to your Jira site.'),
          *steps([
              'In a Claude Code session, inside your repo, add the marketplace and install the plugin:',
          ]),
          code('/plugin marketplace add vissz28/agentic-testing\n/plugin install quality-code@quality-code'),
          *steps([
              f'Open <font name="Mono">/plugin</font> and check that quality-code shows version <b>{VERSION}</b>. '
              'If it shows an older one, go to <b>Marketplaces</b>, pick quality-code, choose <b>Update marketplace</b> '
              'and <b>Enable auto-update</b>, then update the plugin and start a new session.',
              'Connect Jira: run <font name="Mono">/mcp</font>, choose <font name="Mono">atlassian-rovo</font> and sign in '
              '(an Atlassian connection you already have in claude.ai works too). GitLab and Figma are optional.',
          ], start=2),
          p('2. Set up the repo (one person, once)', 'h1'),
          code('/quality-code:setup'),
          *steps([
              'Answer the numbered cards: the stack (Vitest or Playwright), the Jira site and project, the '
              'acceptance-criteria field. Type the number of your choice each time.',
              'Setup writes <font name="Mono">.claude/quality-code.json</font> only after you confirm, then proves the '
              'setup on one recent ticket.',
              'Commit the config and the <font name="Mono">.gitignore</font> lines it adds.',
              'Later, <font name="Mono">/quality-code:setup advanced</font> adds forbidden paths (code a test run must '
              'never change), feature labels, title prefixes, templates and, for Vitest, test folders.',
          ]),
          p('To offer the plugin to everyone who opens the repo, commit this in '
            '<font name="Mono">.claude/settings.json</font>:'),
          code('{\n  "extraKnownMarketplaces": {\n    "quality-code": { "source": { "source": "github", '
               '"repo": "vissz28/agentic-testing" } }\n  },\n  "enabledPlugins": { "quality-code@quality-code": true }\n}'),
          PageBreak()]

story += [p('3. Every day: start from your branch', 'h1'),
          code('/quality-code:start'),
          *steps([
              'It checks your connectors (Jira must be connected).',
              'It shows the repo card: your branch, its base branch and what the branch changed. Confirm with 1.',
              'It proposes the ticket from the branch name (for example <font name="Mono">ABC-123-add-export</font>). '
              'Pick <b>1. Use ABC-123</b> or <b>2. A different ticket</b>.',
              'It offers what to do: <b>1. Evaluate the ticket</b>, <b>2. Check the tests on this branch</b>, '
              '<b>3. Write and check tests</b>.',
          ]),
          p('4. Check a ticket: the readiness gate', 'h1'),
          code('/quality-code:ticket-eval ABC-123'),
          p('The ticket gets a score out of 100. <b>70 or more passes</b>, for every team. The score rewards '
            'acceptance criteria (Gherkin, or at least 150 characters of plain language under an '
            'Acceptance criteria heading), testable results (no "works correctly"), steps or a user story, the '
            'expected behaviour and the context. Customer ids, e-mails and UUIDs are redacted before scoring.'),
          p('Below 70, the refuse card', 'h2'),
          table(['Option', 'What happens'], [
              ['1. Post a comment on Jira', 'A comment listing exactly what to add, with examples. You see a preview first.'],
              ['2. I will add the missing information here', 'A guided fill-in: pick the missing items, answer one short '
               'question each; the script says whether each answer counts. Then you can push the added parts to Jira '
               '(append only, preview first).'],
              ['3. Continue anyway (developers only)', 'Nothing is posted. Inside <font name="Mono">write</font>, tests are still '
               'written, but every result card opens with <b>[RISK / NOT RECOMMENDED] Ticket incomplete (score/70)</b> '
               'and the override is recorded.'],
          ], [62, 108]),
          p('In CI: <font name="Mono">ticket-eval ABC-123 --ci</font> asks nothing; a refused ticket gets the Jira '
            'comment and the job fails.', 'small'),
          PageBreak()]

story += [p('5. Check the tests on your branch', 'h1'),
          code('/quality-code:check                       # the test files your branch changed\n'
               '/quality-code:check test/orders.spec.ts   # or name the specs\n'
               '/quality-code:check --key ABC-123 --flaky 3'),
          p('The pipeline always runs the same steps, in this order, and a script decides the verdict:'),
          table(['Step', 'It checks'], [
              ['boundary', 'during a writing run: no change outside the test folders'],
              ['honesty', 'no assertion or test removed, no skip without a ticket'],
              ['assertions', 'every test that runs has an expect(...)'],
              ['types', 'the specs compile (tsc --noEmit)'],
              ['tests', 'the tests run, with your own Vitest or Playwright'],
              ['expected', 'with a ticket: the ticket\'s numbers and quoted texts are asserted'],
              ['mutation', 'each assertion can fail when its value changes'],
              ['flaky', 'with --flaky N: no test changes result between runs'],
              ['stryker', 'Vitest, with --target and Stryker installed: the tests catch changes in the code'],
          ], [30, 140]),
          table(['Verdict', 'Meaning', 'Exit'], [
              ['green', 'every step ran and passed', '0'],
              ['checks failed', 'a check failed: the card says what to do', '1'],
              ['tests red', 'the checks pass but tests fail (expected for a bug whose fix is not merged)', '1'],
              ['not verified', 'something could not run; never counted as green', '3'],
          ], [30, 125, 15]),
          p('Playwright: the app must be running, or started by your Playwright config\'s webServer. If it is down, '
            'the verdict is "not verified", never red.', 'small'),
          PageBreak()]

story += [p('6. Have tests written from a ticket', 'h1'),
          code('/quality-code:write ABC-123\n/quality-code:write ABC-123 --target src/pricing.ts   # Vitest\n'
               '/quality-code:write ABC-123 --route /orders           # Playwright'),
          *steps([
              '<b>Gate.</b> The ticket is scored first. Only a ticket that passes (or option 3, marked at risk) gets tests.',
              '<b>Target.</b> Vitest: which code the ticket changes. Playwright: which screen (from --route or the '
              'feature\'s route). Pick from the card.',
              '<b>Plan.</b> The scenarios from the ticket, one line each, and where each goes. Pick '
              '<b>1. Write these tests</b>.',
              '<b>Write.</b> The specs are written only in your test folders; application code is never touched '
              '(a hook blocks it). Real expected values from the ticket, one test per scenario.',
              '<b>Check.</b> The pipeline grades them. Fixable problems get at most 2 rewrites of the tests only.',
              '<b>Card.</b> You get the last card as printed, and the spec paths. Read the tests before you commit them.',
          ]),
          p('For a <b>Bug</b>, a red test that asserts the ticket\'s expected value is the right result: it goes green '
            'when the fix is merged. On Playwright, up to 3 extra probes (titled "Extra: ...") try cases the ticket '
            'did not state; <font name="Mono">--no-extras</font> leaves them out.'),
          p('7. Write only the test data', 'h1'),
          code('/quality-code:seed ABC-123\n/quality-code:seed ABC-123 --path test/unit/orders.abc-123.spec.ts'),
          p('Vitest: calls to your own seed builders, with the ticket\'s exact values. Playwright: route stubs copied '
            'from a stub you already have. It never invents a value or a response shape and never writes to a '
            'database. It prints the block, or puts it into an existing spec with --path.'),
          p('8. See how it is used, and what it costs', 'h1'),
          code('/quality-code:kpi --since 30d\n/quality-code:consumption --by ticket'),
          p('<b>kpi</b>: tickets gated, fill-ins, Jira comments, forced runs, verdicts, boundary blocks (from a local, '
            'git-ignored audit log; keys and numbers only). <b>consumption</b>: AI tokens and an estimated cost per '
            'command, ticket, day or model, read from Claude Code\'s local logs. Both send nothing anywhere.'),
          PageBreak()]

story += [p('9. Bringing a team on board', 'h1'),
          p('Checklist for a team lead', 'h2'),
          table(['', 'Done when'], [
              ['Plugin', f'everyone has quality-code {VERSION} or later and Jira connected (start shows Jira connected)'],
              ['Config', '.claude/quality-code.json reviewed, committed, and someone owns it'],
              ['Boundaries', 'the forbidden paths cover your application code (default: src/, .env, .env.*, the CI file)'],
              ['Vitest', 'the test folders are right; Stryker installed if you want its bar'],
              ['CI', 'a job runs ticket-eval KEY --ci, if you gate tickets in CI'],
              ['Feedback', 'everyone knows to report a surprise as an issue with the ticket key and the card'],
          ], [28, 142]),
          p('Moving from your own harness', 'h2'),
          *steps([
              'Set up quality-code and compare first: ticket-eval on recent tickets with both, check on the same specs.',
              'In one merge request: add the config, remove the old harness (commands, skills, hooks, scripts, their '
              'lines in CLAUDE.md). Never keep two harnesses in one repo.',
              'Replace a CI ticket gate with ticket-eval KEY --ci.',
          ]),
          p('The full runbook for the warehouse repos is <font name="Mono">docs/rollout/onboarding-quality.md</font>.', 'small'),
          p('10. If something goes wrong', 'h1'),
          table(['You see', 'Do this'], [
              ['An old version in /plugin', 'Marketplaces, quality-code, Update marketplace; then update the plugin and start a new session.'],
              ['This repo is not set up', 'Run /quality-code:setup.'],
              ['Jira not connected', 'Run /mcp, choose atlassian-rovo, sign in.'],
              ['Another test-writing run is active', 'Pick 1 to stop it and start yours. A run older than 12 hours is replaced on its own.'],
              ['The app is not reachable (Playwright)', 'Start the app, or let the webServer in your Playwright config start it, and check again.'],
              ['A write is blocked by the boundary', 'The test tried to change application code. Tests never do; ask a person if it really belongs there.'],
          ], [62, 108]),
          Spacer(1, 6),
          p('More: the README and docs/GETTING_STARTED.md in github.com/vissz28/agentic-testing; what changed in each '
            'version is in CHANGELOG.md.', 'small')]

doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=20 * mm,
                        bottomMargin=20 * mm, title='quality-code user guide', author='Elvis Zefaj',
                        subject='How to use quality-code, step by step')
doc.build(story, onFirstPage=cover, onLaterPages=page)
print(OUT)
