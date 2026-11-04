#!/usr/bin/env python3
"""Builds docs/drafts/quality-code-<version>-commands.pdf: the commands, grouped, with what is new.

    python3 scripts/build-commands-pdf.py
"""
from datetime import date
from pathlib import Path
import json

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
VERSION = json.loads((ROOT / 'plugins/quality-code/.claude-plugin/plugin.json').read_text())['version']
SHORT = '.'.join(VERSION.split('.')[:2])
OUT = ROOT / 'docs' / 'drafts' / f'quality-code-{SHORT}-commands.pdf'
TODAY = date.today().strftime('%-d %b %Y')

TS_BLUE, TS_DARK, TS_PALE = colors.HexColor('#0090D1'), colors.HexColor('#005075'), colors.HexColor('#E5F4FB')
INK, GREY, RULE = colors.HexColor('#1F2731'), colors.HexColor('#5A6872'), colors.HexColor('#C9D9E3')

FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
if FONT_DIR.exists():
    FONTS = {'Sans': 'DejaVuSans.ttf', 'Sans-Bold': 'DejaVuSans-Bold.ttf', 'Mono': 'DejaVuSansMono.ttf'}
else:  # macOS
    FONT_DIR = Path('/System/Library/Fonts/Supplemental')
    FONTS = {'Sans': 'Arial.ttf', 'Sans-Bold': 'Arial Bold.ttf', 'Mono': 'Courier New.ttf'}
for name, file in FONTS.items():
    pdfmetrics.registerFont(TTFont(name, FONT_DIR / file))
pdfmetrics.registerFontFamily('Sans', normal='Sans', bold='Sans-Bold', italic='Sans', boldItalic='Sans-Bold')

S = {
    'title': ParagraphStyle('t', fontName='Sans-Bold', fontSize=24, leading=28, textColor=TS_DARK, spaceAfter=4),
    'sub': ParagraphStyle('s', fontName='Sans', fontSize=11, leading=15, textColor=GREY, spaceAfter=10),
    'h1': ParagraphStyle('h1', fontName='Sans-Bold', fontSize=14, leading=18, textColor=TS_DARK, spaceBefore=10, spaceAfter=6),
    'body': ParagraphStyle('b', fontName='Sans', fontSize=9, leading=12.5, textColor=INK, spaceAfter=5),
    'cell': ParagraphStyle('c', fontName='Sans', fontSize=8.2, leading=10.6, textColor=INK),
    'head': ParagraphStyle('hd', fontName='Sans-Bold', fontSize=8.2, leading=10.6, textColor=colors.white),
}
M = lambda t: f'<font name="Mono" size="7.6">{t}</font>'


def p(t, s='body'):
    return Paragraph(t, S[s])


def table(head, rows, widths):
    data = [[Paragraph(h, S['head']) for h in head]] + [[Paragraph(c, S['cell']) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), TS_BLUE), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                           ('LINEBELOW', (0, 1), (-1, -1), 0.4, RULE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, TS_PALE]),
                           ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]))
    return t


def cmds(rows):
    return table(['Command', 'What it does', 'Example'], [[M(a), b, M(c)] for a, b, c in rows], [38, 86, 46])


def page(canvas, doc):
    canvas.saveState()
    canvas.setFont('Sans', 7.5)
    canvas.setFillColor(GREY)
    canvas.drawString(20 * mm, 12 * mm, f'Quality Code {SHORT} · commands · {TODAY}')
    canvas.drawRightString(190 * mm, 12 * mm, str(doc.page))
    canvas.restoreState()


new = [
    ('Setup only connects (0.55).', 'Setup no longer offers to add Playwright or Vitest; it ends with Setup completed and a table of what is connected. spec offers the runner card (Add it / Not now) at the plan stage when the repo lacks the runner.'),
    ('config-set and config-get (0.55).', 'Their own commands; tokens are never set there and show the /plugin configure steps instead.'),
    ('Richer cards and report pages (0.54).', 'Result cards get a headline row (verdict, score, bar with the gate, counts), a Next line and collapsible detail. kpi, tickets-eval and consumption take --report and write one self-contained HTML page with charts. The newer commands follow the same layout.'),
    ('Clear the cache, or undo the setup (0.53).', 'clean-cache deletes only the local cache. clean removes what the plugin created (setup files, saved output, cache; your tests and personal config only if you pick them) and always asks one explicit yes.'),
    ('config set (0.53).', 'Change one setting directly, for example config set git.base develop. Checked by the setup rules; nothing is written on an error or a secret.'),
    ('More kinds of tests (0.52).', 'Negative cases on every ticket, an axe accessibility scan, optional visual regression, database checks with Testcontainers, a regression test from a Bug, and a smoke suite (run-smoke, ci --smoke).'),
    ('Sprint goal from a Teams transcript (0.52).', 'transcript-goal turns a planning transcript into a sprint goal and tasks, with review cards; Jira only after a preview and your yes.'),
    ('Rewrite a weak story (0.51).', 'After ticket-eval, a script flags a long or thin description; rewrite it from the description, Figma or Confluence, then post to Jira or save locally.'),
    ('Memory, language and pickers (0.50).', 'Commands remember where you stopped and what they learned about the project; your language is kept; every question is a clickable picker; new tests go into the existing test structure first and follow the project\'s conventions before the stack\'s defaults.'),
    ('Plan card (0.48).', 'Before any test is written, spec shows what will be written and asks Yes, No or Something else, using your own libraries and flow when you have them. After spec it suggests run-backend or run-frontend.'),
]
story = [p(f'Quality Code {SHORT}', 'title'), p('The commands, and what is new. From Jira ticket to tests you can trust.', 'sub'),
         p(f'What is new since 0.44', 'h1')]
story += [p(f'<b>{a}</b> {b}') for a, b in new]
story += [p('Update first', 'h1'), p(M('/plugin update quality-code@teamsystem') + '<br/>' + M('/reload-plugins')),
          p('Type /quality-code: and check that the list shows clean, clean-cache, run-smoke and transcript-goal. Or run ' + M('/quality-code:check-update') + '.'),
          PageBreak()]

story += [p('1. Set up and settings', 'h1'), cmds([
    ('/quality-code:setup', 'Checks the connectors, finds the project, its stack, Jira project and base branch, shows one card to confirm and writes .claude/quality-code.json. Option 2 is a personal setup for QA and PO with no repo.', '/quality-code:setup\n/quality-code:setup advanced'),
    ('/quality-code:config', 'Shows a short summary and changes one setting at a time. Tokens and plugin settings (Jira email, GitLab, Xray) are checked, never echoed.', '/quality-code:config'),
    ('/quality-code:config-set, config-get', 'Change or read one setting directly. Dotted keys, lists with commas, typed values; --personal, --project, --yes.', '/quality-code:config set git.base develop\n/quality-code:config get jira.site'),
    ('/quality-code:check-update', 'Says whether a newer version is out and what changed; offers to update.', '/quality-code:check-update'),
    ('/quality-code:clean-cache', 'Deletes only the plugin\'s local cache (saved stops, reused facts, language) for this project, or every project with --all.', '/quality-code:clean-cache --all'),
    ('/quality-code:clean', 'Removes what the plugin created in the project. A script lists it by group; you pick the groups and say yes once. Never skipped by --yes or --ci. --dry-run only lists.', '/quality-code:clean --dry-run'),
]),
          p('2. Every day: from ticket to tests', 'h1'), cmds([
    ('/quality-code:spec', 'The main command. Runs the readiness gate, shows the plan (with Negative, Accessibility, Visual and Database lines when they apply), writes the tests in your test folders, runs the pipeline and reads the card back. A Bug ticket leaves a @regression test.', '/quality-code:spec ABC-123\n/quality-code:spec ABC-123 --gate-only'),
    ('/quality-code:ticket-eval', 'Scores one ticket out of 100 (70 passes). If the story is long or thin, offers to rewrite it from the description, Figma or Confluence; post to Jira after a preview, or save locally.', '/quality-code:ticket-eval ABC-123'),
    ('/quality-code:ticket', 'Finds a ticket and shows it in short, with tips for its author. Read-only.', '/quality-code:ticket assignee:me'),
    ('/quality-code:transcript-goal', 'Reads a Teams planning transcript (file, pasted text or the Microsoft 365 connector), drafts the sprint goal and tasks, asks only what was not said, shows review cards, then creates the tasks in Jira after a preview and your yes, or saves them locally.', '/quality-code:transcript-goal --file planning.vtt'),
]),
          PageBreak(),
          p('3. Run and grade the tests', 'h1'), cmds([
    ('/quality-code:run-frontend', 'Every Playwright spec of the project.', '/quality-code:run-frontend'),
    ('/quality-code:run-backend', 'Every backend spec: Vitest, pytest, JUnit, Go or .NET.', '/quality-code:run-backend'),
    ('/quality-code:run-pipeline', 'The full suite. --branch: only the tests your branch changed. --evals: the frozen evals.', '/quality-code:run-pipeline --branch'),
    ('/quality-code:run-smoke', 'Only the tests tagged @smoke, against the running app or any URL. Read-only. Frontend only for now.', '/quality-code:run-smoke --url https://staging.example.com'),
]),
          p('The card ends in one verdict, decided by a script: green, tests red, checks failed or not verified. A Bug ticket also shows the fail-then-pass proof (--regression-before red|green).'),
          p('4. CI and scheduled checks', 'h1'), cmds([
    ('/quality-code:ci', 'Writes the CI file for GitHub Actions or GitLab: a quick quality-gate and a quality-tests job. --smoke adds an optional post-deploy job that runs the smoke suite against SMOKE_URL.', '/quality-code:ci github\n/quality-code:ci --smoke'),
    ('/quality-code:routine', 'Schedules a run with Claude\'s scheduler; reports a change from green to red; --stability N finds flaky tests; --regression runs the @regression suite.', '/quality-code:routine run --regression'),
]),
          p('5. For QA and product owners', 'h1'), cmds([
    ('/quality-code:tickets-eval', 'Scores a whole Jira project, read-only. --report writes an HTML page with charts.', '/quality-code:tickets-eval ABC'),
    ('/quality-code:xray', 'Writes Xray test cases from a ticket as a CSV and case.xlsx.', '/quality-code:xray ABC-123'),
    ('/quality-code:qa', 'Runs your Xray manual tests with an agent; you give every verdict; nothing reaches Jira without a preview.', '/quality-code:qa --resume'),
    ('/quality-code:seed', 'Loads realistic mock data for a ticket into your local database only.', '/quality-code:seed ABC-123'),
]),
          p('6. Numbers', 'h1'), cmds([
    ('/quality-code:kpi', 'Tickets gated, fill-ins, verdicts and the Quality Program numbers. Read-only. --report writes an HTML page with charts.', '/quality-code:kpi --since 30d --report'),
    ('/quality-code:consumption', 'AI usage and estimated cost of the plugin\'s runs, read locally. --report writes an HTML page with charts.', '/quality-code:consumption --by command'),
])]

SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=20 * mm,
                  title=f'Quality Code {SHORT} commands', author='Elvis Zefaj').build(story, onFirstPage=page, onLaterPages=page)
print(OUT)
