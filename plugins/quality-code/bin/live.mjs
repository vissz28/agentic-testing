#!/usr/bin/env node
// For the band above the prompt: `live.mjs path` prints where this project's pipeline writes its live progress.
import { projectRoot } from '../lib/config/config.mjs'
import { liveFile } from '../lib/pipeline/live.mjs'
import { isMain, printError, printLine } from '../lib/core/script-io.mjs'

export function main(argv = process.argv.slice(2), env = process.env, cwd = process.cwd()) {
  if (argv[0] !== 'path') { printError('usage: live.mjs path'); return 2 }
  printLine(liveFile(projectRoot(env, cwd)))
  return 0
}

if (isMain(import.meta.url)) process.exitCode = main()
