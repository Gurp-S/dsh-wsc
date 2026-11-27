import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorkingSet, createWorkingSet } from '../lib/workingset-v2.js'

const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) })
const asst = (text, ...calls) => ({ role: 'assistant', content: [{ type: 'text', text }, ...calls] })
const result = (callId, body) => ({
  role: 'user',
  toolCallId: callId,
  content: [{ type: 'text', text: `<path>x</path>\n<content>\n${body}\n</content>` }],
})

const readThenEdit = (body = 'line one\nline two') => [
  asst('Checking the planner resolver.', call('c1', 'read', { path: 'src/planner.js' })),
  result('c1', body),
  asst('Rewriting the resolver.', call('c2', 'edit', { path: 'src/planner.js', old_string: 'line one', new_string: 'line 1' })),
]

test('an edited file keeps its body and carries the delta', () => {
  const text = buildWorkingSet(readThenEdit()).join('\n')
  assert.match(text, /src\/planner\.js — read #0/)
  assert.match(text, /edited #2 \(\+1\/−1\): "line 1"/)
  assert.match(text, /line two/)
})

test('a read with no later touch quotes its own role', () => {
  const text = buildWorkingSet(readThenEdit().slice(0, 2)).join('\n')
  assert.match(text, /role: "Checking the planner resolver\."/)
})

test('the role line follows the latest touch, not the read', () => {
  const text = buildWorkingSet([
    ...readThenEdit(),
    asst('Caching the resolver result.', call('c3', 'edit', { path: 'src/planner.js', old_string: 'line 1', new_string: 'line 1 cached' })),
  ]).join('\n')
  assert.match(text, /role at #\d+: "Caching the resolver result\."/)
  assert.doesNotMatch(text, /role: "Checking the planner resolver\./)
})

test('a section re-parsed from a checkpoint keeps body, role and delta', () => {
  const first = buildWorkingSet(readThenEdit()).join('\n')
  const again = buildWorkingSet([], { seed: `## Working set\n\n${first}\n` }).join('\n')
  assert.match(again, /line two/)
  assert.match(again, /role at #2: "Rewriting the resolver\."/)
  assert.match(again, /edited #2 \(\+1\/−1\)/)
})

test('a re-read clears edits it already contains', () => {
  const tracker = createWorkingSet()
  tracker.apply(readThenEdit())
  tracker.apply([
    asst('Re-reading.', call('c3', 'read', { path: 'src/planner.js' })),
    result('c3', 'line 1\nline two'),
  ])
  assert.doesNotMatch(tracker.items().join('\n'), /edited #/)
})

test('the section never exceeds its ceiling and drops whole files', () => {
  const messages = []
  for (let i = 0; i < 6; i += 1) {
    messages.push(asst(`Reading file ${i}.`, call(`r${i}`, 'read', { path: `f${i}.js` })))
    messages.push(result(`r${i}`, 'x'.repeat(700)))
  }
  const items = buildWorkingSet(messages, { sectionCap: 1600 })
  assert.ok(items.join('\n').length <= 1600)
  assert.ok(items.length >= 1)
  assert.doesNotMatch(items.join('\n'), /…/)
})

test('a dsh spill read is never carried as a project file', () => {
  const spill = 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-4KLVaC\\session-1\\f9a6-pwsh.txt'
  const text = buildWorkingSet([
    asst('Inspecting the spilled output.', call('c1', 'read', { file_path: spill })),
    result('c1', '1: father_id?: string | undefined;'),
    asst('Reading the planner.', call('c2', 'read', { path: 'src/planner.js' })),
    result('c2', 'line one'),
  ]).join('\n')
  assert.doesNotMatch(text, /dsh-spill|father_id/)
  assert.match(text, /src\/planner\.js/)
})

test('a spill entry in a carried section is dropped', () => {
  const spill = 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-4KLVaC\\session-1\\f9a6-pwsh.txt'
  const seed = `## Working set\n${spill} — read #1\n1: father_id?: string | undefined;`
  assert.deepEqual(buildWorkingSet([], { seed }), [])
})

test('a file under the OS temp directory is not carried', () => {
  const temp = 'C:\\Users\\x\\AppData\\Local\\Temp\\notes.txt'
  const text = buildWorkingSet([
    asst('Reading a scratch note.', call('c1', 'read', { path: temp })),
    result('c1', 'scratch'),
    asst('Reading the planner.', call('c2', 'read', { path: 'src/planner.js' })),
    result('c2', 'line one'),
  ]).join('\n')
  assert.doesNotMatch(text, /notes\.txt|scratch/)
  assert.match(text, /src\/planner\.js/)
})

test('body headings are escaped so quoted file text cannot open a section', () => {
  const body = '# Plan\n\n## 0. Reading premise\n\n```bash\n# not a heading\n```\n## Tail'
  const text = buildWorkingSet([
    asst('Reading the plan.', call('c1', 'read', { path: 'docs/plan.md' })),
    result('c1', body),
  ]).join('\n')
  assert.match(text, /\\# Plan/)
  assert.match(text, /\\## 0\. Reading premise/)
  assert.match(text, /```bash\n# not a heading\n```/)
  assert.ok(!/^## /m.test(text))
})
