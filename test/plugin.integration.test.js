import test from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Plugin from '../lib/index.js';
import { stableId } from '../lib/history.js';

const Stub = (name) => class extends Service {
  static provide = name;
  constructor(ctx) { super(ctx); }
};

function userEvent(seq, id, text) {
  return {
    seq,
    time: 1_800_000_000_000 + seq,
    type: 'user/message',
    surfaceOp: 'append',
    data: { id, role: 'user', content: [{ type: 'text', text }] },
  };
}

function assistantEvent(seq, id, text) {
  return {
    seq,
    time: 1_800_000_000_000 + seq,
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { message: { id, role: 'assistant', content: [{ type: 'text', text }] } },
  };
}

function startEvent(seq, compactionId) {
  return { seq, time: 1_800_000_000_000 + seq, type: 'compaction/start', data: { compactionId } };
}

function endEvent(seq, compactionId, error) {
  return { seq, time: 1_800_000_000_000 + seq, type: 'compaction/end', data: { compactionId, turn: 1, ...(error ? { error } : {}) } };
}

test('loads as the DSH compaction service and commits V1 cache only after success', async () => {
  const home = mkdtempSync(path.join(tmpdir(), 'dsh-wsc-integration-'));
  const cwd = path.join(home, 'workspace');
  mkdirSync(cwd, { recursive: true });
  const previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  const ctx = new Context();
  let pluginFiber;
  try {
    await ctx.plugin(Stub('llm'));
    await ctx.plugin(Stub('tokenMeter'));
    await ctx.plugin(Stub('sessions'));
    pluginFiber = await ctx.plugin(Plugin, { auto: false });
    const engine = ctx.get('compaction');
    assert.equal(engine?.name, 'compaction');

    const messages = [];
    const events = [];
    for (let index = 0; index < 36; index += 1) {
      const user = userEvent(index * 2, `u-${index}`, `Implement feature ${index}: preserve the current behavior and report the exact verification result. `.repeat(4));
      const assistant = assistantEvent(index * 2 + 1, `a-${index}`, `The implementation inspected module_${index}.py and retained the validated behavior. `.repeat(14));
      events.push(user, assistant);
      messages.push({ id: user.data.id, role: 'user', content: user.data.content });
      messages.push({ id: assistant.data.message.id, role: 'assistant', content: assistant.data.message.content });
    }
    events.push(startEvent(events.length, 'compact-success'));
    const session = { id: 'integration-session', header: { cwd }, events };
    const agent = { session, options: { provider: 'deepseek-official', model: 'deepseek-flash' } };
    const settingsFile = path.join(home, 'wsc', 'settings.json');
    const stateFile = path.join(home, 'wsc', 'state', `${stableId(session.id)}.json.gz`);
    const first = await engine.summarize({ messages }, agent, new AbortController().signal);
    assert.equal(first.model, 'v1');
    assert.match(first.summary[0].text, /\[/);
    assert.match(first.summary[0].text, /read\(file_path=/);
    assert.equal(existsSync(settingsFile), true);
    assert.equal(existsSync(stateFile), false, 'proposal is not committed before compaction/end');
    await ctx.emit('session/event', session, endEvent(events.length, 'compact-success'));
    events.push(endEvent(events.length, 'compact-success'));
    assert.equal(existsSync(stateFile), true);
    const committed = readFileSync(stateFile);
    const document = JSON.parse(gunzipSync(committed).toString('utf8'));
    assert.equal(document.sourceSeqs.length, 72);

    const extra = userEvent(events.length, 'u-extra', 'Keep the same parser behavior and add a regression test.');
    events.push(extra);
    messages.push({ id: extra.data.id, role: 'user', content: extra.data.content });
    events.push(startEvent(events.length, 'compact-failed'));
    const second = await engine.summarize({ messages }, agent, new AbortController().signal);
    assert.equal(second.model, 'v1');
    const failedEnd = endEvent(events.length, 'compact-failed', 'test failure');
    await ctx.emit('session/event', session, failedEnd);
    events.push(failedEnd);
    assert.deepEqual(readFileSync(stateFile), committed, 'failed compaction leaves the last committed cache untouched');

    writeFileSync(settingsFile, JSON.stringify({ implementation: 'v2' }));
    events.push(startEvent(events.length, 'compact-v2'));
    const third = await engine.summarize({ messages }, agent, new AbortController().signal);
    assert.equal(third.model, 'v2');
    assert.match(third.summary[0].text, /CURRENT REQUEST/);
  } finally {
    if (pluginFiber) await pluginFiber.dispose();
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
