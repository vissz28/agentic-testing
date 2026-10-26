# Quality Code brand

<img src="../../plugins/quality-code/assets/logo.svg" width="96" alt="Quality Code logo">

## Name

- **Quality Code** in text, titles and the plugin's display name.
- `quality-code` only where a machine reads it: the install command, the commands
  (`/quality-code:spec`), file and folder names, the marketplace.

## Tagline

> From Jira ticket to tests you can trust.

One-line description: *Quality Code checks that a Jira ticket is ready to test, writes the tests from
its acceptance criteria, and grades them with scripts, never with the model.*

## The mark

Code brackets around a check mark: the code you have, the tests that prove it. White brackets and a
light-blue check on a rounded square that runs from deep blue to blue.

| File | Use |
|---|---|
| [`plugins/quality-code/assets/logo.svg`](../../plugins/quality-code/assets/logo.svg) | the mark, any size |
| [`plugins/quality-code/assets/logo.png`](../../plugins/quality-code/assets/logo.png) | the mark, 512 × 512, the plugin's `icon` |
| [`docs/brand/wordmark.svg`](wordmark.svg) | the mark with the name and tagline, for the README and slides |

The PNG is rendered from the same geometry by [`render_logo.py`](render_logo.py) (`python3
docs/brand/render_logo.py`); change both together.

- Keep space around the mark of at least a quarter of its width.
- Do not recolour, stretch, rotate or add effects to it. On a dark background, use it as it is: the
  square carries its own colour.

## Colours

The TeamSystem palette (Vapor design system), the same as the user guide PDF.

| Name | Hex | Used for |
|---|---|---|
| Deep blue | `#005075` | gradient start, "Code" in the wordmark |
| Blue | `#0090D1` | gradient end, "Quality" in the wordmark, links |
| Light blue | `#00C3EA` | the check mark |
| Pale blue | `#E5F4FB` | backgrounds, table headers |
| Ink | `#1F2731` | body text |
| Grey | `#5A6872` | the tagline, secondary text |

## Voice

Plain English, short sentences, common words. Say what happens and what to do next. The plugin
never says a test is good: the scripts decide, and the words say what they found.
