import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyModelNext, modelNextTexts } from '../lib/next-model.js'
import { parseNext, numberedSegment } from '../lib/nosig.js'

test('next: a row serving the newest user request is admitted', () => {
  const texts = modelNextTexts([
    { text: 'adjust private chat to defer files only', user: 3 },
    { text: 'keep image handling unchanged', user: 2 },
  ], 3)
  assert.deepEqual(texts, ['adjust private chat to defer files only', 'keep image handling unchanged'])
})

test('next: rows that never serve the newest request fall back', () => {
  assert.deepEqual(modelNextTexts([{ text: 'finish PR-1', user: 1 }], 3), [])
  assert.deepEqual(modelNextTexts([{ text: 'finish PR-1', user: 4 }], 3), [])
  assert.deepEqual(modelNextTexts([], 3), [])
  assert.deepEqual(modelNextTexts([{ text: 'x', user: 1 }], 0), [])
})

test('next: malformed rows are dropped, duplicates collapse and the cap holds', () => {
  const texts = modelNextTexts([
    { text: '  do   it  ', user: 2 },
    { text: 'do it', user: 2 },
    { text: 'y'.repeat(201), user: 2 },
    { text: '', user: 2 },
    { text: 'third', user: 2 },
    { text: 'fourth', user: 2 },
  ], 2, 2)
  assert.deepEqual(texts, ['do it', 'third'])
})

test('next: parseNext requires a label that exists in the segment', () => {
  const numbered = {
    items: [{ user: 1 }, { user: undefined }, { user: 2 }],
  }
  const parsed = {
    next: [
      { text: 'a', user: 2 },
      { text: 'b', user: 3 },
      { text: 'c' },
      { text: 'd', user: 1 },
    ],
  }
  assert.deepEqual(parseNext(parsed, numbered, 3), [{ text: 'a', user: 2 }, { text: 'd', user: 1 }])
})

test('next: an absent extraction result leaves the deterministic state intact', () => {
  const state = { done: ['a'], open: ['b'], next: ['c'], unknown: [] }
  assert.equal(applyModelNext(state, undefined, 3, true), state)
  assert.equal(applyModelNext(state, null, 3, true), state)
  assert.equal(applyModelNext(state, [{ text: 'x', user: 1 }], 3, true), state)
  assert.equal(applyModelNext(state, [{ text: 'x', user: 3 }], 3, false), state)
})

test('next: admitted rows replace next and drop the open row they complete', () => {
  const state = { done: [], open: ['adjust private chat to defer files only'], next: ['old'], unknown: [] }
  const next = applyModelNext(state, [
    { text: 'adjust private chat to defer files only', user: 3 },
    { text: 'run the tests', user: 3 },
  ], 3, true)
  assert.deepEqual(next.next, ['adjust private chat to defer files only', 'run the tests'])
  assert.deepEqual(next.open, [])
})

test('next: user messages carry u labels, goal and tool rows do not', () => {
  const user = (text, source) => ({ role: 'user', content: [{ type: 'text', text }], source })
  const numbered = numberedSegment([
    user('first', { kind: 'user' }),
    user('goal round', { kind: 'goal' }),
    { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'out' }] }] },
    user('second', { kind: 'user' }),
  ], {
    labelOf: (message) => (message.role === 'user' && message.source?.kind === 'user'
      ? (message.content[0].text === 'first' ? 1 : 2) : undefined),
  })
  assert.match(numbered.text, /\[u1 m1 user\] first/)
  assert.match(numbered.text, /\[m2 user\] goal round/)
  assert.match(numbered.text, /\[u2 m4 user\] second/)
})
