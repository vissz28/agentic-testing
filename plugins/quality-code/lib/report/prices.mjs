// API list prices per million tokens, used only to estimate what the plugin's runs would cost.
// Subscription plans are not billed this way. Unknown models get no price: never a guess.
import { readFileSync } from 'node:fs'

export const AS_OF = '2026-10-06'
export const SOURCE = 'claude-api skill: Current Models table (input, output, cache reads) and shared/prompt-caching.md (cache writes 1.25x input for 5m, 2x for 1h)'

const row = (input, output, cacheRead) => ({ input, output, cacheWrite5m: input * 1.25, cacheWrite1h: input * 2, cacheRead })

export const PRICES = Object.freeze({
  'claude-fable-5-1': row(10, 50, 0.25),
  'claude-mythos-5-1': row(10, 50, 0.25),
  'claude-fable-5': row(10, 50, 1),
  'claude-opus-5-5': row(4, 20, 0.2),
  'claude-opus-5': row(5, 25, 0.5),
  'claude-opus-4-8': row(5, 25, 0.5),
  'claude-opus-4-7': row(5, 25, 0.5),
  'claude-opus-4-6': row(5, 25, 0.5),
  'claude-sonnet-5-5': row(2, 10, 0.2),
  'claude-sonnet-5': row(2, 10, 0.2),
  'claude-sonnet-4-6': row(3, 15, 0.3),
  // Prompts up to 100K tokens; longer prompts bill at the long rate below.
  'claude-haiku-5-5': { ...row(0.1, 0.5, 0.01), long: { above: 100000, ...row(0.5, 2.5, 0.05) } },
  'claude-haiku-4-5': row(1, 5, 0.1),
})

const FIELDS = ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']

/** The model id as priced: no [1m] style suffix, no Bedrock/Vertex wrapping (us.anthropic.…-v1:0, …@20250101), no -YYYYMMDD snapshot date. */
export const baseModel = model => String(model ?? '').replace(/\[[^\]]*\]$/, '').replace(/^(?:[a-z]+\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '').replace(/@\d{8}$/, '').replace(/-\d{8}$/, '')

export function priceFor(model, prices = PRICES) {
  return prices[model] ?? prices[baseModel(model)] ?? null
}

/** Dollars for one API response's usage, or null when the model has no price. */
export function costOf(t, price) {
  if (!price) return null
  const prompt = t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead
  const p = price.long && prompt > price.long.above ? price.long : price
  return (t.input * p.input + t.output * p.output + t.cacheWrite5m * p.cacheWrite5m + t.cacheWrite1h * p.cacheWrite1h + t.cacheRead * p.cacheRead) / 1e6
}

/** Reads a --prices file: { asOf?, source?, models: { <id>: { input, output, cacheWrite5m, cacheWrite1h, cacheRead } } }. Throws a plain message. */
export function loadPrices(file) {
  let obj
  try { obj = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    throw new Error(`--prices ${file}: ${e.code === 'ENOENT' ? 'file not found' : `not valid JSON (${String(e.message).split('\n')[0]})`}`)
  }
  const models = obj?.models
  if (!models || typeof models !== 'object' || Array.isArray(models) || !Object.keys(models).length) throw new Error(`--prices ${file}: needs "models": { "<model id>": { ${FIELDS.join(', ')} } }`)
  const out = {}
  for (const [id, p] of Object.entries(models)) {
    for (const f of FIELDS) {
      if (typeof p?.[f] !== 'number' || !Number.isFinite(p[f]) || p[f] < 0) throw new Error(`--prices ${file}: models["${id}"].${f} must be a number of dollars per million tokens`)
    }
    out[id] = Object.fromEntries(FIELDS.map(f => [f, p[f]]))
  }
  return {
    prices: { ...PRICES, ...out },
    asOf: typeof obj.asOf === 'string' ? obj.asOf : null,
    source: typeof obj.source === 'string' ? obj.source : file,
    models: Object.keys(out),
  }
}
