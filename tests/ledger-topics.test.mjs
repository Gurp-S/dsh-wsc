import assert from 'node:assert/strict'
import { test } from 'node:test'

import { displayFold, ledgerIndex, normalizeSubject, subjectOf } from '../lib/ledger-topics.js'

const decision = (subject, text, seq, extra = {}) => ({
  id: `n${Math.floor(seq / 100)}-${seq}`, rev: 1, kind: 'decision', subject, text, seq,
  status: 'active', ...extra,
})

test('display fold: identical claims under one subject keep the newest line', () => {
  const entries = [
    decision('attachment.group-file.delivery', '群聊纯文件回卡片', 100),
    decision('attachment.group-file.delivery', '群聊纯文件回卡片', 200),
  ]
  const { entries: kept, collapsed } = displayFold(entries)
  assert.equal(collapsed, 1)
  assert.equal(kept.length, 1)
  assert.doesNotMatch(kept[0].text, /最新权威|旧版本/)
})

test('display fold: near-identical wording keeps the newest and names the hidden ids', () => {
  const entries = [
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存，不回卡片，等随后提问合并', 100),
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存，不回卡片，等随后提问题合并', 200),
  ]
  const { entries: kept, hiddenIds } = displayFold(entries)
  assert.equal(kept.length, 1)
  assert.match(kept[0].text, /（\+1 条旧版本：n1-100@1）/)
  assert.deepEqual(hiddenIds, ['n1-100@1'])
  assert.doesNotMatch(kept[0].text, /最新权威/)
})

test('display fold: divergent claims under one subject stay as separate lines', () => {
  const entries = [
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存', 100),
    decision('attachment.group-file.delivery', '群聊纯文件回可勾选卡片', 200),
  ]
  const { entries: kept, collapsed } = displayFold(entries)
  assert.equal(collapsed, 0)
  assert.equal(kept.length, 2)
  assert.ok(kept.every((entry) => !/旧版本|冲突解/.test(entry.text)))
})

test('display fold: p2p and group subjects stay separate', () => {
  const entries = [
    decision('attachment.file.delivery', '私聊纯文件先登记 pending', 100, { scope: 'p2p' }),
    decision('attachment.file.delivery', '私聊纯文件先登记 pending', 200, { scope: 'group' }),
  ]
  const { collapsed } = displayFold(entries)
  assert.equal(collapsed, 0)
})

test('display fold: requirements and constraints are never folded', () => {
  const entries = [
    { id: 'r1', rev: 1, kind: 'requirement', text: '卡片里可以选择附件', seq: 100, status: 'active' },
    { id: 'r2', rev: 1, kind: 'requirement', text: '卡片里可以选择附件', seq: 200, status: 'active' },
    { id: 'c1', rev: 1, kind: 'constraint', text: '不新增 scoped 工具', seq: 300, status: 'active' },
    { id: 'c2', rev: 1, kind: 'constraint', text: '不新增 scoped 工具', seq: 400, status: 'active' },
  ]
  assert.equal(displayFold(entries).collapsed, 0)
})

test('display fold: entries without a subject only fold identical text', () => {
  const same = [
    { id: 'n1-1', rev: 1, kind: 'decision', text: '同一句话', seq: 100, status: 'active' },
    { id: 'n2-1', rev: 1, kind: 'decision', text: '同一句话', seq: 200, status: 'active' },
  ]
  assert.equal(displayFold(same).collapsed, 1)
  const different = [
    { id: 'n1-1', rev: 1, kind: 'decision', text: '一句不同的话', seq: 100, status: 'active' },
    { id: 'n2-1', rev: 1, kind: 'decision', text: '另一句不同的话', seq: 200, status: 'active' },
  ]
  assert.equal(displayFold(different).collapsed, 0)
})

test('display fold: invalid or missing subject means no subject grouping', () => {
  assert.equal(normalizeSubject('Attachment Group File!'), '')
  assert.equal(normalizeSubject('attachment.group-file.delivery'), 'attachment.group-file.delivery')
  const entry = { id: 'n1-1', rev: 1, kind: 'decision', text: '[attachment.pending.ttl] TTL = 300', seq: 1, status: 'active' }
  assert.equal(subjectOf(entry), 'attachment.pending.ttl')
})

test('display fold: folding is idempotent (the +N suffix is not stacked)', () => {
  const once = displayFold([
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存，不回卡片，等随后提问合并', 100),
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存，不回卡片，等随后提问题合并', 200),
  ])
  const twice = displayFold(once.entries)
  assert.equal(twice.entries.length, 1)
  assert.equal(twice.entries[0].text.match(/条旧版本/g).length, 1)
})

test('index: the newest entry per subject is named with id@rev and version count', () => {
  const entries = [
    decision('attachment.group-file.delivery', '群聊纯文件静默缓存', 100),
    decision('attachment.group-file.delivery', '群聊纯文件改为回卡片', 200),
    decision('attachment.pending.ttl', 'pending TTL = 600', 300, { scope: 'group' }),
    { id: 'n4-1', rev: 1, kind: 'fact', text: 'legacy fact without subject', seq: 400, status: 'active' },
  ]
  const text = ledgerIndex(entries, { maxChars: 2000 })
  assert.match(text, /\[attachment\.group-file\.delivery\] decision n2-200@1/)
  assert.match(text, /\[2 versions\]/)
  assert.match(text, /\[attachment\.pending\.ttl\] \(group\)/)
  assert.match(text, /\(no subject\) fact n4-1@1/)
})

test('index: the extraction context stays inside its byte budget', () => {
  const entries = Array.from({ length: 60 }, (_, index) =>
    decision(`area.topic-${index}`, `claim ${index} ${'x'.repeat(60)}`, index + 1))
  const text = ledgerIndex(entries, { maxSubjects: 60, maxChars: 600 })
  assert.ok(Buffer.byteLength(text) <= 600 + 120)
  assert.ok(text.split('\n').length < 20)
})
