import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildWorkingSet, clamp, docClamp, isDocumentPath } from '../lib/workingset.js'

const prose = '正文'.repeat(900)
const plan = `# 标题

> 状态：方案

## 0. 阅读前提

${prose}

| PR | 范围 | 依赖 | 估时 |
|---|---|---|---|
| PR-1 | A1 心跳 | 无 | 1 天 |
| PR-2 | A3 续传 | PR-1 | 2 天 |

### A1 心跳
**位置**：src/heartbeat.js

### A3 续传
**位置**：src/resume.js

## 11. 总验收

最后一段。${prose}`

test('doc structure: a long plan keeps outline, PR table, acceptance and tail', () => {
  const output = docClamp(plan, 1200)
  assert.match(output, /^\[document structure: 5 headings, 1 tables/)
  assert.match(output, /\[outline\]/)
  assert.match(output, /## 0\. 阅读前提/)
  assert.match(output, /\| PR-1 \| A1 心跳/)
  assert.match(output, /\[acceptance\]\nA1: src\/heartbeat\.js/)
  assert.match(output, /\[last section\]/)
  assert.ok(output.length <= 1200)
  assert.doesNotMatch(output, /… \d+ chars omitted …/)
})

test('doc structure: a long body without headings still falls back safely', () => {
  const text = 'x'.repeat(5000)
  const output = docClamp(text, 700)
  assert.ok(output.length <= 700)
  assert.match(output, /\d+ lines? omitted/)
})

test('doc structure: only markdown paths use the structure view', () => {
  assert.equal(isDocumentPath('docs/plan.md'), true)
  assert.equal(isDocumentPath('src/app.js'), false)
  const long = `# T\n\n## S\n\n${'body '.repeat(400)}`
  const withDocs = buildWorkingSet([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'write', arguments: { path: 'docs/plan.md', content: long } }] },
  ], { docStructure: true }).join('\n')
  assert.match(withDocs, /\[document structure:/)
  const plain = buildWorkingSet([
    { role: 'assistant', content: [{ type: 'tool-call', id: 'c1', name: 'write', arguments: { path: 'docs/plan.md', content: long } }] },
  ]).join('\n')
  assert.doesNotMatch(plain, /\[document structure:/)
})

test('doc structure: read-tool line numbers do not hide the outline', () => {
  const numbered = plan.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')
  const output = docClamp(numbered, 1200)
  assert.match(output, /^\[document structure: 5 headings, 1 tables/)
  assert.match(output, /\| PR-1 \| A1 心跳/)
  assert.doesNotMatch(output, /^\d+: /m)
})

test('doc structure: clamp cuts on line boundaries and states omitted lines', () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n')
  const output = clamp(text, 300)
  assert.match(output, /… \d+ lines omitted …/)
  assert.ok(output.split('\n').every((line) => line === '' || /^line \d+$/.test(line) || /^… /.test(line)))
})

test('doc structure: read-tool trailers are not part of the body', async () => {
  const { unwrapReadResult } = await import('../lib/workingset.js')
  const body = unwrapReadResult('<path>x</path>\n<content>\n1: a\n2: b\n(Showing lines 1-2 of 9. Use offset=3 to continue.)\n</content>')
  assert.equal(body, '1: a\n2: b')
  assert.equal(unwrapReadResult('<content>\na\n(End of file - total 3 lines)\n</content>'), 'a')
})
