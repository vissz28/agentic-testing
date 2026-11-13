// A meeting transcript as speaker turns. Reads WebVTT (Teams export), plain text and Markdown; a Word file is
// turned into text first (lib/ticket/docx.mjs). Pure: no file, no network.
import { collapseSpaces } from '../core/text.mjs'

const TIME = /^(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?\s*-->\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?/
const CLOCK = /^\[?(?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?\]?$/
const TAG = /<[^>]*>/g
const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const MAX_TURNS = 5000

const unescape = s => s.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, e) => ENTITY[e])
const clean = s => collapseSpaces(unescape(s.replace(TAG, ''))).trim()

function push(turns, speaker, time, text) {
  const t = clean(text)
  if (!t) return
  const last = turns[turns.length - 1]
  // The same person talking on: one turn.
  if (last && last.speaker === speaker) last.text += ` ${t}`
  else turns.push({ speaker, time: time ?? null, text: t })
}

/** Which kind of text this is: 'vtt' or 'plain'. */
export function kindOf(text) {
  return /^﻿?WEBVTT/.test(text) ? 'vtt' : 'plain'
}

function parseVtt(text) {
  const turns = []
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    const at = lines.findIndex(l => TIME.test(l))
    if (at < 0) continue // header, NOTE, STYLE, REGION
    const time = lines[at].split(/\s*-->/)[0].replace(/\.\d+$/, '')
    const body = lines.slice(at + 1).join(' ')
    // Teams writes <v Name>words</v>; a cue may hold several voices.
    const voices = [...body.matchAll(/<v(?:\.[^\s>]+)*\s+([^>]+)>([\s\S]*?)(?:<\/v>|(?=<v[\s.>])|$)/g)]
    if (voices.length) for (const v of voices) push(turns, clean(v[1]) || null, time, v[2])
    else {
      const m = /^([^:<>]{1,40}):\s+(.+)$/.exec(clean(body))
      if (m) push(turns, m[1].trim(), time, m[2])
      else push(turns, null, time, body)
    }
  }
  return turns
}

// "Name  1:23" / "[00:01:23] Name" heading a block of words (Teams copy and its .txt export).
const HEAD = /^\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.{1,60})$|^(.{1,60}?)\s+\[?((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?)\]?$/
// "Name: words" on one line, with an optional [time] before it.
const INLINE = /^(?:\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-Za-zÀ-ÿ][^:\n]{0,39}?):\s+(\S.*)$/

function parsePlain(text) {
  const turns = []
  let cur = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) { cur = null; continue }
    if (line.startsWith('#') && !cur) continue
    const head = HEAD.exec(line)
    const name = head && (head[2] ?? head[3])
    if (head && !/[.?!,]$/.test(name) && name.split(/\s+/).length <= 5) {
      cur = { speaker: clean(name), time: head[1] ?? head[4] }
      continue
    }
    const inline = INLINE.exec(line)
    if (inline && inline[2].split(/\s+/).length <= 4 && !/^https?$/i.test(inline[2])) {
      push(turns, clean(inline[2]), inline[1] ?? null, inline[3])
      cur = { speaker: clean(inline[2]), time: null }
      continue
    }
    if (CLOCK.test(line)) continue
    if (cur) push(turns, cur.speaker, cur.time, line)
    else push(turns, null, null, line)
  }
  return turns
}

/** The speaker turns of a transcript: [{ speaker, time, text }]. `speaker` is null when the text names none. */
export function parseTranscript(input) {
  const text = String(input ?? '')
  const turns = kindOf(text) === 'vtt' ? parseVtt(text) : parsePlain(text)
  return turns.slice(0, MAX_TURNS)
}

/** The people who spoke, in order of first word, with how many turns each took. */
export function speakersOf(turns) {
  const seen = new Map()
  for (const t of turns) if (t.speaker) seen.set(t.speaker, (seen.get(t.speaker) ?? 0) + 1)
  return [...seen].map(([name, count]) => ({ name, turns: count }))
}

/** The file kinds the command reads. */
export const KINDS = ['.vtt', '.txt', '.md', '.docx']
