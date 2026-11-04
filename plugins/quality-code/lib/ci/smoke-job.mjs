// The optional post-deploy job of the CI file (bin/ci.mjs --init --smoke): the smoke suite (tests tagged @smoke)
// against the URL in the SMOKE_URL variable. The variable is the project's own (GitHub: Settings > Variables;
// GitLab: CI/CD variables); no URL, no token and no password is ever written into the file.
export const SMOKE_VAR = 'SMOKE_URL'

/** Install lines a Playwright run needs: the JavaScript ones, not a backend toolchain's. */
export const jsInstall = lines => lines.filter(l => !/^(pip |go |dotnet )/.test(l))

/** The job as lines of YAML for one provider. `fetch` clones the plugin; `pipeline` is the pipeline.mjs command. */
export function smokeJob(provider, { fetch, pipeline, install = [], prefix = '' }) {
  const run = `${pipeline} --smoke --url "$${SMOKE_VAR}"`
  if (provider === 'github') {
    return [
      '  # smoke_post_deploy: the critical tests (tagged @smoke) against the deployed app. Read-only. Set the repository',
      `  #   variable ${SMOKE_VAR} (Settings > Secrets and variables > Actions > Variables) to its address; add`,
      '  #   needs: <your deploy job> if the deploy is a job of this workflow. Run it by hand from the Actions tab too.',
      '  smoke_post_deploy:',
      `    if: \${{ vars.${SMOKE_VAR} != '' && (github.event_name == 'workflow_dispatch' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch)) }}`,
      '    runs-on: ubuntu-latest',
      '    env:',
      `      ${SMOKE_VAR}: \${{ vars.${SMOKE_VAR} }}`,
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4',
      '        with: { node-version: 22 }',
      ...install.map(l => `      - run: ${l}${prefix ? `\n        working-directory: ${prefix}` : ''}`),
      `      - run: ${fetch}`,
      `      - run: ${run}`,
      ...(prefix ? [`        working-directory: ${prefix}`] : []),
    ]
  }
  const cd = prefix ? [`    - cd ${prefix}`] : []
  return [
    '# smoke_post_deploy: the critical tests (tagged @smoke) against the deployed app. Read-only. Set the CI/CD variable',
    `#   ${SMOKE_VAR} to its address; the job runs after the other stages, on the default branch and when started by hand.`,
    'smoke_post_deploy:',
    '  stage: .post',
    '  image: node:22',
    '  rules:',
    `    - if: $${SMOKE_VAR} && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`,
    `    - if: $${SMOKE_VAR}`,
    '      when: manual',
    '      allow_failure: true',
    '  script:', ...cd, ...install.map(l => `    - ${l}`), `    - ${fetch}`, `    - ${run}`,
  ]
}
