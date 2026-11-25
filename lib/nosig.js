/**
 * nosig ledger extraction: numbered segments, cited entries, literal
 * verification and an append-only journal.
 *
 * The model never paraphrases its own context here. Each segment is projected
 * as a numbered transcript and sent in its own request; every accepted entry
 * must cite a message in that segment. Presentation is engine-owned.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { byteLength } from './bytes.js'
import { isToolResult, messageText } from './projection.js'

export const NOSIG_EXT = [
  'The transcript above is a numbered coding-session region: each message is labelled [m<number> <role>].',
  'Extract the durable relations a later model cannot recompute from the events. Return only a JSON object:',
  '{"entries":[{"kind":"decision|fact","text":"<one relation>","cites":[<message numbers>]}],' +
    '"revise":[{"ref":"<current ref>","text":"<new relation>","cites":[<message numbers>]}]}',
  'Rules:',
  '- Copy exact values from tool results; never paraphrase a value, path, identifier or number.',
  '- Use these shapes: "<path or source>: <name> = <exact value>", "<property> is <exact value>",' +
    ' "decision: <choice> (<reason in a few words>)".',
  '- Do not restate user messages; the engine quotes them verbatim. Do not describe commands or edits; the engine derives them.',
  '- At most {entries} entries and {revisions} revisions. One relation each, at most 100 characters.',
  '- revise only a current relation this round contradicts or narrows; quote its ref. Never keep both current.',
  '- cites are the [m<number>] labels above; omit an entry you cannot cite. Omit rather than guess.',
  'Output only the JSON object.',
].join('\n')

export const NOSIG_EXT_QUOTE = [
  NOSIG_EXT.slice(0, NOSIG_EXT.indexOf('Output only the JSON object.')).trimEnd(),
  '- Every entry and revision must also carry "quote": the exact supporting text from the cited message.',
  '- The engine checks that quote byte-for-byte; a quote it cannot find rejects the entry.',
  'Output only the JSON object.',
].join('\n')

const EXTENSIONS = 'py|js|mjs|cjs|ts|tsx|json|md|yml|yaml|txt|toml|ini'
const ANCHORS = [
  new RegExp(`[A-Za-z0-9_./\\\\-]+\\.(?:${EXTENSIONS})\\b`, 'g'),
  /\b[A-Z]{2,}-\d+\b/g,
  /\b[A-Z][A-Z0-9_]{2,}\b/g,
  /\b[a-z]+[A-Z][A-Za-z0-9]+\b/g,
  /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g,
  /\b\d{2,}\b/g,
  /`[^`]{2,80}`/g,
]

/** @param {string} text @returns {string[]} identifying literals, de-duplicated. */
export function anchorsOf(text) {
  const found = []
  for (const pattern of ANCHORS) {
    for (const raw of String(text ?? '').match(pattern) ?? []) {
      const value = raw.replace(/^`|`$/g, '').trim()
      if (!value || /["\\{}[\]]/.test(value)) continue
      if (!found.some((item) => item.toLowerCase() === value.toLowerCase())) found.push(value)
    }
  }
  return found
}

/** @param {string} text @param {number} maxBytes @returns {string} */
function clipBytes(text, maxBytes) {
  if (byteLength(text) <= maxBytes) return text
  let cut = text
  while (cut.length > 0 && byteLength(cut) > maxBytes) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * Split a region into ordered segments at message boundaries.
 *
 * A segment is what one nosig call sees; the segment size is a safety bound,
 * not a compaction trigger.
 *
 * @param {ReadonlyArray<object>} messages
 * @param {{ maxBytes?: number, project?: (message: object) => string }} [options]
 * @returns {object[][]}
 */
export function segmentMessages(messages, options = {}) {
  const maxBytes = Math.max(1024, options.maxBytes ?? 24000)
  const project = options.project ?? ((message) => messageText(message, { toolText: true, toolCalls: true }))
  const segments = []
  let current = []
  let size = 0
  for (const message of messages) {
    const text = project(message)
    const cost = byteLength(text) + 64
    // A single oversized message stays alone: splitting it would break a tool
    // call from its result, and the extractor cannot rejoin the halves.
    if (current.length > 0 && size + cost > maxBytes) {
      segments.push(current)
      current = []
      size = 0
    }
    current.push(message)
    size += cost
  }
  if (current.length > 0) segments.push(current)
  return segments
}

/**
 * Numbered transcript for one segment. Labels are local to the segment; the
 * journal stores the segment ordinal alongside the cite.
 *
 * @param {ReadonlyArray<object>} messages
 * @returns {{ text: string, items: Array<{ index: number, role: string, text: string }> }}
 */
export function numberedSegment(messages) {
  const items = messages.map((message, index) => {
    const role = isToolResult(message) ? 'tool' : String(message.role ?? 'user')
    const text = messageText(message, { toolText: true, toolCalls: true })
    return { index: index + 1, role, text }
  })
  const text = items
    .map((item) => `[m${item.index} ${item.role}] ${item.text}`)
    .join('\n\n')
  return { text, items }
}

/** @param {string} text @param {{ entries?: number, revisions?: number }} options */
const DELTA_RULE = '- The current ledger is already known: do not restate an unchanged relation. ' +
  'Emit only relations this region adds or changes; use "revise" for one it narrows or contradicts.'

const withDelta = (text, delta) => delta === true
  ? text.replace('Output only the JSON object.', `${DELTA_RULE}\nOutput only the JSON object.`)
  : text

/** @param {{ entries?: number, revisions?: number, delta?: boolean }} [options] */
export function extInstruction(options = {}) {
  return withDelta(NOSIG_EXT
    .replace('{entries}', String(options.entries ?? 5))
    .replace('{revisions}', String(options.revisions ?? 3)), options.delta)
}

/** @param {string} text @param {{ entries?: number, revisions?: number, delta?: boolean }} options */
export function extQuoteInstruction(options = {}) {
  return withDelta(NOSIG_EXT_QUOTE
    .replace('{entries}', String(options.entries ?? 5))
    .replace('{revisions}', String(options.revisions ?? 3)), options.delta)
}

function asCites(value, total) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((n) => Number.isInteger(n) && n >= 1 && n <= total))]
}

function entryText(value) {
  return String(value?.text ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, 220)
}

/**
 * Verify extracted entries against the segment.
 *
 * Modes:
 * - literal (default): a cite is required, and every identifying literal in
 *   the entry must appear in at least one cited message. Prose entries without
 *   literals are accepted with cite provenance.
 * - cite: only the cite is checked.
 * - quote: the entry must carry a verbatim quote found in a cited message.
 *
 * Rejected entries are reported with a reason and never enter the ledger.
 *
 * @param {object} parsed model JSON.
 * @param {{ items: Array<{ index: number, role: string, text: string }> }} segment
 * @param {{ mode?: string, entries?: number, revisions?: number }} [options]
 * @returns {{ entries: object[], revise: object[], rejected: object[], cites: number[][],
 *   recovered: number }}
 */
export function verifyExtraction(parsed, segment, options = {}) {
  const mode = options.mode ?? 'literal'
  const entryCap = Math.max(1, options.entries ?? 5)
  const revisionCap = Math.max(1, options.revisions ?? 3)
  const total = segment.items.length
  const textAt = (cites) => cites.map((n) => segment.items[n - 1]?.text ?? '').join('\n')
  const accepted = []
  const revisions = []
  const rejected = []
  const citesUsed = []
  let recovered = 0

  // A cited number can be off by one while the literal itself is still in the
  // segment. Re-locating it keeps the entry and repairs provenance; a literal
  // that is nowhere in the segment stays rejected. Bare integers are too common
  // to locate a relation, so only an identifier, path or decimal may re-cite.
  const locate = (text) => {
    const anchors = anchorsOf(text)
    const strong = anchors.filter((anchor) => !/^\d+$/.test(anchor))
    if (strong.length === 0) return []
    return segment.items
      .filter((item) => strong.some((anchor) => item.text.includes(anchor)))
      .map((item) => item.index)
      .slice(0, 4)
  }

  const checkOne = (raw, revision) => {
    const text = entryText(raw)
    if (!text) return null
    let cites = asCites(raw?.cites, total)
    const reason = (why) => rejected.push({
      kind: revision ? 'revise' : 'entry', text, reason: why, cites,
    })
    if (mode === 'quote') {
      if (cites.length === 0) {
        reason('no-valid-cite')
        return null
      }
      const quote = String(raw?.quote ?? '').trim()
      if (quote.length < 8 || quote.length > 1200) {
        reason('quote-missing-or-length')
        return null
      }
      if (!cites.some((n) => segment.items[n - 1].text.includes(quote))) {
        reason('quote-not-found')
        return null
      }
    }
    if (mode === 'literal') {
      const anchors = anchorsOf(text)
      const cited = textAt(cites)
      if (anchors.some((anchor) => cited.includes(anchor))) {
        // Cites support the entry; keep them.
      } else if (anchors.length === 0 && cites.length > 0) {
        // Prose without literals can only be checked by its cite.
      } else {
        const located = locate(text)
        if (located.length > 0) {
          cites = located
          recovered += 1
        } else {
          reason(cites.length === 0 ? 'no-valid-cite' : 'literal-not-in-cite')
          return null
        }
      }
    }
    // Numeric and flag-level fidelity: a paraphrased entry that changes a
    // decimal or a --flag is drift, even when the prose anchor still matches.
    const tokens = [...new Set([
      ...(String(text).match(/\b\d+\.\d+\b/g) ?? []),
      ...(String(text).match(/--[a-z][a-z-]+/g) ?? []),
    ])]
    if (tokens.length > 0 && !tokens.every((token) => textAt(cites).includes(token))) {
      reason('value-not-in-cite')
      return null
    }
    citesUsed.push(cites)
    return {
      kind: String(raw?.kind ?? (revision ? 'decision' : 'fact')),
      text,
      cites,
      ...(revision ? { ref: String(raw?.ref ?? '') } : {}),
      ...(raw?.quote ? { quote: String(raw.quote).slice(0, 1200) } : {}),
    }
  }

  for (const raw of Array.isArray(parsed?.entries) ? parsed.entries.slice(0, entryCap) : []) {
    const entry = checkOne(raw, false)
    if (entry) accepted.push(entry)
  }
  for (const raw of Array.isArray(parsed?.revise) ? parsed.revise.slice(0, revisionCap) : []) {
    const entry = checkOne(raw, true)
    if (entry) revisions.push(entry)
  }
  return { entries: accepted, revise: revisions, rejected, cites: citesUsed, recovered }
}

const RETRY_WAIT_MS = [2000, 6000]
const RETRY_ENTRY_CAP = 3
const RETRY_REVISION_CAP = 1
const RETRY_MAX_TOKENS = 4096
const RETRY_WAIT_BUDGET_MS = 20000

const failureReason = (error) => {
  const text = error instanceof Error && error.message !== '' ? error.message : 'request failed'
  return text.slice(0, 240)
}

// A caller that knows the provider code can set `retryable`; otherwise an abort
// or a configuration-class status is final and everything else is transport.
const retryableFailure = (error) => {
  if (typeof error?.retryable === 'boolean') return error.retryable
  const text = failureReason(error)
  if (/abort|cancel/i.test(text)) return false
  return !/\b(?:400|401|403|404|422)\b/.test(text)
}

const retryNote = (reason) => {
  if (reason === 'no JSON object') {
    return 'The previous reply was not a JSON object. Return only the JSON object.'
  }
  if (/length|max.?tokens|truncat|cut off/i.test(reason)) {
    return 'The previous answer was cut off. Return at most 3 entries, each text at most 120 characters, and no prose.'
  }
  return 'The previous request did not finish. Return only a smaller JSON object.'
}

const instructionFor = (mode, caps, delta, note) => {
  const base = mode === 'quote'
    ? extQuoteInstruction({ entries: caps.entries, revisions: caps.revisions, delta })
    : extInstruction({ entries: caps.entries, revisions: caps.revisions, delta })
  return note === '' ? base : `${base}\n${note}`
}

const capsFor = (entryCap, revisionCap, retry) => (retry
  ? {
      entries: Math.min(entryCap, RETRY_ENTRY_CAP),
      revisions: Math.min(revisionCap, RETRY_REVISION_CAP),
      maxTokens: RETRY_MAX_TOKENS,
    }
  : { entries: entryCap, revisions: revisionCap, maxTokens: undefined })

const emptyResult = (mode) => ({
  segments: 0, accepted: 0, rejected: 0, gaps: [], mode, reasons: {},
  recovered: 0, converted: 0, attempted: 0, usable: 0, retried: 0, failed: 0, maxOrder: 0,
})

const countReasons = (result, rejected) => {
  for (const row of rejected) {
    const reason = String(row?.reason ?? 'unknown')
    result.reasons[reason] = (result.reasons[reason] ?? 0) + 1
  }
}

const extractionContext = (options) => {
  const budget = { left: options.waitBudgetMs ?? RETRY_WAIT_BUDGET_MS }
  return {
    mode: options.mode ?? 'literal',
    delta: options.delta === true,
    callModel: options.callModel,
    // Waits are spent from one per-compaction budget, so a degraded provider
    // delays the turn by seconds, not minutes. An absent wait keeps tests fast.
    pause: async (ms) => {
      if (budget.left <= 0 || typeof options.wait !== 'function') return
      const delay = Math.min(ms * (0.9 + Math.random() * 0.2), budget.left)
      budget.left -= delay
      if (delay > 0) await options.wait(delay)
    },
  }
}

async function attemptSegment(segment, journal, ctx, spec) {
  const { order, label, caps, note, result } = spec
  const numbered = numberedSegment(segment)
  const prior = renderLedger(journal.entries(), { maxBytes: 8000 })
  result.attempted += 1
  let answer
  try {
    answer = await ctx.callModel(
      numbered,
      prior === '' ? 'Current ledger: empty.' : prior,
      instructionFor(ctx.mode, caps, ctx.delta, note),
      { maxTokens: caps.maxTokens },
    )
  } catch (error) {
    return { status: 'failed', reason: failureReason(error), retryable: retryableFailure(error) }
  }
  const parsed = parseJsonObject(answer)
  if (parsed === undefined) return { status: 'failed', reason: 'no JSON object', retryable: true }
  result.usable += 1
  const verified = verifyExtraction(parsed, numbered, {
    mode: ctx.mode, entries: caps.entries, revisions: caps.revisions,
  })
  result.recovered += verified.recovered
  if (verified.entries.length === 0 && verified.revise.length === 0) {
    result.rejected += verified.rejected.length
    countReasons(result, verified.rejected)
    // An empty answer over a quiet region is not a gap; only rejections are.
    if (verified.rejected.length > 0) {
      result.gaps.push(`${label}: all ${verified.rejected.length} entries rejected`)
      return { status: 'rejected' }
    }
    return { status: 'empty' }
  }
  const applied = applyExtraction(journal.ledger, verified, {
    prefix: `n${Math.floor(order) + 1}`, order,
  })
  journal.commit(applied.added, applied.applied)
  result.maxOrder = Math.max(result.maxOrder, Math.floor(order) + 1)
  result.segments += 1
  result.accepted += applied.added.length + applied.applied.length
  result.converted += applied.converted.length
  result.rejected += applied.rejected.length
  countReasons(result, applied.rejected)
  if (applied.rejected.length > 0) {
    result.gaps.push(`${label}: ${applied.rejected.length} entries rejected`)
  }
  return { status: 'applied' }
}

// Two spaced retries with a smaller output request. The input stays the same:
// the provider reports tpm/rpm, so splitting would add requests, not reduce
// pressure; a smaller JSON answer is cheaper to finish and to parse.
async function retrySegment(segment, journal, ctx, spec) {
  const { order, label, caps, reason, result } = spec
  let last = { status: 'failed', reason, retryable: true }
  for (let step = 0; step < RETRY_WAIT_MS.length; step += 1) {
    await ctx.pause(RETRY_WAIT_MS[step])
    result.retried += 1
    last = await attemptSegment(segment, journal, ctx, {
      order, label, caps, note: retryNote(last.reason), result,
    })
    if (last.status !== 'failed' || !last.retryable) return last
  }
  return last
}

/**
 * One extraction pass over the whole region: a single request, then two spaced
 * retries with a smaller output demand when the answer is cut off, is not JSON,
 * or the transport fails. A caller can tell whether anything was usable
 * (`usable`) and how many calls were spent (`attempted`).
 *
 * @param {ReadonlyArray<object>} messages the shadowed region.
 * @param {LedgerJournal} journal current ledger.
 * @param {{ mode?: string, entries?: number, revisions?: number,
 *   wait?: (ms: number) => Promise<void>, waitBudgetMs?: number,
 *   callModel: Function }} options same call contract as {@link runExtraction}.
 */
export async function runExtractionOnce(messages, journal, options = {}) {
  const ctx = extractionContext(options)
  const entryCap = options.entries ?? 5
  const revisionCap = options.revisions ?? 3
  const result = emptyResult(ctx.mode)
  result.maxOrder = Math.floor(journal.order)
  const order = Math.floor(journal.order)
  let outcome = await attemptSegment(messages, journal, ctx, {
    order, label: 'region', caps: capsFor(entryCap, revisionCap, false), note: '', result,
  })
  if (outcome.status === 'failed' && outcome.retryable) {
    outcome = await retrySegment(messages, journal, ctx, {
      order, label: 'region', caps: capsFor(entryCap, revisionCap, true),
      reason: outcome.reason, result,
    })
  }
  if (outcome.status === 'failed') {
    result.failed = 1
    result.gaps.push(`region: ${outcome.reason}`)
  }
  journal.order = Math.max(journal.order, result.maxOrder)
  return result
}

/**
 * Run one extraction pass over ordered segments.
 *
 * Pass one attempts every segment once, so one degraded segment does not hold
 * up the rest. Pass two retries only the failed segments with a smaller output
 * demand. `usable` counts segments that returned a JSON object; the engine uses
 * `attempted > 0 && usable === 0` to decline the compaction instead of
 * publishing a checkpoint with an empty ledger.
 *
 * @param {Array<Array<object>>} segments
 * @param {LedgerJournal} journal
 * @param {{ mode?: string, entries?: number, revisions?: number,
 *   wait?: (ms: number) => Promise<void>, waitBudgetMs?: number,
 *   callModel: (transcript: { text: string, items: object[] }, prior: string,
 *     instruction: string, budget?: { maxTokens?: number }) => Promise<string> }} options
 * @returns {Promise<{ segments: number, accepted: number, rejected: number,
 *   gaps: string[], mode: string, attempted: number, usable: number,
 *   retried: number, failed: number }>}
 */
export async function runExtraction(segments, journal, options = {}) {
  const ctx = extractionContext(options)
  const entryCap = options.entries ?? 5
  const revisionCap = options.revisions ?? 3
  const result = emptyResult(ctx.mode)
  const baseOrder = Math.floor(journal.order)
  result.maxOrder = baseOrder
  const fullCaps = capsFor(entryCap, revisionCap, false)
  const retryCaps = capsFor(entryCap, revisionCap, true)
  // One order slot per segment keeps chronology stable when a later pass fills
  // an earlier failed slot. A failed slot that stays empty is simply skipped.
  const states = segments.map((messages, index) => ({
    messages, order: baseOrder + index, label: `segment ${index + 1}`, outcome: null,
  }))
  const retry = []
  for (const state of states) {
    state.outcome = await attemptSegment(state.messages, journal, ctx, {
      order: state.order, label: state.label, caps: fullCaps, note: '', result,
    })
    if (state.outcome.status === 'failed' && state.outcome.retryable) retry.push(state)
  }
  for (const state of retry) {
    state.outcome = await retrySegment(state.messages, journal, ctx, {
      order: state.order, label: state.label, caps: retryCaps,
      reason: state.outcome.reason, result,
    })
  }
  for (const state of states) {
    if (state.outcome.status !== 'failed') continue
    result.failed += 1
    result.gaps.push(`${state.label}: ${state.outcome.reason}`)
  }
  journal.order = Math.max(journal.order, result.maxOrder)
  return result
}

/** Current active entries, ordered by creation. @param {Map<string, object>} ledger */
export function activeEntries(ledger) {
  return [...ledger.values()]
    .filter((entry) => entry.status === 'active')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

/**
 * Apply verified entries and revisions to a ledger.
 *
 * A revision resolves only a current ref. A stale ref is rejected: rewriting an
 * older relation would resurrect content the session already moved past. A ref
 * that names no entry is converted to an addition when its text is new, so a
 * verified relation is not lost merely because the model mistyped the ref.
 *
 * @param {Map<string, object>} ledger
 * @param {{ entries: object[], revise: object[], rejected: object[] }} verified
 * @param {{ prefix: string, order: number, seq?: number }} context
 * @returns {{ added: object[], applied: object[], converted: object[], rejected: object[] }}
 */
export function applyExtraction(ledger, verified, context) {
  const added = []
  const applied = []
  const converted = []
  const rejected = [...verified.rejected]
  let position = 0
  for (const entry of verified.entries) {
    const id = `${context.prefix}-${position + 1}`
    const record = {
      id, rev: 1, kind: entry.kind, text: entry.text, cites: entry.cites,
      status: 'active', order: context.order + position / 100,
      segment: context.prefix, ...(context.seq === undefined ? {} : { seq: context.seq }),
    }
    ledger.set(id, record)
    added.push(record)
    position += 1
  }
  const activeText = (text) => [...ledger.values()].some((item) =>
    item.status === 'active' && String(item.text ?? '').trim() === text)
  for (const revision of verified.revise) {
    const match = /^(.+)@(\d+)$/.exec(revision.ref ?? '')
    const old = match ? ledger.get(match[1]) : undefined
    const current = old && old.status === 'active' && old.rev === Number(match[2])
    if (!current) {
      if (old !== undefined) {
        rejected.push({ kind: 'revise', text: revision.text, reason: 'stale-ref', cites: revision.cites })
        continue
      }
      if (activeText(revision.text.trim())) continue
      const record = {
        id: `${context.prefix}-r${position + 1}`, rev: 1,
        kind: revision.kind || 'fact', text: revision.text, cites: revision.cites,
        status: 'active', order: context.order + 0.75 + position / 100,
        segment: context.prefix, ...(context.seq === undefined ? {} : { seq: context.seq }),
      }
      ledger.set(record.id, record)
      added.push(record)
      converted.push(record)
      position += 1
      continue
    }
    const record = {
      id: old.id, rev: old.rev + 1, kind: revision.kind || old.kind, text: revision.text,
      cites: revision.cites, status: 'active', order: context.order + 0.5 + position / 100,
      segment: context.prefix, ...(context.seq === undefined ? {} : { seq: context.seq }),
    }
    old.status = 'superseded'
    ledger.set(record.id, record)
    applied.push(record)
    position += 1
  }
  return { added, applied, converted, rejected }
}

/**
 * Append-only journal for one session.
 *
 * Every accepted addition/revision is one JSON line; a restart replays the
 * lines into the same active set. A rejected entry never reaches the journal.
 */
export class LedgerJournal {
  constructor(file) {
    this.file = file
    this.ledger = new Map()
    this.order = 0
    this.controls = []
    this.controlSeqs = new Map()
    this.values = []
    this.receipts = []
    this.receiptEdits = new Set()
    this.checks = []
  }

  load() {
    if (!this.file || !existsSync(this.file)) return this
    for (const line of readFileSync(this.file, 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (row.op === 'add' && row.entry) {
        this.ledger.set(row.entry.id, { ...row.entry, status: 'active' })
        this.order = Math.max(this.order, Math.floor(Number(row.entry.order ?? 0)) + 1)
      } else if (row.op === 'revise' && row.entry) {
        const old = this.ledger.get(row.entry.id)
        if (old) old.status = 'superseded'
        this.ledger.set(row.entry.id, { ...row.entry, status: 'active' })
        this.order = Math.max(this.order, Math.floor(Number(row.entry.order ?? 0)) + 1)
      } else if (row.op === 'supersede' && row.ref) {
        const old = this.ledger.get(row.ref)
        if (old) old.status = 'invalidated'
      } else if (row.op === 'control' && typeof row.text === 'string' && row.text !== '') {
        // Control text accumulates across compactions; the reference keeps it
        // in memory, a restarted engine reads it back from here.
        if (!this.controls.includes(row.text)) this.controls.push(row.text)
        if (Number.isInteger(row.seq) && !this.controlSeqs.has(row.text)) {
          this.controlSeqs.set(row.text, row.seq)
        }
      } else if (row.op === 'receipt' && row.receipt && Number.isInteger(row.receipt.edit)) {
        const receipt = row.receipt
        if (!this.receiptEdits.has(receipt.edit)) {
          this.receiptEdits.add(receipt.edit)
          this.receipts.push(receipt)
          if (Number.isInteger(receipt.check) && !this.checks.includes(receipt.check)) {
            this.checks.push(receipt.check)
          }
        }
      } else if (row.op === 'value' && row.value && typeof row.value.text === 'string') {
        // The value ledger spans every shadowed region, as the reference's
        // events_all does; keys are assigned once, at first discovery.
        const identity = row.value.identity ?? row.value.text
        const existing = this.values.find((item) => (item.identity ?? item.text) === identity)
        if (existing !== undefined) {
          Object.assign(existing, row.value, { key: existing.key ?? row.value.key })
        } else {
          this.values.push({ ...row.value, key: row.value.key ?? `V${this.values.length + 1}` })
        }
      }
    }
    return this
  }

  append(row) {
    if (!this.file) return this
    mkdirSync(dirname(this.file), { recursive: true })
    appendFileSync(this.file, `${JSON.stringify(row)}\n`, 'utf8')
    return this
  }

  commit(added, applied) {
    for (const entry of added) this.append({ op: 'add', entry })
    for (const entry of applied) this.append({ op: 'revise', entry })
    return this
  }

  /**
   * Persist the edit/check evidence of one region so a command from an older
   * region can still be proven complete without a model call.
   */
  addReceipts(rows) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Number.isInteger(row?.edit) || typeof row.path !== 'string' || row.path === '') continue
      if (this.receiptEdits.has(row.edit)) continue
      const receipt = {
        path: row.path,
        edit: row.edit,
        check: Number.isInteger(row.check) ? row.check : null,
        terms: Array.isArray(row.terms) ? row.terms.slice(0, 12) : [],
      }
      this.receiptEdits.add(receipt.edit)
      this.receipts.push(receipt)
      if (Number.isInteger(receipt.check) && !this.checks.includes(receipt.check)) {
        this.checks.push(receipt.check)
      }
      this.append({ op: 'receipt', receipt })
    }
    return this
  }

  addControl(text, seq) {
    const value = String(text ?? '').trim()
    if (value === '') return this
    if (this.controls.includes(value)) {
      if (Number.isInteger(seq) && !this.controlSeqs.has(value)) {
        this.controlSeqs.set(value, seq)
        this.append({ op: 'control', text: value, seq })
      }
      return this
    }
    this.controls.push(value)
    if (Number.isInteger(seq)) this.controlSeqs.set(value, seq)
    this.append({ op: 'control', text: value, ...(Number.isInteger(seq) ? { seq } : {}) })
    return this
  }

  /**
   * Absorb the value rows of one region, assigning a global key at first sight.
   *
   * @param {Array<object>} rows rows from `regionValueRows` (no key).
   * @returns {LedgerJournal}
   */
  addValues(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return this
    const nextKey = () => {
      const used = this.values.map((row) => Number(/^V(\d+)$/.exec(row.key ?? '')?.[1] ?? 0))
      return `V${Math.max(0, ...used) + 1}`
    }
    for (const row of rows) {
      const identity = row.identity ?? row.text
      const existing = this.values.find((item) => (item.identity ?? item.text) === identity)
      if (existing !== undefined) {
        // A re-read of the same constant updates the value but keeps its key;
        // otherwise a changed default would appear as a second, conflicting row.
        if (existing.text === row.text && existing.seq === row.seq) continue
        Object.assign(existing, row)
        this.append({ op: 'value', value: existing })
        continue
      }
      const value = { key: nextKey(), ...row }
      this.values.push(value)
      this.append({ op: 'value', value })
    }
    return this
  }

  entries() {
    return activeEntries(this.ledger)
  }
}

/**
 * Render the ledger as one bounded section. Newest entries survive trimming;
 * the cut is disclosed so a later reader knows entries were omitted.
 *
 * @param {object[]} entries
 * @param {{ maxBytes?: number }} [options]
 * @returns {string}
 */
export function renderLedger(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const maxBytes = Math.max(400, options.maxBytes ?? 24000)
  const header = '## Ledger (model-extracted; cite-checked)'
  const line = (entry) => {
    const refs = entry.cites.map((n) => `${entry.segment ?? 'segment'}:m${n}`).join(',')
    return `- [${entry.kind}] ${entry.text} (${entry.id}@${entry.rev}; ${refs})`
  }
  const rows = []
  const seen = new Set()
  let dropped = 0
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    // A retried or overlapping extraction can re-state the same fact; the
    // newest copy is enough, and hiding older copies keeps the budget for
    // facts that only appear once.
    const key = String(entry.text ?? '').trim().toLowerCase()
    if (key !== '' && seen.has(key)) {
      dropped += 1
      continue
    }
    const candidate = line(entry)
    if (byteLength([header, candidate, ...rows].join('\n')) > maxBytes) {
      dropped += 1
      continue
    }
    seen.add(key)
    rows.unshift(candidate)
  }
  if (rows.length === 0) return ''
  const note = dropped > 0 ? `\n(${dropped} older ledger entries omitted for budget.)` : ''
  return [header, ...rows].join('\n') + note
}

/**
 * Read the first JSON object from a model answer, tolerating a fenced block.
 *
 * @param {string} text
 * @returns {object|undefined}
 */
export function parseJsonObject(text) {
  const source = String(text ?? '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    const parsed = JSON.parse(source.slice(start, end + 1))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** @param {string} text @param {number} limit */
export function clipLedgerText(text, limit) {
  return clipBytes(text, limit)
}
