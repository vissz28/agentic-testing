// The shape of what the model extracted from a sprint planning transcript. The script checks the shape; the model
// never invents what the transcript did not say: that becomes an open question, not a task or a decision.
import { collapseSpaces, isTicketKey } from '../core/text.mjs'

export const LIMITS = { goal: 300, line: 500, title: 200, items: 100 }

const isStr = v => typeof v === 'string'
const oneLine = s => collapseSpaces(s).trim()

function strings(list, name, errors, max = LIMITS.line) {
  if (list === undefined) return []
  if (!Array.isArray(list)) { errors.push(`${name}: must be a list of texts`); return [] }
  if (list.length > LIMITS.items) errors.push(`${name}: at most ${LIMITS.items} items`)
  const out = []
  list.forEach((v, i) => {
    if (!isStr(v) || !oneLine(v)) errors.push(`${name}[${i}]: must be a non-empty text`)
    else if (v.length > max) errors.push(`${name}[${i}]: over ${max} characters`)
    else out.push(oneLine(v))
  })
  return out
}

/** { ok, errors, result } for an extracted result { goal, decisions, tasks[{title, owner?, estimate?, ticket?}], risks, openQuestions }. */
export function validateResult(input) {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['the result must be a JSON object'], result: null }
  const goal = isStr(input.goal) ? oneLine(input.goal) : ''
  if (!goal) errors.push('goal: one sentence is required (if none was said, ask for it; do not invent one)')
  else if (goal.length > LIMITS.goal) errors.push(`goal: over ${LIMITS.goal} characters, keep it to one sentence`)
  const decisions = strings(input.decisions, 'decisions', errors)
  const risks = strings(input.risks, 'risks', errors)
  const openQuestions = strings(input.openQuestions, 'openQuestions', errors)
  const tasks = []
  if (!Array.isArray(input.tasks)) errors.push('tasks: must be a list')
  else {
    if (input.tasks.length > LIMITS.items) errors.push(`tasks: at most ${LIMITS.items} tasks`)
    input.tasks.forEach((t, i) => {
      const at = `tasks[${i}]`
      if (!t || typeof t !== 'object' || Array.isArray(t)) { errors.push(`${at}: must be an object`); return }
      const title = isStr(t.title) ? oneLine(t.title) : ''
      if (!title) { errors.push(`${at}.title: required`); return }
      if (title.length > LIMITS.title) errors.push(`${at}.title: over ${LIMITS.title} characters`)
      const task = { title }
      for (const f of ['owner', 'estimate']) {
        if (t[f] == null || t[f] === '') continue
        if (!isStr(t[f]) && !(f === 'estimate' && Number.isFinite(t[f]) && t[f] >= 0)) errors.push(`${at}.${f}: must be a text${f === 'estimate' ? ' or a number' : ''}`)
        else if (String(t[f]).length > 60) errors.push(`${at}.${f}: over 60 characters`)
        else task[f] = oneLine(String(t[f]))
      }
      if (t.ticket != null && t.ticket !== '') {
        if (!isTicketKey(t.ticket)) errors.push(`${at}.ticket: "${t.ticket}" is not a ticket key like ABC-123`)
        else task.ticket = t.ticket
      }
      tasks.push(task)
    })
  }
  return errors.length ? { ok: false, errors, result: null } : { ok: true, errors: [], result: { goal, decisions, tasks, risks, openQuestions } }
}
