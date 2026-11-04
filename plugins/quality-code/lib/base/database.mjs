// Does a backend ticket or its target touch tables, queries or migrations? Then /quality-code:spec
// proposes database tests (guides/database-tests.md). A word list, no AI: a plain word match, and the
// person can drop the Database section from the plan card.

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

/**
 * @param {{text?: string, target?: string}} input the ticket text and the target path
 * @returns {{touches: boolean, reasons: string[]}} which words or path matched
 */
export function touchesData({ text = '', target = '' } = {}) {
  const reasons = []
  for (const re of TEXT) {
    const m = String(text).match(re)
    if (m) reasons.push(`text: ${m[0].trim().slice(0, 40)}`)
  }
  const path = String(target).replace(/\\/g, '/')
  if (PATH.some(re => re.test(path))) reasons.push(`target: ${path}`)
  return { touches: reasons.length > 0, reasons }
}
