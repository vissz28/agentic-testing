// Runs the project's Cypress through its Module API, the one way Cypress gives a result per test, and
// writes them as JSON. argv: <out.json> <config file or ""> <spec>…; the project is the working
// directory. Screenshots, videos and downloads go next to <out.json>, never into the project.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const [out, configFile, ...specs] = process.argv.slice(2)
const tmp = dirname(out)
let r
try {
  const cypress = createRequire(join(process.cwd(), 'package.json'))('cypress')
  r = await cypress.run({
    spec: specs.join(','),
    quiet: true,
    ...(configFile ? { configFile } : {}),
    config: { screenshotsFolder: join(tmp, 'screenshots'), videosFolder: join(tmp, 'videos'), downloadsFolder: join(tmp, 'downloads') },
  })
} catch (e) {
  r = { status: 'failed', message: String(e?.message ?? e) }
}
writeFileSync(out, JSON.stringify(r))
