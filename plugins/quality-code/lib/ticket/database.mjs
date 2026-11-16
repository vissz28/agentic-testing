// Word match on ticket text and target path; if it hits, /quality-code:spec proposes database tests.
import { toForwardSlashes } from '../core/text.mjs'

const TEXT = [
  /\b(?:database|db)\b/i,
  /\b(?:tables?|columns?|schema|migrations?|migrate)\b/i,
  /\b(?:sql|postgres(?:ql)?|mysql|mariadb|sqlite)\b/i,
  /\b(?:foreign keys?|primary keys?|unique (?:constraint|index|key)|not null|constraints?)\b/i,
  /\b(?:select|insert into|delete from)\b[^.\n]{0,60}\b(?:from|into|where)\b/i,
  /\b(?:prisma|typeorm|sequelize|hibernate|flyway|liquibase|alembic)\b/i,
]

const PATH = [
  /(?:^|\/)migrations?\//i,
  /\.sql$/i,
  /(?:^|\/)schema\.(?:prisma|rb)$/i,
  /(?:^|\/)(?:repositor(?:y|ies)|dao)\//i,
  /(?:Repository|Dao|Entity)\.(?:java|kt|cs|ts|js|py|go)$/,
  /_repo(?:sitory)?\.(?:py|go)$/,
  /\.(?:repository|entity)\.(?:ts|js)$/,
]

export function touchesData({ text = '', target = '' } = {}) {
  const reasons = []
  for (const re of TEXT) {
    const m = String(text).match(re)
    if (m) reasons.push(`text: ${m[0].trim().slice(0, 40)}`)
  }
  const path = toForwardSlashes(target)
  if (PATH.some(re => re.test(path))) reasons.push(`target: ${path}`)
  return { touches: reasons.length > 0, reasons }
}
