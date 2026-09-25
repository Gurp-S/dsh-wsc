import test from 'node:test';
import assert from 'node:assert/strict';
import { expandSelectedMessages, stableId } from '../lib/history.js';
import { readSettings } from '../lib/settings.js';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function source(seq, id, type = 'user/message') {
  return type === 'assistant/message'
    ? { seq, time: seq, type, surfaceOp: 'append', data: { message: { id, role: 'assistant', content: [] } } }
    : { seq, time: seq, type, surfaceOp: 'append', data: { id, role: 'user', content: [] } };
}

test('expands nested checkpoints to original append messages in source order', () => {
  const events = [
    source(0, 'u0'),
    source(1, 'a1', 'assistant/message'),
    { seq: 2, time: 2, type: 'user/message', surfaceOp: { op: 'replace', start: 0, end: 1 }, sourceEventSeqs: [0, 1], data: { id: 'checkpoint-1', role: 'user', content: [] } },
    source(3, 'u3'),
    { seq: 4, time: 4, type: 'user/message', surfaceOp: { op: 'replace', start: 2, end: 3 }, sourceEventSeqs: [2, 3], data: { id: 'checkpoint-2', role: 'user', content: [] } },
  ];
  const session = { events };
  assert.deepEqual(expandSelectedMessages(session, [{ id: 'checkpoint-2' }]).map((event) => event.seq), [0, 1, 3]);
  assert.deepEqual(expandSelectedMessages(session, [{ id: 'checkpoint-2' }, { id: 'a1' }]).map((event) => event.seq), [0, 1, 3]);
});

test('creates a default V1 settings file and reads V2 updates dynamically', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dsh-wsc-settings-'));
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = directory;
  try {
    assert.deepEqual(readSettings(), { implementation: 'v1' });
    const filename = path.join(directory, 'wsc', 'settings.json');
    assert.equal(JSON.parse(readFileSync(filename, 'utf8')).implementation, 'v1');
    writeFileSync(filename, JSON.stringify({ implementation: 'v2' }));
    assert.deepEqual(readSettings(), { implementation: 'v2' });
    writeFileSync(filename, JSON.stringify({ implementation: 'v3' }));
    assert.throws(readSettings, /must be "v1" or "v2"/);
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('session IDs are reduced to stable filesystem-safe names', () => {
  assert.equal(stableId('session:one'), stableId('session:one'));
  assert.match(stableId('session:one'), /^[a-f0-9]{24}$/);
});
