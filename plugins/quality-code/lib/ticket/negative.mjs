// Does the ticket cover invalid input, errors, permission denied? A suggestion only, never affects the gate.
import { normalise, stripComments } from './text.mjs'

// English and Italian.
const KINDS = {
  invalid_input: /\b(invalid|illegal|malformed|empty|blank|required|mandatory|must not be|too (long|short|large|small)|exceeds?|at most|at least|maximum|minimum|max|min|not valid|non valido|non valida|vuot[oa]|obbligatori[oa]|massimo|minimo)\b/i,
  error: /\b(error|errors|fails?|failure|rejects?|rejected|refus(es|ed)|not found|404|400|409|422|500|exception|timeout|unavailable|errore|errori|fallisce|rifiut\w*|non trovat\w*)\b/i,
  permission: /\b(permission|forbidden|unauthori[sz]ed|not allowed|denied|403|401|read-only|only (an? )?(admin|owner|manager)\w*|non autorizzat\w*|vietat\w*|solo (l')?(admin|amministrator\w*))\b/i,
}

export function checkNegative(ticket) {
  const parts = [ticket?.text?.description ?? '', ticket?.text?.acField ?? '', ...(ticket?.scenarios ?? []).map(s => (typeof s === 'string' ? s : s?.name ?? ''))]
  const text = normalise(stripComments(parts.join('\n')))
  const kinds = Object.keys(KINDS).filter(k => KINDS[k].test(text))
  return { covered: kinds.length > 0, kinds, missing: Object.keys(KINDS).filter(k => !kinds.includes(k)) }
}

const LABEL = { invalid_input: 'invalid input', error: 'errors', permission: 'permission denied' }

export const formatNegativeCheck = c => (c.covered
  ? `Negative cases: the ticket names ${c.kinds.map(k => LABEL[k]).join(', ')}.`
  : 'Negative cases: the ticket says nothing about invalid input, errors or permission denied. Suggest adding what should happen then (which field is wrong, which limit, which role). This does not change the score.')
