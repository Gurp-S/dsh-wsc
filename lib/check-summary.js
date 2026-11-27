/**
 * Test-runner summaries.
 *
 * The checkpoint's Checks section used to keep only the first non-empty line of
 * a tool result, which for `node --test` is a single case or "(no output)".
 * A resuming model then read that as a green suite. These parsers keep the
 * count when the output actually carries one, and say so honestly when it does
 * not.
 */

const ANSI = /\u001b\[[0-9;]*m/g

const number = (text, pattern) => {
  const match = pattern.exec(text)
  return match === null ? null : Number(match[1])
}

/** Node's spec reporter: `ℹ pass 22`, `ℹ fail 0`, `ℹ tests 22`, `ℹ skipped 1`. */
const nodeSummary = (text) => {
  const pass = number(text, /(?:^|\n)\s*(?:ℹ|#)\s*pass\s+(\d+)/i)
  const fail = number(text, /(?:^|\n)\s*(?:ℹ|#)\s*fail\s+(\d+)/i)
  if (pass === null && fail === null) return null
  const tests = number(text, /(?:^|\n)\s*(?:ℹ|#)\s*tests\s+(\d+)/i)
  const skipped = number(text, /(?:^|\n)\s*(?:ℹ|#)\s*skipped\s+(\d+)/i)
  return { tests: tests ?? (pass ?? 0) + (fail ?? 0), pass, fail, skipped }
}

/** pytest: `22 passed`, `1 failed`, `2 skipped`. */
const pytestSummary = (text) => {
  const match = /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?(?:,\s*(\d+)\s+skipped)?/i.exec(text)
  if (match === null) return null
  const pass = Number(match[1])
  const fail = match[2] === undefined ? 0 : Number(match[2])
  const skipped = match[3] === undefined ? null : Number(match[3])
  return { tests: pass + fail + (skipped ?? 0), pass, fail, skipped }
}

/** Mocha / Jest / tap-ish: `22 passing`, `1 failing`. */
const jsSummary = (text) => {
  const pass = number(text, /(\d+)\s+passing/i)
  const fail = number(text, /(\d+)\s+failing/i)
  if (pass === null && fail === null) return null
  return { tests: (pass ?? 0) + (fail ?? 0), pass, fail, skipped: null }
}

/** pytest's short summary can be on the same line as the last dot. */
const SPEC_CASE = /(?:^|\n)\s*(?:✔|✖|✓|✗|√|×|ok\s+\d+|not ok\s+\d+)\s*\S/

/**
 * @param {string} text full tool result.
 * @returns {{ kind: 'summary'|'first-case'|'none', tests: number|null,
 *   pass: number|null, fail: number|null, skipped: number|null }}
 */
export function checkSummary(text) {
  const clean = String(text ?? '').replace(ANSI, '')
  for (const parse of [nodeSummary, pytestSummary, jsSummary]) {
    const found = parse(clean)
    if (found !== null) return { kind: 'summary', ...found }
  }
  if (SPEC_CASE.test(clean)) {
    return { kind: 'first-case', tests: null, pass: null, fail: null, skipped: null }
  }
  return { kind: 'none', tests: null, pass: null, fail: null, skipped: null }
}

/** One phrase for the Checks section. */
export function checkSummaryText(summary) {
  if (summary === undefined || summary === null || summary.kind === 'none') return ''
  if (summary.kind === 'first-case') return 'only the first case is visible; no suite summary in the output'
  const pass = summary.pass ?? 0
  const fail = summary.fail ?? 0
  const suffix = summary.skipped !== null && summary.skipped > 0 ? `, ${summary.skipped} skipped` : ''
  return `${pass} pass / ${fail} fail${suffix}`
}
