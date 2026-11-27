/**
 * Categorise the unresolved side of the work state.
 *
 * `done/open/next/unknown` is the dsh contract; adding labels to the object
 * would break its parser. The categories therefore live as prefixes inside
 * `unknown` rows: a reader sees the category, while a replay sees one string.
 */
import { checkSummaryText } from './check-summary.js'

const MAX_ROWS = 6
const clip = (text, limit) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

const acceptanceRow = (receipt) => {
  const command = receipt.command === '' ? 'check' : receipt.command
  if (receipt.summary?.kind === 'summary' && (receipt.summary.fail ?? 0) > 0) {
    return `Acceptance — ${receipt.path} ${command} check #${receipt.check}: ${checkSummaryText(receipt.summary)}`
  }
  if (receipt.summary?.kind !== 'summary' && /(?:✖|✗|×|\bfail(?:ed|ing)?\b)/i.test(String(receipt.result ?? ''))) {
    return `Acceptance — ${receipt.path} ${command} check #${receipt.check} reported: ${clip(receipt.result, 80)}`
  }
  return ''
}

const pathOf = (row) => (String(row).match(/[A-Za-z0-9_.\\/-]+\.[A-Za-z0-9]{1,6}/) ?? [])[0] ?? ''
const keyOf = (row) => `${String(row).split(' — ')[0]}:${pathOf(row)}`

/**
 * @param {{done: string[], open: string[], next: string[], unknown: string[]}} state
 * @param {{ receipts?: object[] }} context
 * @returns {object} the same state with category rows in `unknown`.
 */
export function categorizeState(state, context = {}) {
  // A failed check is the only category that belongs in the work state: it
  // says a claimed completion does not hold. The unresolved error and the
  // extraction gaps already have their own sections; repeating them here
  // filled Open/Unknown with diagnostics instead of work.
  const categories = []
  for (const receipt of context.receipts ?? []) {
    const row = acceptanceRow(receipt)
    if (row !== '') categories.push(row)
  }
  if (categories.length === 0) return state

  const seenKeys = new Set((state.unknown ?? []).map(keyOf))
  const added = []
  for (const row of categories) {
    const key = keyOf(row)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    added.push(clip(row, 200))
  }
  return {
    ...state,
    unknown: [...added, ...(state.unknown ?? [])].slice(0, MAX_ROWS),
  }
}
