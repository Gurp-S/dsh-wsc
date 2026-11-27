/**
 * Ledger topic helpers — experiment module (not imported by the engine).
 *
 * Two pieces are kept here for the staged ledger work:
 *
 *   1. A stable subject key (`<area>.<topic>` or `<path>#<symbol>`), read from
 *      an entry's `subject` field or from a `[subject]` text prefix. Nothing in
 *      the production path sets that field yet, so this is a parser only.
 *   2. `displayFold`: merge identical or near-identical claims under one
 *      subject into the newest line plus `(+N older: id…)`. It *never* claims
 *      the old lines were invalidated; semantic folding stays out of scope
 *      until a later, separately gated step.
 *
 * The journal is untouched: hidden lines stay addressable by id@rev.
 */

const SUBJECT = /^[a-z0-9][a-z0-9._/#-]{0,63}$/
const SCOPES = new Set(['p2p', 'group', 'module'])
const EXEMPT_KINDS = new Set(['requirement', 'constraint'])
const WORD = /[a-z0-9_]+/g
const HAN = /[㐀-鿿]+/g
const AUTHORITY_SUFFIX = /（最新权威[^）]*）$/
const COLLAPSED_SUFFIX = /（\+\d+ 条旧版本[^）]*）$/

/** Lowercase a model-supplied subject; '' when it is not a stable key. */
export function normalizeSubject(value) {
  const text = String(value ?? '').trim().toLowerCase()
  return SUBJECT.test(text) ? text : ''
}

/** `[attachment.group-file.delivery] …` — the schema-free fallback. */
const bracketSubject = (text) => {
  const match = /^\[([a-z0-9][a-z0-9._/#-]{0,63})\]\s*/.exec(String(text ?? '').trim())
  return match === null ? '' : match[1]
}

export function subjectOf(entry) {
  const direct = normalizeSubject(entry?.subject)
  if (direct !== '') return direct
  return bracketSubject(entry?.text)
}

/** Explicit scope wins; otherwise the first subject segment names it. */
export function scopeOf(entry, subject = subjectOf(entry)) {
  const scope = String(entry?.scope ?? '').trim().toLowerCase()
  if (SCOPES.has(scope)) return scope
  const head = subject.split('.')[0]
  return SCOPES.has(head) ? head : ''
}

const clock = (entry) => Number(entry?.seq ?? entry?.order ?? 0)
const label = (entry) => `${entry?.id ?? '?'}@${entry?.rev ?? 1}`
const stripSuffix = (text) => String(text ?? '').replace(AUTHORITY_SUFFIX, '').replace(COLLAPSED_SUFFIX, '')
const claim = (text) => stripSuffix(text).toLowerCase().replace(/\s+/g, ' ').trim()

const tokensOf = (text) => {
  const source = String(text ?? '').toLowerCase()
  const set = new Set(source.match(WORD) ?? [])
  // CJK text has no spaces; bigrams keep near-identical Chinese claims
  // comparable without a word segmenter.
  for (const run of source.match(HAN) ?? []) {
    for (let index = 0; index + 1 < run.length; index += 1) set.add(run.slice(index, index + 2))
  }
  return set
}
const jaccard = (left, right) => {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

/**
 * Display-only fold: merge same-subject claims that are identical or near
 * identical; keep divergent claims as separate lines.
 *
 * @param {Array<object>} entries active ledger entries.
 * @param {{ threshold?: number }} [options]
 * @returns {{ entries: object[], collapsed: number, hiddenIds: string[] }}
 */
export function displayFold(entries, options = {}) {
  const threshold = options.threshold ?? 0.7
  const list = (entries ?? []).filter((entry) => (entry.status ?? 'active') === 'active')
  const kept = []
  const hiddenIds = []
  let collapsed = 0
  const groups = new Map()
  for (const entry of list) {
    if (EXEMPT_KINDS.has(entry.kind)) {
      kept.push(entry)
      continue
    }
    const subject = subjectOf(entry)
    const key = subject === ''
      ? `text:${claim(entry.text)}`
      : `${entry.kind}|${scopeOf(entry, subject)}|${subject}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  for (const members of groups.values()) {
    const ordered = [...members].sort((a, b) => clock(a) - clock(b) ||
      String(a.id ?? '').localeCompare(String(b.id ?? '')))
    if (ordered.length === 1) {
      kept.push(ordered[0])
      continue
    }
    const newest = ordered[ordered.length - 1]
    const newer = tokensOf(claim(newest.text))
    const same = ordered.slice(0, -1).filter((entry) =>
      claim(entry.text) === claim(newest.text) || jaccard(tokensOf(claim(entry.text)), newer) >= threshold)
    const divergent = ordered.slice(0, -1).filter((entry) => !same.includes(entry))
    kept.push(...divergent)
    if (same.length === 0) {
      kept.push(newest)
      continue
    }
    collapsed += same.length
    hiddenIds.push(...same.map((entry) => label(entry)))
    const ids = same.map((entry) => label(entry)).join(', ')
    kept.push({
      ...newest,
      text: same.every((entry) => claim(entry.text) === claim(newest.text))
        ? stripSuffix(newest.text)
        : `${stripSuffix(newest.text)}（+${same.length} 条旧版本：${ids}）`,
    })
  }
  kept.sort((a, b) => clock(a) - clock(b) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
  return { entries: kept, collapsed, hiddenIds }
}

/**
 * Extraction-side index (experiment): newest entry per subject, newest first.
 *
 * @param {Array<object>} entries ledger entries (any status).
 * @param {{ maxSubjects?: number, maxChars?: number }} [options]
 * @returns {string}
 */
export function ledgerIndex(entries, options = {}) {
  const maxSubjects = Math.max(1, options.maxSubjects ?? 40)
  const maxChars = Math.max(200, options.maxChars ?? 2400)
  const active = (entries ?? []).filter((entry) => (entry.status ?? 'active') === 'active')
  if (active.length === 0) return ''
  const groups = new Map()
  for (const entry of active) {
    const subject = subjectOf(entry)
    const key = subject === '' ? `id:${entry.id}` : `${entry.kind}|${scopeOf(entry, subject)}|${subject}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(entry)
  }
  const rows = [...groups.values()].map((members) => {
    const newest = members.reduce((a, b) => (clock(b) >= clock(a) ? b : a))
    return { newest, versions: members.length }
  }).sort((a, b) => clock(b.newest) - clock(a.newest)).slice(0, maxSubjects)

  const header = '## Current ledger index (reuse a subject; revise by id@rev)'
  const lines = []
  let total = header.length
  for (const { newest, versions } of rows) {
    const subject = subjectOf(newest)
    const scope = scopeOf(newest, subject)
    const text = stripSuffix(String(newest.text ?? '')).replace(/\s+/g, ' ').slice(0, 120)
    const tag = subject === '' ? '(no subject)' : `[${subject}]${scope === '' ? '' : ` (${scope})`}`
    const more = versions > 1 ? ` [${versions} versions]` : ''
    const line = `- ${tag} ${newest.kind ?? 'fact'} ${label(newest)}: ${text}${more}`
    if (total + line.length + 1 > maxChars) break
    lines.push(line)
    total += line.length + 1
  }
  return lines.length === 0 ? '' : [header, ...lines].join('\n')
}
