// The shell of the one-file HTML report: shared CSS (light and dark through custom properties), escaping and
// the page frame. Inline CSS and SVG only: no script, no font, no image, no link to anywhere.
export const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export const CSS = `
:root{--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--card:#f6f8fa;--line:#d1d9e0;--pass:#1a7f37;--warn:#9a6700;--fail:#cf222e;--idle:#6e7781;--accent:#0969da}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--card:#151b23;--line:#3d444d;--pass:#3fb950;--warn:#d29922;--fail:#f85149;--idle:#8b949e;--accent:#4493f8}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
main{max-width:920px;margin:0 auto}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 4px}
h2{font-size:1.1rem;margin:0 0 8px}
p{margin:0 0 8px}
.sub,.note,.foot{color:var(--muted);font-size:.875rem}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;min-width:0}
.card.wide{grid-column:1/-1}
.tiles{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr));margin:16px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px}
.tile b{display:block;font-size:1.5rem;line-height:1.2}
.tile span{color:var(--muted);font-size:.875rem}
.empty{color:var(--muted);border:1px dashed var(--line);border-radius:8px;padding:16px;text-align:center;margin:0}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 0;padding:0;list-style:none;font-size:.875rem;color:var(--muted)}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}
svg{display:block;width:100%;height:auto}
svg text{fill:var(--fg);font:11px system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
svg .m{fill:var(--muted)}
svg .grid-line{stroke:var(--line);stroke-width:1}
svg .mark{stroke:var(--fg);stroke-width:1;stroke-dasharray:3 3}
svg .track{fill:none;stroke:var(--line);stroke-width:10;stroke-linecap:round}
svg .arc{fill:none;stroke-width:10;stroke-linecap:round}
svg .line{fill:none;stroke:var(--accent);stroke-width:2}
svg .big{font-size:20px;font-weight:600;text-anchor:middle}
svg .dot{fill:var(--accent)}
.t-pass{fill:var(--pass);background:var(--pass)}
.t-warn{fill:var(--warn);background:var(--warn)}
.t-fail{fill:var(--fail);background:var(--fail)}
.t-idle{fill:var(--idle);background:var(--idle)}
.t-accent{fill:var(--accent);background:var(--accent)}
svg .arc.t-pass{stroke:var(--pass)}
svg .arc.t-warn{stroke:var(--warn)}
svg .arc.t-fail{stroke:var(--fail)}
svg .arc.t-idle{stroke:var(--idle)}
svg .arc.t-accent{stroke:var(--accent)}
svg .arc{fill:none}
`.trim()

/** A complete page. `body` is already-built HTML; the title and subtitle are escaped here. */
export function page({ title, subtitle = '', body, foot = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
<h1>${esc(title)}</h1>
${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
${body}
${foot ? `<p class="foot">${esc(foot)}</p>` : ''}
</main>
</body>
</html>
`
}

export const card = (title, inner, { wide = false, note = '' } = {}) =>
  `<section class="card${wide ? ' wide' : ''}"><h2>${esc(title)}</h2>${inner}${note ? `<p class="note">${esc(note)}</p>` : ''}</section>`

export const grid = cards => `<div class="grid">${cards.join('\n')}</div>`
export const tiles = list => `<div class="tiles">${list.map(([value, label]) => `<div class="tile"><b>${esc(value)}</b><span>${esc(label)}</span></div>`).join('')}</div>`
export const empty = text => `<p class="empty">${esc(text)}</p>`
