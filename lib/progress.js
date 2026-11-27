/**
 * Mechanical progress for the checkpoint.
 *
 * A plan document that carries a PR table (`| PR-1 | A1 … |`) is the strongest
 * source: the table names the units and the A sections name the files. When no
 * such plan exists, the board falls back to the engine's own done/open/next
 * rows, labelled as requirement-level so it never pretends to know a PR.
 *
 * Every status is evidence-bound. "done" needs a check for each of the PR's
 * listed acceptance units; an edit without a check is "in progress"; a failing
 * check is "blocked"; no edit is "not started". Nothing is inferred from
 * prose alone.
 */
import { stripLineNumbers, unwrapReadResult } from './workingset.js'
import { toolResultOf } from './projection.js'

const FILE_PATH = /[A-Za-z0-9_./\\-]+\.(?:py|js|mjs|cjs|ts|tsx|json|md|yml|yaml|toml|txt)/g
const PR_ID = /\bPR-\d+\b/g
const ACCEPTANCE = /\b[A-Z]\d+\b/g
const MAX_ROWS = 6

const slash = (value) => String(value ?? '').replace(/\\/g, '/').toLowerCase()
const samePath = (left, right) => {
  const a = slash(left)
  const b = slash(right)
  return a !== '' && b !== '' && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`))
}
const clip = (text, limit) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
const cells = (line) => line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((cell) => cell.trim())
const isTableRow = (line) => /^\s*\|/.test(line) && line.split('|').length >= 3

/**
 * Read a PR table and the acceptance sections that name its files.
 *
 * The table is generic: any header whose first cell is `PR` (or the row starts
 * with `PR-n`) is accepted. Acceptance sections are `### A1 …` style headings;
 * the file paths inside the section map the acceptance unit to receipts.
 *
 * @param {string} text plan document.
 * @returns {{ prs: object[], acceptance: Map<string, string[]> } | null}
 */
export function parsePrPlan(text) {
  const lines = stripLineNumbers(text)
  let header = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (!isTableRow(lines[index])) continue
    const first = cells(lines[index])[0] ?? ''
    if (/^PR$/i.test(first) || /pr\s*(?:id|阶段)/i.test(first)) {
      header = index
      break
    }
  }
  if (header === -1) return null
  const prs = []
  for (let index = header + 2; index < lines.length; index += 1) {
    if (!isTableRow(lines[index])) break
    const row = cells(lines[index])
    if (row.length < 2 || !/^PR-\d+$/i.test(row[0])) continue
    prs.push({ id: row[0].toUpperCase(), scope: row[1] ?? '', depends: row[2] ?? '', effort: row[3] ?? '' })
  }
  if (prs.length === 0) return null

  const acceptance = new Map()
  let current = null
  for (const line of lines) {
    const heading = /^#{2,3}\s+([A-Z]\d+)\b/.exec(line)
    if (heading !== null) {
      current = heading[1]
      if (!acceptance.has(current)) acceptance.set(current, [])
      continue
    }
    if (/^#{2,3}\s+/.test(line)) {
      current = null
      continue
    }
    if (current === null) continue
    for (const match of line.match(FILE_PATH) ?? []) {
      if (!acceptance.get(current).includes(match)) acceptance.get(current).push(match)
    }
  }
  return { prs, acceptance }
}

const failing = (receipt) =>
  (receipt.summary?.kind === 'summary' && (receipt.summary.fail ?? 0) > 0) ||
  /(?:✖|✗|×|\bfail(?:ed|ing)?\b)/i.test(String(receipt.result ?? ''))

const evidenceOf = (rows) => {
  if (rows.length === 0) return ''
  const last = rows.at(-1)
  const check = Number.isInteger(last.check) ? `, check #${last.check}` : ''
  const count = last.summary?.kind === 'summary'
    ? ` ${last.summary.pass ?? 0}/${(last.summary.pass ?? 0) + (last.summary.fail ?? 0)}`
    : ''
  return `${last.path} edit #${last.edit}${check}${count}`
}

/**
 * @param {{ planTexts?: string[], receipts?: object[], state?: object }} input
 * @returns {{ title: string, rows: object[] }}
 */
export function progressRows(input = {}) {
  const receipts = input.receipts ?? []
  const state = input.state ?? {}
  const nextText = (state.next ?? []).join(' ')
  let parsed = null
  for (const text of input.planTexts ?? []) {
    parsed = parsePrPlan(text)
    if (parsed !== null) break
  }
  if (parsed !== null) {
    const rows = parsed.prs.map((pr) => {
      const ids = [...new Set(pr.scope.match(ACCEPTANCE) ?? [])]
      const paths = [...new Set(ids.flatMap((id) => parsed.acceptance.get(id) ?? []))]
      const related = paths.length === 0
        ? []
        : receipts.filter((receipt) => paths.some((path) => samePath(path, receipt.path)))
      const failed = related.filter(failing)
      const checked = ids.filter((id) => {
        const idPaths = parsed.acceptance.get(id) ?? []
        return related.some((receipt) => Number.isInteger(receipt.check) &&
          idPaths.some((path) => samePath(path, receipt.path)))
      })
      let status = 'not started'
      if (failed.length > 0) status = 'blocked'
      else if (related.length > 0 && (ids.length === 0 || checked.length === ids.length)) status = 'done'
      else if (related.length > 0 || nextText.includes(pr.id)) status = 'in progress'
      const notPassed = ids.filter((id) => failed.some((receipt) =>
        (parsed.acceptance.get(id) ?? []).some((path) => samePath(path, receipt.path))))
      return {
        id: pr.id,
        status,
        current: evidenceOf(related),
        acceptance: notPassed.length > 0
          ? `${notPassed.join('/')} not passed`
          : ids.length === 0 ? 'not mapped' : `${ids.length} mapped; no failing check`,
      }
    })
    return { title: '## PR progress (mechanical)', rows: rows.slice(0, MAX_ROWS) }
  }

  const rows = []
  for (const [status, key] of [['done', 'done'], ['open', 'open'], ['next', 'next']]) {
    for (const text of (state[key] ?? []).slice(0, 2)) {
      const check = /check #(\d+)/.exec(text)
      rows.push({
        // The first column names the item; repeating the status there made the
        // table read "open | open | …" and hid which requirement it described.
        id: /req#\d+/.exec(text)?.[0] ?? clip(text, 40),
        status,
        current: clip(text, 70),
        acceptance: check === null ? 'no check recorded' : `check #${check[1]}`,
      })
    }
  }
  return { title: '## Progress (requirement-level)', rows: rows.slice(0, MAX_ROWS) }
}

/** @param {{ title: string, rows: object[] }} progress @returns {string} */
export function renderProgress(progress) {
  if (progress === null || progress === undefined || progress.rows.length === 0) return ''
  const clean = (value, limit = 70) =>
    clip(String(value ?? '').replace(/\|/g, '\\|'), limit)
  const lines = [
    progress.title,
    '| item | status | current | acceptance |',
    '|---|---|---|---|',
    ...progress.rows.map((row) => `| ${clean(row.id)} | ${clean(row.status)} | ` +
      `${clean(row.current, 80)} | ${clean(row.acceptance, 80)} |`),
  ]
  return lines.join('\n')
}

/**
 * Plan documents present in the region. A write carries the full body; a read
 * result carries it inside the tool envelope. Only Markdown with a PR cell is
 * considered, so ordinary source files cost nothing.
 */
export function planTextsOf(rows) {
  const texts = []
  for (const row of rows ?? []) {
    const message = row?.message
    for (const block of message?.content ?? []) {
      if (block?.type === 'tool-call' && block.name === 'write') {
        let args
        try { args = JSON.parse(String(block.arguments ?? '{}')) } catch { continue }
        const path = String(args.file_path ?? args.path ?? '')
        if (!/\.md$/i.test(path) || typeof args.content !== 'string') continue
        if (/\|\s*PR-\d+\s*\|/i.test(args.content)) texts.push(args.content)
      }
    }
    // A read result keeps its body in nested content blocks, not on the block
    // itself; reading `block.text` here was always empty.
    const result = toolResultOf(message)
    if (result === undefined || result.isError === true) continue
    const text = unwrapReadResult(result.text)
    if (text !== '' && /\|\s*PR-\d+\s*\|/i.test(text)) texts.push(text)
  }
  return texts.slice(-3)
}
