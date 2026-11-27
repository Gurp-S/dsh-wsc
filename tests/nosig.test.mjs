import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  LedgerJournal, activeEntries, anchorsOf, applyExtraction,
  extInstruction, numberedSegment, renderLedger, segmentMessages, verifyExtraction,
} from '../lib/nosig.js'

const message = (role, text) => ({ role, content: [{ type: 'text', text }] })

test('nosig: anchors keep identifiers, paths and exact numbers', () => {
  const anchors = anchorsOf('append REL-9482 to docs/relnotes.md')
  assert.ok(anchors.includes('docs/relnotes.md'))
  assert.ok(anchors.includes('REL-9482'))
  assert.ok(anchorsOf('FEATURE_X = "FEATURE_X"').includes('FEATURE_X'))
  assert.deepEqual(anchorsOf('use async now'), [])
})

test('nosig: segments split at message boundaries and keep an oversized message whole', () => {
  const messages = [message('user', 'a'.repeat(600)), message('user', 'b'.repeat(600)), message('user', 'c'.repeat(4000))]
  const segments = segmentMessages(messages, { maxBytes: 1024 })
  assert.equal(segments.length, 3)
  assert.equal(segments[2].length, 1)
  assert.equal(segments.flat().length, 3)
})

test('nosig: transcript numbers each message and labels tool results', () => {
  const tool = { role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] }] }
  const { text, items } = numberedSegment([message('user', 'rename it'), tool])
  assert.match(text, /\[m1 user\] rename it/)
  assert.match(text, /\[m2 tool\] ok/)
  assert.equal(items[1].role, 'tool')
})

test('nosig: a changed decimal or flag is rejected even when an anchor matches', () => {
  const segment = numberedSegment([message('user', 'RATE 0.07 in docs/tax.md; use --dry-run only')])
  const parsed = {
    entries: [
      { kind: 'fact', text: 'docs/tax.md sets RATE 0.2', cites: [1] },
      { kind: 'fact', text: 'docs/tax.md uses --dry-run with RATE 0.2', cites: [1] },
      { kind: 'fact', text: 'docs/tax.md sets RATE 0.07', cites: [1] },
    ],
  }
  const verified = verifyExtraction(parsed, segment, { mode: 'literal' })
  assert.equal(verified.entries.length, 1)
  assert.equal(verified.entries[0].text, 'docs/tax.md sets RATE 0.07')
  assert.deepEqual(verified.rejected.map((row) => row.reason), ['value-not-in-cite', 'value-not-in-cite'])
})

test('nosig: a misplaced cite is re-located when the literal is in the region', () => {
  const segment = numberedSegment([message('user', 'rename to FEATURE_X'), message('user', 'unrelated note')])
  const parsed = {
    entries: [
      { kind: 'decision', text: 'decision: rename to FEATURE_X', cites: [1] },
      { kind: 'decision', text: 'decision: rename to FEATURE_X', cites: [2] },
      { kind: 'fact', text: 'the build is green', cites: [2] },
      { kind: 'fact', text: 'uncited value REL-1', cites: [] },
    ],
  }
  const verified = verifyExtraction(parsed, segment, { mode: 'literal' })
  assert.equal(verified.entries.length, 3)
  assert.deepEqual(verified.entries[1].cites, [1])
  assert.equal(verified.recovered, 1)
  assert.deepEqual(verified.rejected.map((row) => row.reason), ['no-valid-cite'])
})

test('nosig: a literal nowhere in the region stays rejected, and bare numbers cannot re-cite', () => {
  const segment = numberedSegment([message('user', 'count is 20'), message('user', 'note')])
  const parsed = {
    entries: [
      { kind: 'fact', text: 'wrote XQ-9999 at 888888', cites: [1] },
      { kind: 'fact', text: 'limit = 20', cites: [2] },
    ],
  }
  const verified = verifyExtraction(parsed, segment, { mode: 'literal' })
  assert.equal(verified.entries.length, 0)
  assert.equal(verified.recovered, 0)
  assert.deepEqual(verified.rejected.map((row) => row.reason).sort(),
    ['literal-not-in-cite', 'literal-not-in-cite'])
})

test('nosig: cite mode accepts provenance without an anchor match', () => {
  const segment = numberedSegment([message('user', 'rename to FEATURE_X'), message('user', 'note')])
  const parsed = { entries: [{ kind: 'decision', text: 'decision: rename to FEATURE_X', cites: [2] }] }
  const verified = verifyExtraction(parsed, segment, { mode: 'cite' })
  assert.equal(verified.entries.length, 1)
})

test('nosig: quote mode requires the exact supporting text', () => {
  const segment = numberedSegment([message('user', 'rename to FEATURE_X in src/flags.py')])
  const good = { entries: [{ kind: 'decision', text: 'rename to FEATURE_X', cites: [1], quote: 'FEATURE_X' }] }
  const bad = { entries: [{ kind: 'decision', text: 'rename to FEATURE_X', cites: [1], quote: 'FEATURE_Y' }] }
  assert.equal(verifyExtraction(good, segment, { mode: 'quote' }).entries.length, 1)
  assert.equal(verifyExtraction(bad, segment, { mode: 'quote' }).entries.length, 0)
})

test('nosig: a revision supersedes the current ref and an unknown ref is rejected', () => {
  const ledger = new Map()
  const first = verifyExtraction(
    { entries: [{ kind: 'fact', text: 'flag is FEATURE_OLD', cites: [1] }] },
    numberedSegment([message('user', 'flag is FEATURE_OLD')]),
    {},
  )
  applyExtraction(ledger, first, { prefix: 's1', order: 0 })
  const id = activeEntries(ledger)[0].id
  const second = verifyExtraction(
    { revise: [{ ref: `${id}@1`, kind: 'fact', text: 'flag is FEATURE_X', cites: [1] }] },
    numberedSegment([message('user', 'flag is FEATURE_X')]),
    {},
  )
  const applied = applyExtraction(ledger, second, { prefix: 's2', order: 1 })
  assert.equal(applied.applied.length, 1)
  assert.equal(activeEntries(ledger).length, 1)
  assert.equal(activeEntries(ledger)[0].text, 'flag is FEATURE_X')
  const stale = verifyExtraction(
    { revise: [{ ref: `${id}@1`, text: 'flag is FEATURE_Y', cites: [1] }] },
    numberedSegment([message('user', 'flag is FEATURE_Y')]),
    {},
  )
  assert.equal(applyExtraction(ledger, stale, { prefix: 's3', order: 2 }).rejected[0].reason, 'stale-ref')
})

test('nosig: a revision with an unknown ref becomes an addition, not a loss', () => {
  const ledger = new Map()
  const verified = verifyExtraction(
    { revise: [{ ref: 'n99-9@1', kind: 'fact', text: 'default limit is 20', cites: [1] }] },
    numberedSegment([message('user', 'default limit is 20')]),
    {},
  )
  const applied = applyExtraction(ledger, verified, { prefix: 's1', order: 0 })
  assert.equal(applied.rejected.length, 0)
  assert.equal(applied.converted.length, 1)
  assert.equal(activeEntries(ledger).length, 1)
  assert.equal(activeEntries(ledger)[0].text, 'default limit is 20')
  const duplicate = applyExtraction(ledger, verified, { prefix: 's2', order: 1 })
  assert.equal(duplicate.added.length, 0)
  assert.equal(activeEntries(ledger).length, 1)
})

test('nosig: the journal replays active entries after a restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const ledger = new Map()
    const segment = numberedSegment([message('user', 'append REL-9482 to docs/relnotes.md')])
    const verified = verifyExtraction(
      { entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }] },
      segment,
      {},
    )
    const result = applyExtraction(ledger, verified, { prefix: 's1', order: 0 })
    new LedgerJournal(file).commit(result.added, result.applied)
    const reopened = new LedgerJournal(file).load()
    assert.equal(reopened.entries().length, 1)
    assert.equal(reopened.entries()[0].text, 'append REL-9482 to docs/relnotes.md')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: rendering keeps the newest entries and discloses the cut', () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    id: `s1-${index + 1}`, rev: 1, kind: 'fact', text: `fact ${index} ${'x'.repeat(80)}`,
    cites: [1], status: 'active', order: index,
  }))
  const text = renderLedger(entries, { maxBytes: 600 })
  assert.match(text, /older ledger entries omitted/)
  assert.match(text, /fact 19/)
})

test('nosig: rendering hides older copies of a re-extracted fact', () => {
  const entries = [
    { id: 's1-1', rev: 1, kind: 'fact', text: 'TAX_RATE = 0.07', cites: [1], status: 'active', order: 0 },
    { id: 's2-1', rev: 1, kind: 'fact', text: 'tax_cents = 70', cites: [2], status: 'active', order: 1 },
    { id: 's3-1', rev: 1, kind: 'fact', text: 'TAX_RATE = 0.07', cites: [3], status: 'active', order: 2 },
  ]
  const text = renderLedger(entries, { maxBytes: 4000 })
  assert.equal(text.split('TAX_RATE = 0.07').length - 1, 1)
  assert.match(text, /s3-1@1/)
})

test('nosig: a replayed journal resumes at an integer segment order', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const journal = new LedgerJournal(file)
    journal.commit([{
      id: 's1-1', rev: 1, kind: 'fact', text: 'limit 20', cites: [1],
      status: 'active', order: 2.04, segment: 's2',
    }], [])
    const reopened = new LedgerJournal(file).load()
    assert.equal(reopened.order, 3)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: control text accumulates across a reopened journal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const journal = new LedgerJournal(file)
    journal.addControl('Read the sources.').addControl('Add formatCents.')
    journal.addControl('Read the sources.')
    const reopened = new LedgerJournal(file).load()
    assert.deepEqual(reopened.controls, ['Read the sources.', 'Add formatCents.'])
    // A journal line that is not an entry must not appear as one.
    assert.equal(reopened.entries().length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: values keep one key across a reopened journal', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const journal = new LedgerJournal(file)
    journal.addValues([{ seq: 2, message: 2, label: 'src/store.js: TAX_RATE = 0.07', terms: ['TAX_RATE'], text: 'TAX_RATE = 0.07' }])
    journal.addValues([{ seq: 9, message: 4, label: 'src/report.js: limit = 20', terms: ['limit'], text: 'limit = 20' }])
    journal.addValues([{ seq: 10, message: 5, label: 'again', terms: [], text: 'TAX_RATE = 0.07' }])
    const reopened = new LedgerJournal(file).load()
    assert.deepEqual(reopened.values.map((row) => row.key), ['V1', 'V2'])
    assert.equal(reopened.values[0].text, 'TAX_RATE = 0.07')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: a re-read constant keeps its key but takes the new value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const journal = new LedgerJournal(file)
    journal.addValues([{ seq: 2, message: 2, identity: 'src/store.js#TAX_RATE', label: 'src/store.js: TAX_RATE = 0.07', terms: ['TAX_RATE'], text: 'TAX_RATE = 0.07' }])
    journal.addValues([{ seq: 9, message: 4, identity: 'src/store.js#TAX_RATE', label: 'src/store.js: TAX_RATE = 0.08', terms: ['TAX_RATE'], text: 'TAX_RATE = 0.08' }])
    const reopened = new LedgerJournal(file).load()
    assert.equal(reopened.values.length, 1)
    assert.equal(reopened.values[0].key, 'V1')
    assert.equal(reopened.values[0].text, 'TAX_RATE = 0.08')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: receipts persist by edit seq and keep the later check', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    const journal = new LedgerJournal(file)
    journal.addReceipts([
      { path: 'src/format.js', edit: 17, check: 23, terms: ['formatCents'] },
      { path: 'src/format.js', edit: 17, check: 23, terms: ['formatCents'] },
      { path: 'src/store.js', edit: 28, check: null, terms: ['TAX_RATE'] },
    ])
    const reopened = new LedgerJournal(file).load()
    assert.deepEqual(reopened.receipts.map((row) => row.edit), [17, 28])
    assert.deepEqual(reopened.receipts[0].terms, ['formatCents'])
    assert.deepEqual(reopened.checks, [23])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: an unreadable journal degrades to an empty ledger instead of throwing', () => {
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const file = join(directory, 'session.jsonl')
    // A directory where the journal file should be: exists, cannot be read.
    mkdirSync(file)
    const journal = new LedgerJournal(file).load()
    assert.equal(journal.storage.readFailed, true)
    assert.notEqual(journal.storage.error, '')
    assert.equal(journal.entries().length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: an unwritable journal keeps extraction results in memory', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const directory = mkdtempSync(join(tmpdir(), 'wsc-nosig-'))
  try {
    const blocker = join(directory, 'blocker')
    writeFileSync(blocker, 'x')
    const journal = new LedgerJournal(join(blocker, 'session.jsonl'))
    const result = await runExtractionOnce(
      [message('user', 'append REL-9482 to docs/relnotes.md')],
      journal,
      {
        mode: 'literal',
        callModel: async () => JSON.stringify({
          entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }],
        }),
      },
    )
    assert.equal(result.accepted, 1)
    assert.equal(journal.storage.writeFailed, true)
    assert.notEqual(journal.storage.error, '')
    assert.equal(journal.entries().length, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('nosig: the instruction carries the configured caps', () => {
  assert.match(extInstruction({ entries: 7, revisions: 2 }), /At most 7 entries and 2 revisions/)
})

test('nosig: delta extraction forbids restating the current ledger', () => {
  const base = extInstruction({ entries: 5, revisions: 3 })
  assert.doesNotMatch(base, /Do not restate an unchanged relation/)
  assert.match(extInstruction({ entries: 5, revisions: 3, delta: true }), /Do not restate an unchanged relation/)
})

test('nosig: one request extracts the whole region and retries a non-JSON reply', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const messages = [
    message('user', 'append REL-9482 to docs/relnotes.md'),
    message('assistant', 'done'),
  ]
  const calls = []
  const result = await runExtractionOnce(messages, journal, {
    mode: 'literal',
    callModel: async (numbered, prior) => {
      calls.push(prior)
      if (calls.length === 1) return 'sorry, here are the notes'
      return JSON.stringify({
        entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }],
      })
    },
  })
  assert.equal(calls.length, 2)
  assert.equal(result.segments, 1)
  assert.equal(result.accepted, 1)
  assert.equal(journal.entries().length, 1)
})

test('nosig: a rejected entry reports why', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const result = await runExtractionOnce(
    [message('user', 'appended REL-9482 to docs/relnotes.md')],
    journal,
    {
      mode: 'literal',
      callModel: async () => JSON.stringify({
        entries: [{ kind: 'fact', text: 'wrote XQ-9999 at 888888', cites: [1] }],
      }),
    },
  )
  assert.equal(result.accepted, 0)
  assert.equal(result.reasons['literal-not-in-cite'], 1)
})

test('nosig: repeated non-JSON replies become a gap, not a journal write', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const result = await runExtractionOnce([message('user', 'note')], journal, {
    callModel: async () => 'still not json',
  })
  assert.equal(result.segments, 0)
  assert.equal(result.accepted, 0)
  assert.match(result.gaps[0], /no JSON object/)
  assert.equal(journal.entries().length, 0)
})

test('nosig: a transport failure is retried, and a truncated answer asks for less', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const messages = [message('user', 'appended REL-9482 to docs/relnotes.md')]
  const prompts = []
  const result = await runExtractionOnce(messages, new LedgerJournal(null), {
    mode: 'literal',
    callModel: async (numbered, prior, instruction) => {
      prompts.push(instruction)
      if (prompts.length === 1) throw new Error('wsc nosig extraction did not finish (max-tokens)')
      return JSON.stringify({
        entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }],
      })
    },
  })
  assert.equal(prompts.length, 2)
  assert.match(prompts[1], /cut off/)
  assert.equal(result.segments, 1)
  assert.equal(result.gaps.length, 0)

  const fatal = await runExtractionOnce(messages, new LedgerJournal(null), {
    callModel: async () => { throw new Error('wsc nosig request failed') },
  })
  assert.equal(fatal.segments, 0)
  assert.match(fatal.gaps[0], /request failed/)
})

test('nosig: an empty but well-formed answer is not an extraction gap', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const result = await runExtractionOnce([message('user', 'thanks')], new LedgerJournal(null), {
    mode: 'literal',
    callModel: async () => JSON.stringify({ entries: [], revise: [] }),
  })
  assert.equal(result.gaps.length, 0)
  assert.equal(result.rejected, 0)
})

test('nosig: extraction pass persists accepted entries and reports gaps', async () => {
  const { runExtraction } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const messages = [message('user', 'append REL-9482 to docs/relnotes.md')]
  const segments = [messages, [message('user', 'unrelated note')]]
  const answers = [
    JSON.stringify({ entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }] }),
    'not json',
  ]
  const calls = []
  const result = await runExtraction(segments, journal, {
    mode: 'literal',
    wait: async () => {},
    callModel: async (numbered) => {
      calls.push(numbered.text)
      return answers[calls.length - 1]
    },
  })
  assert.equal(calls.length, 5)
  assert.equal(result.segments, 1)
  assert.equal(result.accepted, 1)
  assert.equal(result.gaps.length, 1)
  assert.equal(journal.entries().length, 1)
  assert.match(journal.entries()[0].text, /REL-9482/)
})

test('nosig: a rejected segment is disclosed, not written to the journal', async () => {
  const { runExtraction } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const result = await runExtraction([[message('user', 'note')]], journal, {
    mode: 'literal',
    callModel: async () => JSON.stringify({
      entries: [{ kind: 'fact', text: 'value is REL-1', cites: [1] }],
    }),
  })
  assert.equal(result.accepted, 0)
  assert.equal(result.rejected, 1)
  assert.equal(journal.entries().length, 0)
  assert.match(result.gaps[0], /all \d+ entries rejected/)
})

test('nosig: a rate-limited request is retried with a smaller output budget', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const prompts = []
  const budgets = []
  const waits = []
  const result = await runExtractionOnce([message('user', 'append REL-9482 to docs/relnotes.md')], journal, {
    mode: 'literal',
    wait: async (ms) => { waits.push(ms) },
    callModel: async (numbered, prior, instruction, budget) => {
      prompts.push(instruction)
      budgets.push(budget?.maxTokens)
      if (prompts.length === 1) {
        const error = new Error('wsc nosig extraction did not finish (error: 429 rate limited)')
        error.retryable = true
        throw error
      }
      return JSON.stringify({
        entries: [{ kind: 'decision', text: 'append REL-9482 to docs/relnotes.md', cites: [1] }],
      })
    },
  })
  assert.equal(prompts.length, 2)
  assert.equal(budgets[0], undefined)
  assert.equal(budgets[1], 4096)
  assert.match(prompts[1], /At most 3 entries and 1 revisions/)
  assert.equal(waits.length, 1)
  assert.ok(waits[0] >= 1800 && waits[0] <= 2200)
  assert.equal(result.usable, 1)
  assert.equal(result.retried, 1)
  assert.equal(result.gaps.length, 0)
  assert.equal(result.accepted, 1)
})

test('nosig: a segment is retried three times before it becomes a gap', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const calls = []
  const waits = []
  const result = await runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
    wait: async (ms) => { waits.push(ms) },
    callModel: async () => {
      calls.push(1)
      const error = new Error('429 rate limited')
      error.retryable = true
      throw error
    },
  })
  assert.equal(calls.length, 4)
  assert.equal(waits.length, 3)
  assert.ok(waits[0] >= 1800 && waits[0] <= 2200)
  assert.ok(waits[1] >= 5400 && waits[1] <= 6600)
  assert.ok(waits[2] >= 9000 && waits[2] <= 11000)
  assert.equal(result.attempted, 4)
  assert.equal(result.failed, 1)
})

test('nosig: a failed segment is retried in place before the later segments run', async () => {
  const { runExtraction } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const segments = [
    [message('user', 'append AAA-1111 to docs/a.md')],
    [message('user', 'append BBB-2222 to docs/b.md')],
    [message('user', 'append CCC-3333 to docs/c.md')],
  ]
  const calls = []
  const result = await runExtraction(segments, journal, {
    mode: 'literal',
    wait: async () => {},
    callModel: async (numbered) => {
      calls.push(numbered.text)
      const failedBefore = calls.filter((row) => row.includes('BBB-2222')).length
      if (numbered.text.includes('BBB-2222') && failedBefore === 1) {
        const error = new Error('wsc nosig extraction did not finish (error: 429 rate limited)')
        error.retryable = true
        throw error
      }
      const anchor = ['AAA-1111', 'BBB-2222', 'CCC-3333'].find((value) => numbered.text.includes(value))
      const path = { 'AAA-1111': 'docs/a.md', 'BBB-2222': 'docs/b.md', 'CCC-3333': 'docs/c.md' }[anchor]
      return JSON.stringify({
        entries: [{ kind: 'decision', text: `append ${anchor} to ${path}`, cites: [1] }],
      })
    },
  })
  assert.equal(calls.length, 4)
  assert.ok(calls[2].includes('BBB-2222'), 'the retry runs before the next segment')
  assert.ok(calls[3].includes('CCC-3333'), 'the pass continues after the retry')
  assert.equal(result.retried, 1)
  assert.equal(result.gaps.length, 0)
  assert.equal(result.accepted, 3)
  assert.deepEqual(
    activeEntries(journal.ledger).map((entry) => entry.text.match(/[ABC]{3}-\d{4}/)[0]),
    ['AAA-1111', 'BBB-2222', 'CCC-3333'],
  )
  assert.deepEqual(journal.entries().map((entry) => entry.segment).sort(), ['n1', 'n2', 'n3'])
})

test('nosig: per-segment progress is reported for the UI status line', async () => {
  const { runExtraction, runExtractionOnce } = await import('../lib/nosig.js')
  const segments = [
    [message('user', 'append AAA-1111 to docs/a.md')],
    [message('user', 'append BBB-2222 to docs/b.md')],
  ]
  const progress = []
  const result = await runExtraction(segments, new LedgerJournal(null), {
    mode: 'literal',
    wait: async () => {},
    onProgress: (event) => progress.push({ done: event.done, total: event.total }),
    callModel: async (numbered) => {
      const anchor = numbered.text.includes('AAA-1111') ? 'AAA-1111' : 'BBB-2222'
      const path = anchor === 'AAA-1111' ? 'docs/a.md' : 'docs/b.md'
      return JSON.stringify({
        entries: [{ kind: 'decision', text: `append ${anchor} to ${path}`, cites: [1] }],
      })
    },
  })
  assert.equal(result.accepted, 2)
  assert.deepEqual(progress, [{ done: 1, total: 2 }, { done: 2, total: 2 }])

  const single = []
  await runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
    onProgress: (event) => single.push({ done: event.done, total: event.total }),
    callModel: async () => JSON.stringify({ entries: [], revise: [] }),
  })
  assert.deepEqual(single, [{ done: 1, total: 1 }])
})

test('nosig: no usable segment is reported for the engine to decline', async () => {
  const { runExtraction } = await import('../lib/nosig.js')
  const journal = new LedgerJournal(null)
  const result = await runExtraction([[message('user', 'a')], [message('user', 'b')]], journal, {
    wait: async () => {},
    callModel: async () => {
      const error = new Error('429 rate limited')
      error.retryable = true
      throw error
    },
  })
  assert.equal(result.attempted, 8)
  assert.equal(result.usable, 0)
  assert.equal(result.failed, 2)
  assert.equal(result.gaps.length, 2)
  assert.equal(journal.entries().length, 0)
})

test('nosig: a context-length failure is permanent, not retried', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const calls = []
  const waits = []
  const result = await runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
    wait: async (ms) => { waits.push(ms) },
    callModel: async () => {
      calls.push(1)
      throw new Error('maximum context length is 128000 tokens; request had 131072')
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(waits.length, 0)
  assert.equal(result.usable, 0)
  assert.equal(result.failed, 1)
  assert.match(result.gaps[0], /context length/)
})

test('nosig: an exhausted quota is permanent, not retried', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const calls = []
  const result = await runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
    wait: async () => { throw new Error('should not wait') },
    callModel: async () => {
      calls.push(1)
      throw new Error('insufficient quota: account balance exhausted')
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(result.retried, 0)
  assert.equal(result.failed, 1)
})

test('nosig: a content-filter failure is permanent, not retried', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const calls = []
  const result = await runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
    wait: async () => { throw new Error('should not wait') },
    callModel: async () => {
      calls.push(1)
      throw new Error('content_filter rejected this request')
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(result.retried, 0)
  assert.equal(result.failed, 1)
})

test('nosig: an aborted request fails the whole extraction, not a segment', async () => {
  const { runExtractionOnce } = await import('../lib/nosig.js')
  const calls = []
  await assert.rejects(
    runExtractionOnce([message('user', 'note')], new LedgerJournal(null), {
      wait: async () => { throw new Error('should not wait') },
      callModel: async () => {
        calls.push(1)
        const error = new Error('wsc nosig request aborted')
        error.code = 'ABORTED'
        error.retryable = false
        throw error
      },
    }),
    (error) => error.code === 'ABORTED' && /cancelled/.test(error.message),
  )
  assert.equal(calls.length, 1)
})

test('nosig: cancellation stops the remaining segments and the retry pass', async () => {
  const { runExtraction } = await import('../lib/nosig.js')
  const calls = []
  await assert.rejects(
    runExtraction(
      [
        [message('user', 'append AAA-1111 to docs/a.md')],
        [message('user', 'append BBB-2222 to docs/b.md')],
        [message('user', 'append CCC-3333 to docs/c.md')],
      ],
      new LedgerJournal(null),
      {
        mode: 'literal',
        wait: async () => {},
        callModel: async (numbered) => {
          calls.push(numbered.text)
          if (numbered.text.includes('BBB-2222')) {
            const error = new Error('Request was aborted')
            error.code = 'ABORTED'
            throw error
          }
          const anchor = ['AAA-1111', 'CCC-3333'].find((value) => numbered.text.includes(value))
          const path = { 'AAA-1111': 'docs/a.md', 'CCC-3333': 'docs/c.md' }[anchor]
          return JSON.stringify({
            entries: [{ kind: 'decision', text: `append ${anchor} to ${path}`, cites: [1] }],
          })
        },
      },
    ),
    (error) => error.code === 'ABORTED',
  )
  assert.equal(calls.length, 2, 'the third segment is never requested after cancellation')
})
