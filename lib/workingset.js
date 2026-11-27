/**
 * Working-set snapshots for the checkpoint.
 *
 * A compaction that drops tool results also drops the file contents the model
 * just read. The model then re-reads them, which refills the context and
 * triggers the next compaction. Measured on the fixture task, that loop made a
 * run read 11x more than an uncompacted run for the same 16 files.
 *
 * The fix is to carry state rather than a narrative about state: keep the last
 * known content of every file the model read or wrote, and mark a snapshot
 * stale when a later edit changed it, so the model never edits from a snapshot
 * that is silently out of date.
 *
 * The tracker is stateful on purpose. One compaction only shadows a dozen
 * messages, so a set rebuilt from that region alone forgets every file read two
 * compactions ago; a checkpoint that carries its predecessor's set forward keeps
 * them.
 */

import { toolResultOf } from './projection.js'

const DEFAULT_CAP_CHARS = 1200
const DEFAULT_MAX_FILES = 8
const EDIT_EXCERPT = 160
const SECTION_HEADING = '## Working set'

/**
 * dsh writes oversized tool output to a per-session spill file and leaves a
 * pointer behind. A model that follows the pointer is reading a temp dump of a
 * past tool result, not project state: carrying it forward costs bytes and
 * teaches nothing after the answer is used. The OS temp directory holds the
 * same kind of one-off artifact.
 */
const ARTIFACT_PATH = /(?:^|[\\/])dsh-spill-[^\\/]+[\\/]session-[^\\/]+[\\/]/i
const TEMP_PATH = /(?:^|[\\/])AppData[\\/]Local[\\/]Temp[\\/]|^\/tmp\//i
export const isArtifactPath = (path) =>
  typeof path === 'string' && (ARTIFACT_PATH.test(path) || TEMP_PATH.test(path))

/**
 * Keep a carried body from opening a checkpoint section of its own. File text
 * is quoted material; a line that starts with `##` must not read as structure.
 * Fenced code keeps its own `#` lines: escaping those would corrupt the code.
 */
export const escapeHeadings = (text) => {
  let fenced = false
  return String(text ?? '').split('\n').map((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      return line
    }
    return !fenced && /^#{1,6}(?=\s|$)/.test(line) ? `\\${line}` : line
  }).join('\n')
}

/**
 * Strip the read tool's own envelope from its output.
 *
 * The tool answers with `<path>…</path>\n<type>file</type>\n<content>\n…`, and
 * the path is already printed on the item's first line, so the envelope is
 * duplicated metadata rather than file content.
 *
 * @param {string} text raw tool output.
 * @returns {string} the file body.
 */
const READ_TRAILER = /^\((?:Showing lines \d+-\d+ of \d+[^)]*|End of file - total \d+ lines[^)]*)\)$/i

export const unwrapReadResult = (text) => {
  const open = text.indexOf('<content>')
  const close = text.lastIndexOf('</content>')
  if (open === -1 || close <= open) return text
  return text.slice(open + '<content>'.length, close)
    .replace(/^\r?\n/, '')
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .filter((line) => !READ_TRAILER.test(line.trim()))
    .join('\n')
}

export const safeParse = (value) => {
  if (typeof value === 'object' && value !== null) return value
  if (typeof value !== 'string') return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

export const pathOf = (args) => {
  const candidate = args.path ?? args.file_path ?? args.target_file ?? args.notebook_path
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

/** Keep both ends of a long file: edits usually touch one or the other. */
export function clamp(text, limit) {
  if (text.length <= limit) return text
  const headBudget = Math.floor(limit * 0.7)
  const headEnd = text.lastIndexOf('\n', headBudget)
  const head = headEnd > 0 ? text.slice(0, headEnd) : text.slice(0, headBudget)
  const tailBudget = Math.max(1, limit - head.length - 40)
  const tailStart = text.length - tailBudget
  const tailBreak = text.indexOf('\n', tailStart)
  const tail = tailBreak >= 0 ? text.slice(tailBreak + 1) : text.slice(tailStart)
  const omitted = Math.max(1, text.slice(head.length, text.length - tail.length).split(/\r?\n/).length - 1)
  return `${head}\n… ${omitted} ${omitted === 1 ? 'line' : 'lines'} omitted …\n${tail}`
}

const DOC_FILE = /\.md$/i
const DOC_PATH = /[A-Za-z0-9_./\\-]+\.(?:py|js|mjs|cjs|ts|tsx|json|md|yml|yaml|toml|txt)/g
const NUMBERED_LINE = /^\s*\d+:\s?/

/**
 * The read tool returns every line prefixed with its number (`7: | PR | …`).
 * Structure parsers match on the first character of the line, so a numbered
 * document must be de-numbered before it can be read as markdown. Only a
 * consistently numbered body is rewritten; a file whose own text happens to
 * start with `3:` keeps its bytes.
 *
 * @param {string} text
 * @returns {string[]} lines without the read-tool numbering.
 */
export const stripLineNumbers = (text) => {
  const lines = String(text ?? '').split(/\r?\n/)
  const filled = lines.filter((line) => line.trim() !== '')
  if (filled.length < 2) return lines
  const numbered = filled.filter((line) => NUMBERED_LINE.test(line)).length
  return numbered / filled.length >= 0.6
    ? lines.map((line) => line.replace(NUMBERED_LINE, ''))
    : lines
}

/**
 * A document is not source code: its value is its structure, not its first and
 * last bytes. Keep the title, the heading outline, the tables (a PR table
 * first), an acceptance map and the last section, then fit the budget.
 */
export function docClamp(text, limit) {
  if (text.length <= limit) return text
  const lines = stripLineNumbers(text)
  let fenced = false
  const headings = []
  const tables = []
  const acceptance = []
  let currentAcceptance = null
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced
      continue
    }
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line)
    if (!fenced && heading !== null) {
      headings.push({ level: heading[1].length, text: line.trim(), index })
      const id = /^#{2,3}\s+([A-Z]\d+)\b/.exec(line)?.[1]
      currentAcceptance = id === undefined ? null : { id, paths: [] }
      if (currentAcceptance !== null) acceptance.push(currentAcceptance)
      continue
    }
    if (!fenced && /^\s*\|/.test(line)) {
      const start = index
      while (index + 1 < lines.length && /^\s*\|/.test(lines[index + 1])) index += 1
      tables.push({ start, text: lines.slice(start, index + 1).join('\n') })
      continue
    }
    if (currentAcceptance !== null) {
      for (const path of line.match(DOC_PATH) ?? []) {
        if (!currentAcceptance.paths.includes(path)) currentAcceptance.paths.push(path)
      }
    }
  }

  if (headings.length === 0 && tables.length === 0 && acceptance.length === 0) {
    return clamp(text, limit)
  }
  const firstHeading = headings[0]
  const title = firstHeading === undefined
    ? lines.slice(0, 2).join('\n')
    : lines.slice(0, firstHeading.index + 1).join('\n')
  const outline = headings
    .map((heading) => `  ${heading.text}`.slice(0, 90))
    .slice(0, 24)
  const acceptanceLines = acceptance
    .filter((item) => item.paths.length > 0)
    .map((item) => `${item.id}: ${item.paths[0]}`)
    .slice(0, 16)
  const rankedTables = tables
    .map((table) => ({ table, score: /\|\s*PR-\d+\s*\|/i.test(table.text) ? 2 : 1 }))
    .sort((left, right) => right.score - left.score)
    .map((row) => row.table.text)
  const lastHeading = [...headings].reverse().find((heading) => heading.index > 0)
  const tail = lastHeading === undefined ? '' : lines.slice(lastHeading.index).join('\n').slice(0, 360)

  const sections = [
    `[document structure: ${headings.length} headings, ${tables.length} tables, ${text.length} chars]`,
    title.slice(0, 240),
    outline.length === 0 ? '' : `[outline]\n${outline.join('\n')}`,
    rankedTables.length === 0 ? '' : `[tables]\n${rankedTables[0].slice(0, 520)}`,
    acceptanceLines.length === 0 ? '' : `[acceptance]\n${acceptanceLines.join('\n')}`,
    tail === '' ? '' : `[last section]\n${tail}`,
  ].filter((section) => section !== '')
  let result = ''
  for (const section of sections) {
    if (result === '') {
      result = section
      continue
    }
    if (`${result}\n\n${section}`.length > limit) continue
    result = `${result}\n\n${section}`
  }
  return result.length > 0 ? result : clamp(text, limit)
}

export const isDocumentPath = (path) => DOC_FILE.test(String(path ?? ''))

export const lineCount = (text) => text.split('\n').length

const ITEM_HEADER = /^(.+?) — (read|write|edit) #(\d+)(.*)$/

/**
 * Parse a rendered working-set section back into entries.
 *
 * The checkpoint is the only carrier between compactions, so the next set is
 * seeded from the previous section's text. A stale item carries no body (it was
 * deliberately withheld), only the edit that invalidated it.
 *
 * @param {string} text prior checkpoint text (wrapper already stripped).
 * @returns {Array<object>} entries in render order.
 */
function parseSection(text) {
  const at = text.indexOf(SECTION_HEADING)
  if (at === -1) return []
  const lines = text.slice(at).split('\n').slice(1)
  const entries = []
  let current
  for (const line of lines) {
    if (line.startsWith('## ')) break
    const header = ITEM_HEADER.exec(line)
    if (header !== null) {
      const [, path, kind, clock, rest] = header
      if (isArtifactPath(path)) {
        current = undefined
        continue
      }
      const entry = {
        path,
        snapshot: undefined,
        edits: [],
        clock: Number(clock),
        kind,
      }
      if (rest.includes('unchanged since')) {
        const size = /(\d+) lines/.exec(rest)
        entry.snapshot = { text: '', clock: Number(clock), kind, lines: size === null ? 0 : Number(size[1]) }
      } else {
        const edited = /edited at #(\d+)/.exec(rest)
        const excerpt = /last edit wrote: (".*")\s*$/.exec(rest)
        let newText = ''
        if (excerpt !== null) {
          try {
            newText = String(JSON.parse(excerpt[1])).slice(0, EDIT_EXCERPT)
          } catch {
            newText = ''
          }
        }
        entry.edits.push({ clock: edited === null ? Number(clock) : Number(edited[1]), newText })
      }
      entries.push(entry)
      current = entry
      continue
    }
    if (current !== undefined && current.snapshot !== undefined && line.length > 0) {
      current.snapshot.text += `${current.snapshot.text.length === 0 ? '' : '\n'}${line}`
    }
  }
  return entries
}

/**
 * Create a tracker that accumulates file state across compactions.
 *
 * @param {{ capChars?: number, maxFiles?: number, seed?: string }} options
 *   `seed` is the previous checkpoint's text; its working-set section, if any,
 *   is restored before the new region is applied.
 * @returns {{ apply: (messages: ReadonlyArray<object>) => void, items: () => string[], size: () => number }}
 */
export function createWorkingSet(options = {}) {
  const capChars = options.capChars ?? DEFAULT_CAP_CHARS
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const docStructure = options.docStructure === true
  const pendingReads = new Map()
  const entries = new Map()
  let clock = 0

  const entryOf = (path, index) => {
    let entry = entries.get(path)
    if (entry === undefined) {
      entry = { path, snapshot: undefined, edits: [], lastTouch: index }
      entries.set(path, entry)
    }
    entry.lastTouch = index
    return entry
  }

  if (typeof options.seed === 'string' && options.seed.length > 0) {
    for (const entry of parseSection(options.seed)) {
      entries.set(entry.path, { ...entry, lastTouch: entry.clock })
      clock = Math.max(clock, entry.clock + 1)
    }
  }

  const apply = (messages) => {
    for (const message of messages) {
      const index = clock
      clock += 1
      if (message.role === 'assistant') {
        for (const block of message.content ?? []) {
          if (block?.type !== 'tool-call') continue
          const args = safeParse(block.arguments)
          const path = pathOf(args)
          if (path === undefined || isArtifactPath(path)) continue
          if (block.name === 'read') {
            pendingReads.set(block.id, { path, index })
            entryOf(path, index)
          } else if (block.name === 'write') {
            const content = args.content ?? args.file_text ?? args.text
            const entry = entryOf(path, index)
            if (typeof content === 'string') {
              entry.snapshot = { text: content, clock: index, kind: 'write' }
              entry.edits = []
            }
          } else if (block.name === 'edit') {
            const entry = entryOf(path, index)
            const newText = String(args.new_string ?? args.newText ?? '')
            entry.edits.push({ clock: index, newText: newText.slice(0, EDIT_EXCERPT) })
          }
        }
        continue
      }
      // A tool result is a user-role message carrying a `tool-result` block:
      // the call id and the error flag live on that block, and the body is a
      // nested `content` array rather than a message-level `text` block.
      const result = toolResultOf(message)
      if (result === undefined) continue
      const read = pendingReads.get(result.callId)
      if (read === undefined) continue
      pendingReads.delete(result.callId)
      if (result.isError) continue
      const text = unwrapReadResult(result.text)
      if (text.trim().length === 0) continue
      const entry = entryOf(read.path, read.index)
      entry.snapshot = { text, clock: read.index, kind: 'read' }
      entry.edits = []
    }
  }

  const items = () => {
    const ordered = [...entries.values()]
      .filter((entry) => entry.snapshot !== undefined && !isArtifactPath(entry.path))
      .sort((left, right) => left.lastTouch - right.lastTouch)
      .slice(-maxFiles)

    const lines = []
    for (const entry of ordered) {
      const { snapshot } = entry
      const stale = entry.edits.filter((edit) => edit.clock > snapshot.clock)
      const source = `${snapshot.kind} #${snapshot.clock}`
      if (stale.length === 0) {
        const raw = snapshot.text.trimEnd()
        const body = escapeHeadings(docStructure && isDocumentPath(entry.path)
          ? docClamp(raw, Math.max(capChars, 1200))
          : clamp(raw, capChars))
        const size = snapshot.lines ?? lineCount(snapshot.text)
        lines.push(`${entry.path} — ${source}, unchanged since; ${size} lines\n${body}`)
        continue
      }
      // A stale snapshot is a trap: name the fact that it is out of date and show
      // only what the model itself wrote afterwards, never the out-of-date body.
      const lastEdit = stale.at(-1)
      const excerpt = lastEdit.newText.length > 0 ? `: ${JSON.stringify(lastEdit.newText)}` : ''
      lines.push(
        `${entry.path} — ${source}; body stale, edited at #${stale.map((edit) => edit.clock).join(', #')}` +
          `; last edit wrote${excerpt}`,
      )
    }
    return lines
  }

  return { apply, items, size: () => entries.size }
}

/**
 * @param {ReadonlyArray<object>} messages replayed region messages, in order.
 * @param {{ capChars?: number, maxFiles?: number, seed?: string }} options
 * @returns {string[]} one entry per file, oldest touch first.
 */
export function buildWorkingSet(messages, options = {}) {
  const tracker = createWorkingSet(options)
  tracker.apply(messages)
  return tracker.items()
}
