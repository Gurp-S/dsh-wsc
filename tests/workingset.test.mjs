import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildWorkingSet, createWorkingSet } from '../lib/workingset.js'

const call = (id, name, args) => ({
  role: 'assistant',
  content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }],
})

// The harness projects a tool result into a user-role message that keeps the
// call id; `role: 'tool'` never appears in a live region.
const result = (id, text) => ({
  role: 'user',
  toolCallId: id,
  source: { kind: 'tool', callId: id },
  content: [{ type: 'text', text }],
})

const readOutput = (path, body) => `<path>${path}</path>\n<type>file</type>\n<content>\n${body}\n</content>`

test('a read keeps its content and is marked current', () => {
  const items = buildWorkingSet([
    call('c1', 'read', { path: 'src/a.js' }),
    result('c1', readOutput('src/a.js', 'export const a = 1')),
  ])
  assert.equal(items.length, 1)
  assert.match(items[0], /^src\/a\.js — read #0, unchanged since; 1 lines/)
  assert.match(items[0], /export const a = 1/)
  assert.doesNotMatch(items[0], /<content>|<path>/)
})

test('an edit after the read makes the snapshot stale and drops its body', () => {
  const items = buildWorkingSet([
    call('c1', 'read', { path: 'src/a.js' }),
    result('c1', readOutput('src/a.js', 'export const a = 1')),
    call('c2', 'edit', { path: 'src/a.js', old_string: 'a = 1', new_string: 'a = 2' }),
  ])
  assert.equal(items.length, 1)
  assert.match(items[0], /body stale, edited at #2/)
  assert.match(items[0], /last edit wrote: "a = 2"/)
  assert.doesNotMatch(items[0], /export const a = 1/)
})

test('a write carries the exact new content and clears earlier edits', () => {
  const items = buildWorkingSet([
    call('c1', 'read', { path: 'src/a.js' }),
    result('c1', readOutput('src/a.js', 'old')),
    call('c2', 'edit', { path: 'src/a.js', new_string: 'x' }),
    call('c3', 'write', { path: 'src/a.js', content: 'export const a = 3\nexport const b = 4' }),
  ])
  assert.equal(items.length, 1)
  assert.match(items[0], /write #3, unchanged since/)
  assert.match(items[0], /export const b = 4/)
  assert.doesNotMatch(items[0], /stale/)
})

test('only the newest files are kept, oldest first', () => {
  const messages = []
  for (const name of ['a', 'b', 'c']) {
    messages.push(call(`r-${name}`, 'read', { path: `src/${name}.js` }))
    messages.push(result(`r-${name}`, readOutput(`src/${name}.js`, `content of ${name}`)))
  }
  const items = buildWorkingSet(messages, { maxFiles: 2 })
  assert.equal(items.length, 2)
  assert.match(items[0], /^src\/b\.js/)
  assert.match(items[1], /^src\/c\.js/)
})

test('a read without a result leaves no snapshot', () => {
  const items = buildWorkingSet([
    call('c1', 'read', { path: 'src/missing.js' }),
    result('c1', ''),
  ])
  assert.deepEqual(items, [])
})

test('a carried section keeps a file this region never saw', () => {
  const first = createWorkingSet()
  first.apply([
    call('c1', 'read', { path: 'src/a.js' }),
    result('c1', readOutput('src/a.js', 'export const a = 1')),
  ])
  const seed = `## Working set (x)\n${first.items().join('\n')}`

  const second = createWorkingSet({ seed })
  second.apply([
    call('c2', 'read', { path: 'src/b.js' }),
    result('c2', readOutput('src/b.js', 'export const b = 2')),
  ])
  const items = second.items()
  assert.equal(items.length, 2)
  assert.match(items[0], /^src\/a\.js — read #0, unchanged since; 1 lines/)
  assert.match(items[0], /export const a = 1/)
  assert.match(items[1], /^src\/b\.js — read #1/)
})

test('a dsh spill read is ignored', () => {
  const spill = 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-4KLVaC\\session-1\\f9a6-pwsh.txt'
  const items = buildWorkingSet([
    call('c1', 'read', { path: spill }),
    result('c1', readOutput(spill, '1: father_id?: string | undefined;')),
    call('c2', 'read', { path: 'src/a.js' }),
    result('c2', readOutput('src/a.js', 'export const a = 1')),
  ])
  assert.equal(items.length, 1)
  assert.doesNotMatch(items[0], /dsh-spill|father_id/)
  assert.match(items[0], /^src\/a\.js/)
})

test('a spill entry in a carried section is dropped', () => {
  const spill = 'C:\\Users\\x\\AppData\\Local\\Temp\\dsh-spill-4KLVaC\\session-1\\f9a6-pwsh.txt'
  const seed = `## Working set\n${spill} — read #1, unchanged since; 1 lines\n1: father_id?: string;`
  const items = buildWorkingSet([], { seed })
  assert.deepEqual(items, [])
})

test('a file under the OS temp directory is not carried', () => {
  const temp = 'C:\\Users\\x\\AppData\\Local\\Temp\\notes.txt'
  const items = buildWorkingSet([
    call('c1', 'read', { path: temp }),
    result('c1', readOutput(temp, 'scratch')),
    call('c2', 'read', { path: 'src/a.js' }),
    result('c2', readOutput('src/a.js', 'export const a = 1')),
  ])
  assert.equal(items.length, 1)
  assert.doesNotMatch(items[0], /notes\.txt|scratch/)
  assert.match(items[0], /^src\/a\.js/)
})

test('body headings are escaped so quoted file text cannot open a section', () => {
  const body = '# Plan\n\n## 0. Reading premise\n\n```bash\n# not a heading\n```'
  const items = buildWorkingSet([
    call('c1', 'read', { path: 'docs/plan.md' }),
    result('c1', readOutput('docs/plan.md', body)),
  ])
  assert.equal(items.length, 1)
  assert.match(items[0], /\\# Plan/)
  assert.match(items[0], /\\## 0\. Reading premise/)
  assert.match(items[0], /```bash\n# not a heading\n```/)
  assert.ok(!/^## /m.test(items[0]))
})
