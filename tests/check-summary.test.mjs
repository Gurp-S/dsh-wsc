import { test } from 'node:test'
import assert from 'node:assert/strict'

import { checkSummary, checkSummaryText } from '../lib/check-summary.js'
import { receiptsText } from '../lib/passage.js'

test('checks: node spec reporter yields exact counts', () => {
  const summary = checkSummary([
    '✔ first case (1ms)',
    'ℹ tests 22',
    'ℹ suites 0',
    'ℹ pass 22',
    'ℹ fail 0',
    'ℹ cancelled 0',
    'ℹ skipped 0',
  ].join('\n'))
  assert.deepEqual(summary, { kind: 'summary', tests: 22, pass: 22, fail: 0, skipped: 0 })
  assert.equal(checkSummaryText(summary), '22 pass / 0 fail')
})

test('checks: pytest and mocha summaries are recognized', () => {
  assert.deepEqual(checkSummary('6 passed, 1 failed in 0.42s'), {
    kind: 'summary', tests: 7, pass: 6, fail: 1, skipped: null,
  })
  assert.deepEqual(checkSummary('22 passing\n1 failing'), {
    kind: 'summary', tests: 23, pass: 22, fail: 1, skipped: null,
  })
})

test('checks: a first case without a summary is disclosed, not treated as green', () => {
  const summary = checkSummary('✔ markdown-split splits a table (2ms)')
  assert.equal(summary.kind, 'first-case')
  assert.equal(checkSummaryText(summary), 'only the first case is visible; no suite summary in the output')
})

test('checks: no recognizable output stays empty', () => {
  assert.equal(checkSummary('(no output)').kind, 'none')
  assert.equal(checkSummaryText(checkSummary('(no output)')), '')
})

test('checks: the receipt sentence prefers the suite summary', () => {
  const text = receiptsText([{
    path: 'markdown-split.test.js', edit: 10, check: 11,
    command: 'node --test', result: '✔ first case', summary: {
      kind: 'summary', tests: 6, pass: 6, fail: 0, skipped: 0,
    },
  }], [], { summary: true })
  assert.match(text, /check #11 \(node --test → 6 pass \/ 0 fail\) covers markdown-split\.test\.js \(edit #10\)/)
  assert.doesNotMatch(text, /first case/)
})
