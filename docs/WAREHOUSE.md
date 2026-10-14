# Warehouse plugins (legacy reference implementation)

> **Using quality-code for your own team?** You want the main [README](../README.md), not this page.
> This page is for the TeamSystem warehouse repos only.

`warehouse-frontend` and `warehouse-backend` are the original, warehouse-only version of this
solution. They run the whole pipeline (readiness gate, test writing, deterministic checks, result
card) using harness scripts that live in each warehouse repo under `.claude/harness/`. They stay as
they are until part 5 moves the warehouse repos onto `quality-code`.

| | `warehouse-frontend` | `warehouse-backend` |
|---|---|---|
| Install (in that repo) | `/plugin install warehouse-frontend@quality-code` | `/plugin install warehouse-backend@quality-code` |
| Repo branch with the harness | `agentic-testing-fe`, or a branch merged from it | `agentic-testing-be` (or `agt-34-remove-audit-logs` until merged) |
| Full run | `/warehouse-frontend:spec-frontend FIC-…` | `/warehouse-backend:spec FIC-…` |
| Readiness check only | `/warehouse-frontend:ticket-eval FIC-…` | — |
| One output only | `:playwright`, `:xray` | `:unit`, `:integration`, `:range` |
| Test data | `:seed` (API stubs) | `:seed` (~25 rows per table into your local DB) |
| It writes | a Playwright spec and an XRay case (CSV + Excel) | Vitest specs against a real Postgres (Docker required) |

The checks after writing, all plain scripts with their own `--self-test`:

| Check | What it catches |
|---|---|
| `boundary-guard` | a write to application code, the CI pipeline or `.env` |
| `honesty-check` | a check or a whole test quietly deleted or skipped |
| `suite-honesty` | a test with no assertion, or a run where everything was postponed |
| `expected-check` (backend) | the test does not assert the values the criteria name |
| type-check and the run | the spec does not compile, or fails |
| `mutate-generated` | an assertion that cannot fail |
| Stryker (backend bugs) | the fix is not really what the test pins |

**Maintaining them.** Their skills and commands are copied from the two repos, which stay the source
of truth:

```bash
scripts/sync-from-repos.sh
```

Then `claude plugin validate plugins/warehouse-frontend` (and the backend one), bump `version`, and
push. The step-by-step guide for QA is in [WAREHOUSE_USER_GUIDE.md](WAREHOUSE_USER_GUIDE.md).

**Removal.** Both plugins are removed in part 5 of the [roadmap](../README.md#roadmap), once the
warehouse repos run on `quality-code`.
