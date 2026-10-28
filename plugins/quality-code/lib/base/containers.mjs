// Real databases for the integration tests: what setup adds to a backend that uses Postgres, MySQL,
// MongoDB or Redis and has no Testcontainers yet. One entry per database, one block per backend
// (Vitest, pytest, Go, .NET): how its driver is found, how Testcontainers is installed, and the files
// that start the databases. JUnit is left out: it has no command that adds a dependency.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { BACKENDS } from './backends.mjs'

export const CONTAINER_BACKENDS = Object.freeze(['vitest', 'pytest', 'go', 'dotnet'])

// The drivers each backend's code uses for a database: npm packages, Python distributions, Go module
// paths, NuGet packages (a prefix: Npgsql covers Npgsql.EntityFrameworkCore.PostgreSQL).
const DATABASES = [
  {
    name: 'postgres', label: 'Postgres', image: 'postgres:17-alpine', prisma: 'postgresql',
    vitest: { drivers: ['pg', 'postgres'], module: '@testcontainers/postgresql', cls: 'PostgreSqlContainer', url: 'getConnectionUri' },
    pytest: { drivers: ['psycopg', 'psycopg2', 'psycopg2-binary', 'asyncpg', 'pg8000'], cls: 'PostgresContainer', args: ', driver=None' },
    go: { drivers: ['github.com/jackc/pgx', 'github.com/lib/pq', 'gorm.io/driver/postgres'], func: 'PostgresURL', run: ', postgres.BasicWaitStrategies()', conn: ', "sslmode=disable"' },
    dotnet: { drivers: ['Npgsql'], pkg: 'Testcontainers.PostgreSql', builder: 'PostgreSqlBuilder', method: 'PostgresAsync' },
  },
  {
    name: 'mysql', label: 'MySQL', image: 'mysql:8.4', prisma: 'mysql',
    vitest: { drivers: ['mysql2', 'mysql'], module: '@testcontainers/mysql', cls: 'MySqlContainer', url: 'getConnectionUri' },
    pytest: { drivers: ['pymysql', 'mysqlclient', 'mysql-connector-python', 'aiomysql', 'asyncmy'], cls: 'MySqlContainer', args: '' },
    go: { drivers: ['github.com/go-sql-driver/mysql', 'gorm.io/driver/mysql'], func: 'MySQLURL', run: '', conn: '' },
    dotnet: { drivers: ['MySqlConnector', 'MySql.Data', 'Pomelo.EntityFrameworkCore.MySql'], pkg: 'Testcontainers.MySql', builder: 'MySqlBuilder', method: 'MySqlAsync' },
  },
  {
    name: 'mongodb', label: 'MongoDB', image: 'mongo:8', prisma: 'mongodb',
    vitest: { drivers: ['mongodb', 'mongoose'], module: '@testcontainers/mongodb', cls: 'MongoDBContainer', url: 'getConnectionString' },
    pytest: { drivers: ['pymongo', 'motor', 'mongoengine', 'beanie'], cls: 'MongoDbContainer', args: '' },
    go: { drivers: ['go.mongodb.org/mongo-driver'], func: 'MongoDBURL', run: '', conn: '' },
    dotnet: { drivers: ['MongoDB.Driver'], pkg: 'Testcontainers.MongoDb', builder: 'MongoDbBuilder', method: 'MongoDbAsync' },
  },
  {
    name: 'redis', label: 'Redis', image: 'redis:7-alpine',
    vitest: { drivers: ['ioredis', 'redis'], module: '@testcontainers/redis', cls: 'RedisContainer', url: 'getConnectionUrl' },
    pytest: { drivers: ['redis'], cls: 'RedisContainer', args: '' },
    go: { drivers: ['github.com/redis/go-redis', 'github.com/go-redis/redis'], func: 'RedisURL', run: '', conn: '' },
    dotnet: { drivers: ['StackExchange.Redis'], pkg: 'Testcontainers.Redis', builder: 'RedisBuilder', method: 'RedisAsync' },
  },
]

const read = (root, p) => { try { return readFileSync(join(root, p), 'utf8').slice(0, 1 << 20) } catch { return '' } }
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ponytail: a Python package is found by its name as a word in these files, so a comment that names it counts too.
const PYTHON_DEPS = /^(?:pyproject\.toml|setup\.cfg|setup\.py|Pipfile|requirements[\w.-]*\.txt)$/
function pythonDeps(root) {
  let names = []
  try { names = readdirSync(root).filter(n => PYTHON_DEPS.test(n)) } catch {}
  return names.map(n => read(root, n)).join('\n').toLowerCase().replace(/_/g, '-')
}
const hasPython = (text, name) => new RegExp(`(?<![\\w.-])${escape(name)}(?![\\w.-])`).test(text)

// The .NET project files, at most three folders down: bin, obj and dot folders skipped.
function dotnetProjects(root, depth = 3, rel = '') {
  let entries = []
  try { entries = readdirSync(join(root, rel), { withFileTypes: true }) } catch { return [] }
  const here = entries.filter(e => e.isFile() && /\.(?:csproj|fsproj)$/.test(e.name)).map(e => join(rel, e.name))
  const down = depth > 1 ? entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && !['bin', 'obj', 'node_modules'].includes(e.name)).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => dotnetProjects(root, depth - 1, join(rel, e.name))) : []
  return [...here.sort(), ...down].map(p => p.split('\\').join('/'))
}
const hasNuget = (text, name) => new RegExp(`Include="${escape(name)}(?=[".])`, 'i').test(text)

/** What the backend's code depends on, read once: the text the drivers are looked for in, and per backend the extras it needs. */
function backendDeps(root, backend, deps) {
  if (backend === 'vitest') return { has: n => n in deps, containers: Object.keys(deps).some(d => d === 'testcontainers' || d.startsWith('@testcontainers/')) }
  if (backend === 'pytest') {
    const text = pythonDeps(root)
    return { has: n => hasPython(text, n), containers: hasPython(text, 'testcontainers') || /(?<![\w.-])testcontainers-/.test(text) }
  }
  if (backend === 'go') {
    const text = read(root, 'go.mod')
    return { has: n => text.includes(n), containers: text.includes('github.com/testcontainers/testcontainers-go'), module: /^module\s+(\S+)/m.exec(text)?.[1] ?? null }
  }
  const projects = dotnetProjects(root).map(p => ({ path: p, text: read(root, p) }))
  const text = projects.map(p => p.text).join('\n')
  return { has: n => hasNuget(text, n), containers: hasNuget(text, 'Testcontainers'), test: projects.find(p => /Include="(?:Microsoft\.NET\.Test\.Sdk|xunit|NUnit|MSTest)/i.test(p.text)) ?? null }
}

// ponytail: prisma/schema.prisma only; a multi-file schema (prisma/schema/) or a custom path in package.json is not read.
function prismaSchema(root) {
  const schema = read(root, 'prisma/schema.prisma')
  const provider = /datasource\s+\w+\s*\{[^}]*\bprovider\s*=\s*"(\w+)"/.exec(schema)?.[1] ?? null
  // Prisma 7 reads the address in prisma.config.ts, earlier ones in the schema: env("DATABASE_URL").
  const env = /\benv\(\s*["'](\w+)["']\s*\)/.exec(`${schema}\n${['ts', 'mts', 'js', 'mjs'].map(e => read(root, `prisma.config.${e}`)).join('\n')}`)?.[1] ?? 'DATABASE_URL'
  return { provider, env, migrations: existsSync(join(root, 'prisma/migrations')) }
}

/** The databases the backend uses, in DATABASES order, each with its backend's block (and, on Vitest, the Prisma schema's address variable). */
export function databasesOf(root, backend, deps = {}, found = backendDeps(root, backend, deps)) {
  const prisma = backend === 'vitest' && ('prisma' in deps || '@prisma/client' in deps) ? prismaSchema(root) : null
  return DATABASES.filter(d => d[backend].drivers.some(found.has) || (prisma && d.prisma === prisma.provider))
    .map(d => ({ ...d, ...d[backend], ...(prisma && d.prisma === prisma.provider ? { prismaEnv: prisma.env, migrations: prisma.migrations } : {}) }))
}

const DEFAULT_FOLDERS = { vitest: 'test/integration/', pytest: 'tests/integration/' }

/** The integration folder: the team's own integration layer, else the default (.NET: inside its test project; Go: none, its tests sit beside the code). */
function integrationFolder(backend, config, found) {
  if (backend === 'go') return null
  const own = config?.[backend]?.layers?.find(l => l.name === 'integration')?.folder
  if (own) return own
  return backend === 'dotnet' ? `${dirname(found.test.path) === '.' ? '' : `${dirname(found.test.path)}/`}Integration/` : DEFAULT_FOLDERS[backend]
}

const GO_HELPER = 'internal/testdb/testdb.go'

/**
 * What setup adds to a backend that uses a database and has no Testcontainers yet: the install
 * command, the databases, the integration folder and the files (with a note or a problem to show).
 * Null when it uses none, or has Testcontainers already: then its own helpers are the ones to use.
 * cmd holds the JavaScript package manager's commands (add, exec) and whether the code is TypeScript.
 */
export function containersScaffold(root, backend, { deps = {}, config = null, cmd = {} } = {}) {
  if (!CONTAINER_BACKENDS.includes(backend)) return null
  const found = backendDeps(root, backend, deps)
  if (found.containers) return null
  const dbs = databasesOf(root, backend, deps, found)
  if (!dbs.length) return null
  const base = { databases: dbs.map(d => d.name) }
  if (backend === 'dotnet' && !found.test) return { ...base, problem: 'This solution has no test project (one with Microsoft.NET.Test.Sdk, xUnit, NUnit or MSTest): add one, then run setup again.' }
  if (backend === 'go' && !found.module) return { ...base, problem: 'go.mod names no module: setup cannot write the import path of the test helper.' }
  const folder = integrationFolder(backend, config, found)
  return { ...base, folder, ...plan(root, backend, dbs, folder, found, cmd) }
}

// The install command and the files, per backend.
function plan(root, backend, dbs, folder, found, cmd) {
  if (backend === 'vitest') {
    const ext = cmd.ts ? 'ts' : 'js'
    return { install: `${cmd.add ?? 'npm install --save-dev'} testcontainers ${dbs.map(d => d.module).join(' ')}`, files: [`vitest.integration.config.${ext}`, `${folder}global-setup.${ext}`, `${folder}databases.${ext}`] }
  }
  if (backend === 'pytest') {
    const pkg = `"testcontainers[${dbs.map(d => d.name).join(',')}]"`
    const files = [`${folder}conftest.py`]
    if (existsSync(join(root, 'uv.lock'))) return { install: `uv add --dev ${pkg}`, files }
    if (existsSync(join(root, 'poetry.lock'))) return { install: `poetry add --group dev ${pkg}`, files }
    return { install: `python -m pip install ${pkg}`, files, note: `pip installs it in this environment only: add ${pkg.slice(1, -1)} to the requirements your tests install.` }
  }
  if (backend === 'go') return { install: `go get ${dbs.map(d => `github.com/testcontainers/testcontainers-go/modules/${d.name}`).join(' ')}`, files: [GO_HELPER] }
  return { install: dbs.map(d => `dotnet add ${found.test.path} package ${d.pkg}`).join(' && '), files: [`${folder}TestDatabases.cs`] }
}

/**
 * The config and the files for the integration tests on real databases. The config gets the
 * integration layer (Go: none), and on Vitest its folder runs under its own config, built on base
 * (the project's Vitest config, or null). The errors when the backend cannot get them.
 */
export function containersWrite(root, backend, config, { deps = {}, base = null, cmd = {} } = {}) {
  if (!CONTAINER_BACKENDS.includes(backend)) return { errors: [`containersScaffold: only for a Vitest, pytest, Go or .NET backend (this one is ${BACKENDS[backend]?.label ?? backend})`] }
  const found = backendDeps(root, backend, deps)
  const dbs = databasesOf(root, backend, deps, found)
  if (!dbs.length) return { errors: ['containersScaffold: this project uses no database Testcontainers starts here (Postgres, MySQL, MongoDB or Redis)'] }
  if (backend === 'dotnet' && !found.test) return { errors: ['containersScaffold: this solution has no test project to put the helper in'] }
  if (backend === 'go' && !found.module) return { errors: ['containersScaffold: go.mod names no module'] }
  const folder = integrationFolder(backend, config, found)
  return { folder, config: withIntegrationLayer(config, backend, folder, cmd.ts), files: filesOf(backend, dbs, { folder, base, found, ...cmd }) }
}

/** The config with the integration layer in its backend's block; on Vitest its folder runs under the integration config, the rest as before. */
export function withIntegrationLayer(config, backend, folder, ts = false) {
  if (!folder) return config
  const block = config[backend] ?? {}
  const own = block.layers?.some(l => l.name === 'integration')
  const layers = own ? block.layers : [...(block.layers ?? BACKENDS[backend].defaultLayers), { name: 'integration', folder }]
  if (backend !== 'vitest') return { ...config, [backend]: { ...block, layers } }
  const file = `vitest.integration.config.${ts ? 'ts' : 'js'}`
  const configs = [{ match: folder, config: file }, ...(block.configs ?? []).filter(c => c.config !== file)]
  return { ...config, vitest: { ...block, layers, configs } }
}

/** [path, text] per file setup writes for the backend. */
export function filesOf(backend, dbs, opts) {
  return { vitest: vitestFiles, pytest: pytestFiles, go: goFiles, dotnet: dotnetFiles }[backend](dbs, opts)
}

const urlName = d => `${d.name}Url`

function vitestFiles(dbs, { ts = false, base = null, folder, exec = 'npx' }) {
  const ext = ts ? 'ts' : 'js'
  const config = `import { defineConfig } from 'vitest/config'
${base ? `// ponytail: spreads the base config's object; a config exported as a function needs mergeConfig by hand.
import base from './${base}'
` : ''}
// Written by quality-code setup. The integration tests run against real databases: ${folder}global-setup.${ext}
// starts them in containers (Testcontainers) once per run. Docker must be running.
export default defineConfig({
${base ? '  ...base,\n' : '  resolve: { tsconfigPaths: true },\n'}  test: {
${base ? '    ...base.test,\n' : ''}    include: ['${folder}**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    globalSetup: ['${folder}global-setup.${ext}'],
    // One database for the run: the spec files take turns, so one never sees another's rows.
    fileParallelism: false,
  },
})
`
  const started = dbs.map(d => d.name)
  const schema = dbs.filter(d => d.prismaEnv).map(d => {
    const run = `${exec} prisma ${d.migrations ? 'migrate deploy' : 'db push'}`
    return `  // The schema, as the app has it: ${run} against the test database.
  execSync('${run}', { env: { ...process.env, ${d.prismaEnv}: ${d.name}.${d.url}() }, stdio: 'inherit' })
  process.env.${d.prismaEnv} = ${d.name}.${d.url}()
`
  }).join('')
  const setup = `${schema ? "import { execSync } from 'node:child_process'\n" : ''}${dbs.map(d => `import { ${d.cls} } from '${d.module}'`).join('\n')}
${ts ? "import type { TestProject } from 'vitest/node'\n" : ''}
// Written by quality-code setup: starts the databases the integration tests use, once per run, and
// stops them at the end. Each one is new and empty: the tests arrange the rows they need.
export default async function setup(project${ts ? ': TestProject' : ''}) {
  const [${started.join(', ')}] = await Promise.all([
${dbs.map(d => `    new ${d.cls}('${d.image}').start(),`).join('\n')}
  ]).catch(${ts ? '(err: unknown)' : 'err'} => {
    // Printed as well: Vitest can hide the message of an error thrown here behind one of its own.
    const message = \`Testcontainers could not start the test databases: is Docker running? (\${err instanceof Error ? err.message : err})\`
    console.error(message)
    throw new Error(message)
  })
${schema || (dbs.some(d => d.name !== 'redis') ? '  // The schema: run your migrations here, against the addresses below, before the tests start.\n' : '')}${dbs.map(d => `  project.provide('${urlName(d)}', ${d.name}.${d.url}())`).join('\n')}
  return async () => {
    await Promise.all([${started.map(n => `${n}.stop()`).join(', ')}])
  }
}
`
  const helper = `import { inject } from 'vitest'

// Written by quality-code setup: the addresses of the databases ${folder}global-setup.${ext} starts.
// Connect the code under test to these, never to a developer's own database.
${dbs.map(d => `export const ${urlName(d)} = () => inject('${urlName(d)}')`).join('\n')}
${ts ? `
declare module 'vitest' {
  export interface ProvidedContext {
${dbs.map(d => `    ${urlName(d)}: string`).join('\n')}
  }
}
` : ''}`
  return [[`vitest.integration.config.${ext}`, config], [`${folder}global-setup.${ext}`, setup], [`${folder}databases.${ext}`, helper]]
}

function pytestFiles(dbs, { folder }) {
  const fixture = d => {
    const url = d.name === 'redis' ? `f"redis://{redis.get_container_host_ip()}:{redis.get_exposed_port(6379)}"` : `${d.name}.get_connection_url()`
    return `@pytest.fixture(scope="session")
def ${d.name}_url():
    ${d.name} = _start("${d.label}", lambda: ${d.cls}("${d.image}"${d.args}))
${d.name === 'redis' ? '' : '    # The schema: run your migrations here (alembic upgrade head, or the like) against this address.\n'}    yield ${url}
    ${d.name}.stop()
`
  }
  return [[`${folder}conftest.py`, `"""Written by quality-code setup: the databases the integration tests use, started in containers
(Testcontainers) once per run and stopped at the end. Each one is new and empty: the tests arrange
the rows they need. Docker must be running."""

import pytest
${dbs.map(d => `from testcontainers.community.${d.name} import ${d.cls}`).join('\n')}


def _start(name, make):
    # Making the container already talks to Docker: both steps fail the same way without it.
    try:
        return make().start()
    except Exception as err:
        pytest.fail(f"Testcontainers could not start {name}: is Docker running? ({err})", pytrace=False)


${dbs.map(fixture).join('\n\n')}`]]
}

function goFiles(dbs, { found }) {
  const imports = dbs.map(d => `\t"github.com/testcontainers/testcontainers-go/modules/${d.name}"`).join('\n')
  const vars = dbs.map(d => `// ${d.func} is the address of the test ${d.label}.
var ${d.func} = start("${d.label}", func(ctx context.Context) (string, error) {
\tc, err := ${d.name}.Run(ctx, "${d.image}"${d.run})
\tif err != nil {
\t\treturn "", err
\t}
\treturn c.ConnectionString(ctx${d.conn})
})
`).join('\n')
  return [[GO_HELPER, `// Package testdb starts the databases the integration tests use, once per test binary;
// Testcontainers removes them when the tests end. Each one is new and empty: the tests arrange the
// rows they need. Written by quality-code setup; import it as ${found.module}/internal/testdb.
package testdb

import (
\t"context"
\t"sync"
\t"testing"

${imports}
)

${vars}
func start(name string, run func(context.Context) (string, error)) func(testing.TB) string {
\taddress := sync.OnceValues(func() (string, error) { return run(context.Background()) })
\treturn func(t testing.TB) string {
\t\tt.Helper()
\t\turl, err := address()
\t\tif err != nil {
\t\t\tt.Fatalf("Testcontainers could not start %s: is Docker running? (%v)", name, err)
\t\t}
\t\treturn url
\t}
}
`]]
}

function dotnetFiles(dbs, { folder, found }) {
  const own = /<RootNamespace>\s*([^<\s]+)\s*<\/RootNamespace>/.exec(found.test.text)?.[1] ?? basename(found.test.path).replace(/\.(?:csproj|fsproj)$/, '')
  const ns = `${own.replace(/[^\w.]/g, '_')}.${relative(dirname(found.test.path), folder.replace(/\/$/, '')).split('/').filter(Boolean).map(s => s.replace(/\W/g, '_')).join('.') || 'Integration'}`
  const field = d => d.method.replace(/Async$/, '')
  return [[`${folder}TestDatabases.cs`, `using DotNet.Testcontainers.Containers;
${dbs.map(d => `using ${d.pkg};`).join('\n')}

namespace ${ns};

/// <summary>
/// Written by quality-code setup: the databases the integration tests use, each started in a container
/// (Testcontainers) the first time a test asks for it, and removed when the tests end. Each one is new
/// and empty: the tests arrange the rows they need. Docker must be running.
/// </summary>
public static class TestDatabases
{
${dbs.map(d => `    private static readonly Lazy<Task<string>> ${field(d)} = Start("${d.label}", () => new ${d.builder}("${d.image}").Build(), c => c.GetConnectionString());`).join('\n')}

${dbs.map(d => `    public static Task<string> ${d.method}() => ${field(d)}.Value;`).join('\n')}

    private static Lazy<Task<string>> Start<T>(string name, Func<T> build, Func<T, string> address) where T : IContainer => new(async () =>
    {
        // Building the container already talks to Docker: both steps fail the same way without it.
        T container;
        try
        {
            container = build();
            await container.StartAsync();
        }
        catch (Exception err)
        {
            throw new InvalidOperationException($"Testcontainers could not start {name}: is Docker running? ({err.Message})", err);
        }
        return address(container);
    });
}
`]]
}
