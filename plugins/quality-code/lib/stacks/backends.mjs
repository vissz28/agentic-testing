// Per-backend settings. A new stack is one entry here plus its runner, dialect and writing guide.
// No imports: config.mjs and stack.mjs both load it.

// Same JS/TS sources branch.mjs counts.
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
    // First build downloads deps and compiles.
    timeoutSeconds: 600,
    guide: 'junit-writing.md',
  }),
  go: entry({
    label: 'Go',
    language: 'Go',
    testFile: /_test\.go$/,
    codeFile: /\.go$/,
    // Go tests sit beside the code.
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

/** null on a frontend project or the Playwright view. */
export const backendOf = config => config?.backend ?? null

export const runnerLabel = adapter => (adapter === 'playwright' ? 'Playwright' : BACKENDS[adapter]?.label ?? adapter)
