// The user's global git config may sign commits or run hooks; switch both off for temp repos.
// A PR's base branch from the CI runner would point `ci` at a branch the temp repo lacks.
const { GITHUB_BASE_REF, CI_MERGE_REQUEST_DIFF_BASE_SHA, ...outer } = process.env
export const ENV = {
  ...outer,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 'user@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 'user@example.test',
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null',
}
