/**
 * Admission of model-written next actions.
 *
 * The extractor labels user messages with an ordinal inside the compaction.
 * An action is admitted only when at least one row serves the newest user
 * request; without that gate the model can resurface an old goal as "next".
 * Malformed rows are dropped; an empty result keeps the deterministic
 * promotion in the caller.
 *
 * @param {Array<{ text?: unknown, user?: unknown }>} items parsed next rows.
 * @param {number} userCount number of user messages labelled in this call.
 * @param {number} [limit]
 * @returns {string[]} admitted texts, newest request included.
 */
export function modelNextTexts(items, userCount, limit = 3) {
  if (!Array.isArray(items) || !Number.isInteger(userCount) || userCount < 1) return []
  if (!items.some((item) => item?.user === userCount)) return []
  const texts = []
  for (const item of items) {
    if (!Number.isInteger(item?.user) || item.user < 1 || item.user > userCount) continue
    const text = String(item?.text ?? '').replace(/\s+/g, ' ').trim()
    if (text === '' || text.length > 200) continue
    if (texts.includes(text)) continue
    texts.push(text)
    if (texts.length >= limit) break
  }
  return texts.length === 0 ? [] : texts
}

/**
 * Replace the deterministic next rows with admitted model rows.
 *
 * Kept as a pure function so a missing extraction result cannot become an
 * engine-only crash: an empty or absent result returns the state unchanged.
 *
 * @param {{ done: string[], open: string[], next: string[], unknown: string[] }} workState
 * @param {unknown} items parsed next rows from the extraction.
 * @param {number} userCount
 * @param {boolean} enabled
 * @param {number} [limit]
 */
export function applyModelNext(workState, items, userCount, enabled, limit = 3) {
  const texts = enabled === true ? modelNextTexts(items, userCount, limit) : []
  if (texts.length === 0) return workState
  return {
    ...workState,
    next: texts,
    open: workState.open.filter((row) => !texts.some((text) =>
      row.toLowerCase().includes(text.slice(0, 60).toLowerCase()))),
  }
}
