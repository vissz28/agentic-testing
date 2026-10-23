# Backend tests for every stack

Status: decided 23 Oct · Owner: Elvis Zefaj · Jira: AGT-128

## 1. Goal

The backend side of Quality Code is Vitest only today: TypeScript and Node. Teams with a Python, Java,
Kotlin, Go or .NET backend cannot gate, write, run or grade their tests. Make the backend work on the
common stacks, with the same rule as today: the scripts run and grade, the model never does.

## 2. Backends

| Adapter | Stack | Runs | Report read | One test (mutation, flaky) | Test file names |
|---|---|---|---|---|---|
| `vitest` | TypeScript, JavaScript | the project's Vitest | Vitest JSON | `-t` | `*.spec.*`, `*.test.*` |
| `pytest` | Python | `python -m pytest` (`python3` when `python` is missing) | JUnit XML (`--junitxml`) | `-k` | `test_*.py`, `*_test.py` |
| `junit` | Java, Kotlin | `./mvnw`/`mvn test` or `./gradlew`/`gradle test` | JUnit XML (surefire, Gradle test results) | `-Dtest=Class#method`, `--tests Class.method` | `*Test.java`, `*Tests.java`, `*IT.java`, the same in `.kt` |
| `go` | Go | `go test -json` on the specs' packages | `go test -json` events | `-run '^Name$'` | `*_test.go` |
| `dotnet` | C#, F# | `dotnet test` on the test project | TRX (`--logger trx`) | `--filter "FullyQualifiedName~Name"` | `*Tests.cs`, `*Test.cs`, `*Tests.fs` |

`adapter` takes any of these; `fullstack` takes `"backend": "<adapter>"` (default `vitest`) for its
backend side. A config block named after the adapter holds its options, as `vitest` does today:
`layers`, `timeoutSeconds`, and `command` (the project's own test command, when the default is wrong:
a template with `{files}`, `{report}` and `{test}`).

## 3. What each backend brings

- **A runner** (`lib/pipeline/runners/<adapter>.mjs`): the runner contract the checks use today:
  `({ files, testName, timeoutMs }) → { ran, tests: [{ title, path, file, status, message }], broken, error }`.
  It never writes into the project except the tool's own build output (`target/`, `build/`, `bin/`,
  `obj/`), and its report goes to a temp folder.
- **A dialect** (`lib/base/dialects/<adapter>.mjs`): `groupRe`, the test mark, `honesty`, `suite`,
  `expected`, and `mutation` (`expectRe` for the assertions, `flips`, `plan`, `eligible`, `rank`).
  `mutation.inPlace: true` for compiled languages (Java, Kotlin, Go, C#): a mutated copy next to the
  spec would not compile (a duplicate class or function), so the spec itself is mutated and always
  restored, in a `finally` and on SIGINT/SIGTERM.
- **A writing guide** (`guides/<adapter>-writing.md`) that `spec` reads instead of `vitest-writing.md`.
- **Setup detection**: `pyproject.toml`/`pytest.ini`/`setup.cfg`/`tox.ini`/`requirements*.txt` with
  pytest → `pytest`; `pom.xml`, `build.gradle(.kts)` → `junit`; `go.mod` → `go`; `*.csproj`/`*.sln`
  → `dotnet`. With Playwright in `package.json` too: `fullstack` with that backend.
- **Test-file names** for `branch.mjs` (kind `test`), the boundary rules and the suite listing.

## 4. Steps that differ

- **types**: `tsc` for Vitest only. Compiled stacks compile in the test run: a compile error makes
  the tests step `not_run` ("the specs do not compile"), never a pass. Python has no type step:
  `pass`, `not applicable` (as Stryker says today), unless `pytest.typeCheck` names a command (mypy).
- **stryker**: Vitest only; the others show `not applicable: Stryker is for JavaScript and TypeScript`.
- **mutation**: the same one-flip-per-assertion rule, in each language's assertion styles (pytest
  `assert`, JUnit `assertEquals`/AssertJ `assertThat`, Go `testify` and `t.Errorf` comparisons, xUnit,
  NUnit and FluentAssertions). A test with no assertion the dialect knows is `not mutated` and keeps
  the step from passing, as today.
- **The readiness gate**: unchanged. Every backend is scored with the backend rubric.

## 5. Out of scope

Mutation tools other than the plugin's own (mutmut, PIT, Stryker.NET), Ruby, PHP and Rust (the
registry makes them a later addition), and seed builders outside Vitest (`seed` says so).
