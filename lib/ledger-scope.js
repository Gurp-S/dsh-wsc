/**
 * Keep the checkpoint's ledger about the current request.
 *
 * The journal is session-wide on purpose: an old value must remain retrievable.
 * The checkpoint is not: facts and decisions from an earlier task spend bytes
 * that the current task needs, and the model cannot tell them apart. This is a
 * render-time scope, not a journal mutation — archived entries stay in the
 * journal and are named by topic count.
 */
import { cjkTerms, significantTerms } from './state.js'

const PATH = /[A-Za-z0-9_./\\-]+\.(?:py|js|mjs|cjs|ts|tsx|json|md|yml|yaml|toml|txt)/g
const PR_ID = /\bPR-\d+\b/gi

const slash = (value) => String(value ?? '').replace(/\\/g, '/').toLowerCase()
const pathLike = (term) => /[\\/]/.test(term) || /\.[a-z0-9]{1,5}$/i.test(term)

const termsOf = (controls) => {
  const terms = new Set()
  const paths = new Set()
  const prs = new Set()
  for (const text of controls ?? []) {
    for (const term of significantTerms(text)) {
      if (pathLike(term)) paths.add(slash(term))
      else terms.add(term.toLowerCase())
    }
    for (const term of cjkTerms(text)) terms.add(term)
    for (const path of String(text).match(PATH) ?? []) paths.add(slash(path))
    for (const pr of String(text).match(PR_ID) ?? []) prs.add(pr.toUpperCase())
  }
  return { terms, paths, prs }
}

const overlaps = (entry, scope) => {
  const text = String(entry.text ?? '')
  const lowered = text.toLowerCase()
  if ([...scope.prs].some((pr) => lowered.includes(pr.toLowerCase()))) return true
  if ((text.match(PATH) ?? []).some((path) => scope.paths.has(slash(path)))) return true
  return [...scope.terms].some((term) => lowered.includes(term.toLowerCase()))
}

/**
 * @param {object[]} ledger active ledger entries.
 * @param {{ controls?: string[], scopeSeq?: number }} input controls in order;
 *   `scopeSeq` is the session seq of the latest request.
 * @returns {{ active: object[], archived: object[] }}
 */
export function scopeLedger(ledger, input = {}) {
  const active = (ledger ?? []).filter((entry) => (entry.status ?? 'active') === 'active')
  const controls = (input.controls ?? []).filter((text) => String(text ?? '').trim() !== '')
  if (controls.length === 0) return { active, archived: [] }
  const scope = termsOf(controls.slice(-2))
  const scopeSeq = Number(input.scopeSeq ?? 0)
  const kept = []
  const archived = []
  for (const entry of active) {
    const kind = entry.kind
    const seq = Number(entry.seq ?? entry.order ?? 0)
    if (kind === 'requirement' || kind === 'constraint') {
      kept.push(entry)
      continue
    }
    if (seq > 0 && scopeSeq > 0 && seq >= scopeSeq) {
      kept.push(entry)
      continue
    }
    if (overlaps(entry, scope)) kept.push(entry)
    else archived.push(entry)
  }
  // If the scoped view would be empty, the current request has no claim yet;
  // keep the newest factual entry as orientation rather than rendering nothing.
  if (kept.length === 0 && active.length > 0) {
    const newest = [...active].sort((left, right) =>
      Number(right.seq ?? right.order ?? 0) - Number(left.seq ?? left.order ?? 0))[0]
    if (newest !== undefined) {
      kept.push(newest)
      return { active: kept, archived: archived.filter((entry) => entry !== newest) }
    }
  }
  kept.sort((left, right) => (left.seq ?? left.order ?? 0) - (right.seq ?? right.order ?? 0))
  return { active: kept, archived }
}
