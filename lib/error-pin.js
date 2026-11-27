/**
 * The one unresolved failure a checkpoint should mention.
 *
 * A pin is actionable only when the failure is flagged by the runtime or its
 * first real line opens as an error, and the address belongs to the workspace.
 * Scanning whole result text for the word "error" pins a successful source read
 * (`throw new Error(...)`) and names a spill file as the location.
 */
import { toolResultOf } from './projection.js'
import {
  envelopePathOf, firstLine, isOutsideWorkspace, looksLikeError, unwrapToolResult,
} from './values.js'

const LOCATION = /((?:[A-Za-z]:)?[\\/][^\s:]+\.\w+:\d+|[\w./\\-]+\.\w+:\d+)/

const lineOf = (text) => firstLine(text).replace(/^\d+:\s*/, '')

const parseArgs = (value) => {
  if (value !== null && typeof value === 'object') return value
  try { return JSON.parse(String(value ?? '')) } catch { return {} }
}

const callsOf = (rows) => {
  const calls = new Map()
  for (const row of rows) {
    for (const block of row?.message?.content ?? []) {
      if (block?.type === 'tool-call' && typeof block.id === 'string') {
        calls.set(block.id, {
          name: block.name,
          command: String(parseArgs(block.arguments).command ?? parseArgs(block.arguments).cmd ?? ''),
        })
      }
    }
  }
  return calls
}

const sameCommand = (left, right) =>
  left !== '' && right !== '' && left.trim() === right.trim()

/**
 * The newest actionable failure, with the context a resume decision needs.
 * @returns {{ line: string, location: string, command: string, blocking: string } | null}
 */
export function errorContextOf(rows) {
  const calls = callsOf(rows)
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const result = toolResultOf(rows[index]?.message)
    if (result === undefined) continue
    const text = String(result.text ?? '').trim()
    if (text === '') continue
    if (!looksLikeError(text, result.isError === true)) continue

    const envelope = envelopePathOf(text)
    if (envelope !== '' && isOutsideWorkspace(envelope)) continue

    const unwrapped = unwrapToolResult(text)
    const line = lineOf(unwrapped)
    if (line === '' || line.startsWith('<')) continue
    if (isOutsideWorkspace(line)) continue

    const found = LOCATION.exec(unwrapped)?.[1] ?? ''
    const location = found === '' || isOutsideWorkspace(found) ? '' : found
    const command = calls.get(result.callId)?.command ?? ''
    // A command that later completed without an error is a recovered probe, not
    // a blocker; one with no later run is unresolved, and saying so is more
    // useful than guessing.
    let blocking = command === '' ? 'unknown' : 'unresolved (no later command run)'
    if (command !== '') {
      for (let later = index + 1; later < rows.length; later += 1) {
        const next = toolResultOf(rows[later]?.message)
        if (next === undefined) continue
        const nextCommand = calls.get(next.callId)?.command ?? ''
        if (!sameCommand(command, nextCommand)) continue
        if (!looksLikeError(next.text, next.isError === true)) {
          blocking = `no (recovered at #${rows[later]?.seq ?? later + 1})`
          break
        }
      }
    }
    return { line: line.slice(0, 160), location, command, blocking }
  }
  return null
}

/**
 * @param {ReadonlyArray<{ message: object, seq?: number }>} rows region rows, oldest first.
 * @returns {string} a `## Unresolved error` section, or ''.
 */
export function errorPinOf(rows) {
  const context = errorContextOf(rows)
  if (context === null) return ''
  const { line, location, command, blocking } = context
  return [
    '## Unresolved error',
    `- ${location === '' ? '' : `${location}: `}${line}`,
    `- command: ${command === '' ? '(unknown)' : command.slice(0, 120)}`,
    `- blocking: ${blocking}`,
  ].join('\n')
}
