import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createWorkingSet as createV2 } from '../lib/workingset-v2.js'

const call = (id, name, args) => ({
  role: 'assistant',
  content: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }],
})
const result = (id, text) => ({
  role: 'user',
  toolCallId: id,
  source: { kind: 'tool', callId: id },
  content: [{ type: 'text', text }],
})
const readOutput = (path, body) => `<path>${path}</path>\n<type>file</type>\n<content>\n${body}\n</content>`

const render = (messages, options) => {
  const tracker = createV2(options)
  tracker.apply(messages)
  return tracker.items()
}
const twoFiles = () => [
  call('c1', 'read', { path: 'src/edited.js' }),
  result('c1', readOutput('src/edited.js', 'export const edited = 1')),
  call('e1', 'edit', { path: 'src/edited.js', old_string: 'edited = 1', new_string: 'edited = 2' }),
  call('c2', 'read', { path: 'src/background.js' }),
  result('c2', readOutput('src/background.js', 'export const background = 1')),
]

test('working set: default still drops the oldest entry when the section is over cap', () => {
  const items = render(twoFiles(), { maxFiles: 2, capChars: 200, sectionCap: 60 })
  assert.equal(items.length, 1)
  assert.match(items[0], /^src\/background\.js/)
})

test('working set experiment: protectEdited drops an unedited file first', () => {
  const items = render(twoFiles(), { maxFiles: 2, capChars: 200, sectionCap: 60, protectEdited: true })
  assert.equal(items.length, 1)
  assert.match(items[0], /^src\/edited\.js/)
})

test('working set experiment: protectEdited does not change a section that fits', () => {
  const items = render(twoFiles(), { maxFiles: 2, capChars: 200, sectionCap: 4000, protectEdited: true })
  assert.equal(items.length, 2)
})
