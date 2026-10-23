// The backends: one entry per test runner a project's backend side can use. Everything that differs
// between stacks and is not syntax (the dialect) or running (the runner) lives here, so a new stack is
// one entry plus its runner, dialect and writing guide. No imports: config.mjs and stack.mjs read it.

// JavaScript and TypeScript sources, as branch.mjs always counted them.
const JS_CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|vue|svelte|astro|html)$/

const entry = e => Object.freeze({ ...e, defaultLayers: Object.freeze(e.defaultLayers.map(l => Object.freeze(l))) })

export const BACKENDS = Object.freeze({
  vitest: entry({
    label: 'Vitest',
    language: 'TypeScript',
    testFile: /\.(spec|test)\.[cm]?[jt]sx?$/,
    codeFile: JS_CODE,
    defaultLayers: [{ name: 'unit', folder: 'test/' }],
    stryker: true,
    typeCheck: 'tsc',
    compiled: false,
    timeoutSeconds: 300,
    guide: 'vitest-writing.md',
  }),
  pytest: entry({
    label: 'pytest',
    language: 'Python',
    testFile: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/,
    codeFile: /\.py$/,
    defaultLayers: [{ name: 'unit', folder: 'tests/' }],
    stryker: false,
    typeCheck: null,
    compiled: false,
    timeoutSeconds: 300,
    guide: 'pytest-writing.md',
  }),
  junit: entry({
    label: 'JUnit',
    language: 'Java',
    testFile: /(?:^|\/)[^/]*(?:Test|Tests|IT)\.(?:java|kt)$/,
    codeFile: /\.(?:java|kt)$/,
    defaultLayers: [{ name: 'unit', folder: 'src/test/java/' }],
    stryker: false,
    typeCheck: null,
    compiled: true,
    // A first build downloads and compiles: more than a script's test run.
    timeoutSeconds: 600,
    guide: 'junit-writing.md',
  }),
  go: entry({
    label: 'Go',
    language: 'Go',
    testFile: /_test\.go$/,
    codeFile: /\.go$/,
    // Go tests live beside the code: the layer is the whole repo ("./").
    defaultLayers: [{ name: 'unit', folder: './' }],
    stryker: false,
    typeCheck: null,
    compiled: true,
    timeoutSeconds: 300,
    guide: 'go-writing.md',
  }),
  dotnet: entry({
    label: '.NET',
    language: 'C#',
    testFile: /(?:Tests?\.cs|Tests\.fs)$/,
    codeFile: /\.(?:cs|fs|razor|cshtml)$/,
    defaultLayers: [{ name: 'unit', folder: 'tests/' }],
    stryker: false,
    typeCheck: null,
    compiled: true,
    timeoutSeconds: 600,
    guide: 'dotnet-writing.md',
  }),
})

export const BACKEND_ADAPTERS = Object.freeze(Object.keys(BACKENDS))

export const isBackend = adapter => typeof adapter === 'string' && Object.hasOwn(BACKENDS, adapter)

/**
 * The adapter of a project's backend side: the adapter itself on a backend project, the "backend"
 * field (default vitest) on a fullstack one, null on a frontend project.
 */
export function backendOf(config) {
  if (isBackend(config?.adapter)) return config.adapter
  if (config?.adapter === 'fullstack') return isBackend(config.backend) ? config.backend : 'vitest'
  return null
}

/** The registry entry of the project's backend, or null on a frontend project. */
export const backendEntry = config => BACKENDS[backendOf(config)] ?? null

/** The runner's name as the card and the summaries show it: Vitest, pytest, …, Playwright. */
export const runnerLabel = adapter => (adapter === 'playwright' ? 'Playwright' : BACKENDS[adapter]?.label ?? adapter)
