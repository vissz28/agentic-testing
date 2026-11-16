// Helpers for paths written as text (config values, relative paths, URLs).
import { toForwardSlashes } from './text.mjs'

/** "./a/b" -> "a/b", ".\\a" -> "a". */
export const stripDotSlash = path => toForwardSlashes(path).replace(/^(?:\.\/)+/, '')

/** "a/b//" -> "a/b", "https://x.net/" -> "https://x.net". */
export const noTrailingSlash = path => String(path).replace(/\/+$/, '')

/** The one form folders are stored and compared in: "./tickets/" -> "tickets". */
export const cleanRelPath = path => noTrailingSlash(stripDotSlash(path))

/** Absolute on any OS: "/x", "\\x" or a drive like "C:x". */
export const isAbsoluteAnywhere = path => /^(?:[\\/]|[A-Za-z]:)/.test(String(path))

/** True when a path.relative result escapes its folder ("..", "../x", another drive); "..x" stays inside. */
export const leavesFolder = rel => {
  const p = toForwardSlashes(rel)
  return p === '..' || p.startsWith('../') || isAbsoluteAnywhere(p)
}
