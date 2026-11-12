// The config file's frontend and backend fields for an adapter name, so a test can still be written per adapter.
export const sides = (adapter, backend = 'vitest') => {
  if (adapter === 'fullstack') return { frontend: 'playwright', backend }
  if (adapter === 'playwright') return { frontend: adapter }
  return { backend: adapter }
}
