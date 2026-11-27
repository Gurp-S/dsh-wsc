import { test } from 'node:test'
import assert from 'node:assert/strict'

import { categorizeState } from '../lib/state-categories.js'

const state = {
  done: [],
  open: ['a real open item'],
  next: ['do the thing'],
  unknown: ['a previous unknown'],
}

test('state categories: a failed acceptance stays; blocker and gap have their own sections', () => {
  const categorized = categorizeState(state, {
    receipts: [{
      path: 'markdown-split.test.js', edit: 10, check: 11, command: 'node --test',
      result: '', summary: { kind: 'summary', tests: 7, pass: 6, fail: 1, skipped: 0 },
    }],
    gaps: ['segment 5: all 5 entries rejected'],
    error: { line: 'Error: boom', location: 'src/app.js:3', command: 'npm test', blocking: 'unresolved (no later command run)' },
  })
  assert.equal(categorized.unknown.length, 2)
  assert.match(categorized.unknown[0], /^Acceptance — markdown-split\.test\.js/)
  assert.match(categorized.unknown[0], /6 pass \/ 1 fail/)
  assert.equal(categorized.unknown[1], 'a previous unknown')
  assert.ok(!categorized.unknown.some((row) => /^(?:Blocker|Gap) — /.test(row)))
})

test('state categories: no evidence leaves the state untouched', () => {
  assert.equal(categorizeState(state, {}), state)
})

test('state categories: rows are capped and duplicate prefixes are dropped', () => {
  const many = {
    done: [], open: [], next: [], unknown: ['Acceptance — a.test.js old row', 'u2', 'u3', 'u4', 'u5', 'u6'],
  }
  const categorized = categorizeState(many, {
    receipts: [{
      path: 'a.test.js', edit: 1, check: 2, command: 'node --test',
      result: '', summary: { kind: 'summary', tests: 2, pass: 1, fail: 1, skipped: 0 },
    }],
  })
  assert.equal(categorized.unknown.length, 6)
  assert.equal(categorized.unknown.filter((row) => String(row).startsWith('Acceptance —')).length, 1)
})

test('categories: the renderer drops the duplicated Unknown prefix', async () => {
  const { renderCheckpointState } = await import('../lib/checkpoint-state.js')
  const text = renderCheckpointState({
    done: [], open: [], next: [],
    unknown: ['Acceptance — a.js check #3: 0 pass / 1 fail', 'Blocker — npm test; blocking: unknown', 'plain note'],
  })
  assert.match(text, /- Acceptance — a\.js check #3: 0 pass \/ 1 fail/)
  assert.match(text, /- Blocker — npm test; blocking: unknown/)
  assert.match(text, /- Unknown: plain note/)
  assert.doesNotMatch(text, /Unknown: Acceptance/)
})

test('categories: a categorized state survives the summary round-trip', async () => {
  const { assertCheckpointState, checkpointStateFromSummary, renderCheckpointState } =
    await import('../lib/checkpoint-state.js')
  const { asCheckpointState } = await import('../lib/state.js')
  const categorized = asCheckpointState(categorizeState(
    { done: ['edited a.js'], open: [], next: ['run the suite'], unknown: [] },
    {
      receipts: [{
        path: 'a.js', edit: 4, check: 5, command: 'node --test',
        result: '', summary: { kind: 'summary', tests: 3, pass: 2, fail: 1, skipped: 0 },
      }],
      gaps: ['segment 3: 1 entries rejected'],
      error: { line: 'Error: boom', location: 'src/a.js:3', command: 'npm test', blocking: 'unresolved' },
    },
  ))
  const text = `## Working state\n${renderCheckpointState(categorized)}`
  const published = checkpointStateFromSummary([{ type: 'text', text }])
  assert.deepEqual(published, categorized)
  assert.doesNotThrow(() => assertCheckpointState({ state: categorized, summary: [{ type: 'text', text }] }))
})
