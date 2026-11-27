import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parsePrPlan, planTextsOf, progressRows, renderProgress } from '../lib/progress.js'

const plan = `
| PR | 范围 | 依赖 | 估时 |
|---|---|---|---|
| PR-1 | A1 心跳 + A2 超时 | 无 | 1.5 天 |
| PR-2 | A3 续传 | PR-1 | 2 天 |
| PR-3 | C3 分片 + A9 验收 | PR-1/2 | 2.5 天 |

## A1 心跳
**具体的位置**：\`src/heartbeat.js\`

## A2 超时
\`src/timeout.js\`

## A3 续传
\`src/resume.js\`

## A9 分片
\`src/markdown-split.js\`
`

const receipt = (path, edit, check, pass, fail) => ({
  path, edit, check, command: 'node --test', result: '',
  summary: pass === undefined ? null : { kind: 'summary', tests: pass + fail, pass, fail, skipped: 0 },
})

test('progress: a PR plan maps acceptance units to files and evidence', () => {
  const parsed = parsePrPlan(plan)
  assert.equal(parsed.prs.length, 3)
  assert.deepEqual(parsed.acceptance.get('A1'), ['src/heartbeat.js'])
  const progress = progressRows({
    planTexts: [plan],
    receipts: [
      receipt('src/heartbeat.js', 10, 11, 5, 0),
      receipt('src/timeout.js', 12, 13, 2, 0),
      receipt('src/resume.js', 14, null),
      receipt('src/markdown-split.js', 15, 16, 6, 1),
    ],
    state: { done: [], open: [], next: [], unknown: [] },
  })
  assert.equal(progress.title, '## PR progress (mechanical)')
  const status = Object.fromEntries(progress.rows.map((row) => [row.id, row.status]))
  assert.deepEqual(status, { 'PR-1': 'done', 'PR-2': 'in progress', 'PR-3': 'blocked' })
  const pr3 = progress.rows.find((row) => row.id === 'PR-3')
  assert.match(pr3.acceptance, /A9 not passed/)
})

test('progress: no plan falls back to requirement-level rows', () => {
  const progress = progressRows({
    planTexts: [],
    receipts: [],
    state: {
      done: ['req#1 (edit #2, check #3)'],
      open: ['req#2; edit #4 has no check'],
      next: ['req#3; complete the latest request'],
      unknown: [],
    },
  })
  assert.equal(progress.title, '## Progress (requirement-level)')
  assert.deepEqual(progress.rows.map((row) => row.status), ['done', 'open', 'next'])
})

test('progress: rendered table keeps cells single-line and bounded', () => {
  const text = renderProgress({
    title: '## Progress (requirement-level)',
    rows: [{ id: 'req#1', status: 'done', current: 'a|b', acceptance: 'check #2' }],
  })
  assert.match(text, /^\| item \| status \| current \| acceptance \|/m)
  assert.match(text, /a\\\|b/)
})

test('progress: an empty board renders nothing', () => {
  assert.equal(renderProgress({ title: '## Progress', rows: [] }), '')
})

test('progress: a numbered plan from the read tool still parses', () => {
  const numbered = plan.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n')
  const parsed = parsePrPlan(numbered)
  assert.equal(parsed.prs.length, 3)
  assert.deepEqual(parsed.acceptance.get('A1'), ['src/heartbeat.js'])
})

test('planTextsOf: a read result carries the plan inside nested content', () => {
  const rows = [{
    message: {
      role: 'user',
      content: [{
        type: 'tool-result',
        toolCallId: 'c1',
        content: [{ type: 'text', text: `<path>plan.md</path>\n<content>\n1: | PR | 范围 | 依赖 | 估时 |\n2: | --- | --- | --- | --- |\n3: | PR-1 | A1 心跳 | 无 | 1 天 |\n</content>` }],
      }],
    },
  }]
  const texts = planTextsOf(rows)
  assert.equal(texts.length, 1)
  assert.match(texts[0], /\| PR-1 \| A1 心跳/)
})

test('progress: a requirement row names its request, not its status', () => {
  const { rows } = progressRows({
    state: { done: [], open: ['req#3; no edit recorded'], next: ['req#4; complete the request'] },
  })
  assert.equal(rows[0].id, 'req#3')
  assert.equal(rows[0].status, 'open')
  assert.equal(rows[1].id, 'req#4')
})
