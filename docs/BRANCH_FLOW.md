# Branch flow

Changes move one way: `dev`, then `test`, then `main`.

| Branch | Who | What runs | What it is for |
|---|---|---|---|
| `dev` | us only | the `test` workflow (unit, e2e, JSON and wording checks); no image build, no smoke test | where work happens; the tests tell us right away if a change broke something |
| `test` | us, through a pull request from `dev` | the `test` workflow and the `harbor` workflow's image build and smoke test, nothing published | proves the change and the image before it ships |
| `main` | production, through a pull request from `test` | the same checks, then `harbor` publishes the image to Harbor (`deploy-server:latest`) and removes the older images | publishing; each release is tagged `quality-code--vX.Y.Z` here |

- A pull request into `dev`, `test` or `main` runs the tests before it can merge. Turn on branch protection for `main` and `test` and require the `test` workflow to pass.
- Nothing is published from `dev` or `test`; the image is built only on `test` and `main`. A manual run of `harbor` publishes only when it runs on `main`.
- The version is bumped and the CHANGELOG written on `dev`; the tag goes on the commit that reaches `main`.
- Both remotes carry all three branches: `origin` (github.com/vissz28/agentic-testing) and `ghe` (teamsystem.ghe.com/teamsystem/quality-code).
