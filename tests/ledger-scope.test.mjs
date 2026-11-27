import { test } from 'node:test'
import assert from 'node:assert/strict'

import { scopeLedger } from '../lib/ledger-scope.js'

const entry = (kind, text, seq) => ({ kind, text, seq })

test('ledger scope: unrelated older facts are archived, constraints stay', () => {
  const ledger = [
    entry('constraint', 'keep the API field names', 1),
    entry('fact', 'agent-map.css: --map-band = #5b8def', 2),
    entry('fact', 'markdown-split.ts: chunk limit = 3600', 10),
    entry('decision', 'split long messages on Markdown block boundaries', 11),
  ]
  const { active, archived } = scopeLedger(ledger, {
    controls: ['实现 markdown 分片与表格续卡'], scopeSeq: 10,
  })
  assert.deepEqual(active.map((row) => row.text), [
    'keep the API field names',
    'markdown-split.ts: chunk limit = 3600',
    'split long messages on Markdown block boundaries',
  ])
  assert.deepEqual(archived.map((row) => row.text), ['agent-map.css: --map-band = #5b8def'])
})

test('ledger scope: entries stated after the request stay', () => {
  const ledger = [entry('fact', 'unrelated old fact', 2), entry('fact', 'new value = 3', 12)]
  const { active, archived } = scopeLedger(ledger, { controls: ['change the parser'], scopeSeq: 10 })
  assert.equal(active.length, 1)
  assert.equal(active[0].text, 'new value = 3')
  assert.equal(archived.length, 1)
})

test('ledger scope: no controls keeps every entry', () => {
  const ledger = [entry('fact', 'old', 1), entry('fact', 'new', 2)]
  assert.deepEqual(scopeLedger(ledger, {}).active, ledger)
  assert.deepEqual(scopeLedger(ledger, {}).archived, [])
})

test('ledger scope: an all-archived view keeps the newest entry for orientation', () => {
  const ledger = [entry('fact', 'old a', 1), entry('fact', 'old b', 2)]
  const { active, archived } = scopeLedger(ledger, { controls: ['new unrelated task'], scopeSeq: 10 })
  assert.equal(active.length, 1)
  assert.equal(active[0].text, 'old b')
  assert.equal(archived.length, 1)
})
