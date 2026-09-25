import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { rmSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHome, readSettings, atomicWrite } from './settings.js';
import { expandSelectedMessages, stableId } from './history.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bridgePath = path.join(packageRoot, 'python', 'wsc_bridge.py');
const MAX_BRIDGE_BYTES = 256 * 1024 * 1024;

function getOpenCompaction(session) {
  let latestStart;
  const ended = new Set();
  for (const event of session.events) {
    if (event.type === 'compaction/end') ended.add(event.data.compactionId);
  }
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (event.type === 'compaction/start' && !ended.has(event.data.compactionId)) {
      latestStart = event;
      break;
    }
  }
  if (!latestStart) throw new Error('WSC compaction hook ran without an open compaction transaction');
  return latestStart.data.compactionId;
}

function statePath(sessionId) {
  return path.join(dshHome(), 'wsc', 'state', `${stableId(sessionId)}.json.gz`);
}

function readState(filename) {
  if (!existsSync(filename)) return undefined;
  try {
    return JSON.parse(gunzipSync(readFileSync(filename)).toString('utf8'));
  } catch {
    // State is a cache. A damaged cache can be rebuilt from the append-only
    // session log, which remains the source of truth.
    return undefined;
  }
}

function readExecutable() {
  const configured = process.env.XEYO_WSC_PYTHON;
  if (configured) return [{ file: configured, args: [] }];
  if (process.platform === 'win32') {
    return [
      { file: 'py.exe', args: ['-3.11'] },
      { file: 'python.exe', args: [] },
    ];
  }
  return [{ file: 'python3', args: [] }];
}

function runPython(candidate, request, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate.file, [...candidate.args, bridgePath], {
      cwd: request.cwd || packageRoot,
      windowsHide: true,
      signal,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    child.on('error', (error) => finish(reject, error));
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_BRIDGE_BYTES) {
        child.kill();
        finish(reject, new Error('WSC bridge output exceeded 256 MiB'));
      } else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errorBytes += chunk.length;
      if (errorBytes <= 1024 * 1024) stderr.push(chunk);
    });
    child.on('close', (code) => {
      const errText = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        finish(reject, Object.assign(new Error(errText || `Python exited with code ${code}`), { exitCode: code }));
        return;
      }
      try {
        finish(resolve, JSON.parse(Buffer.concat(stdout).toString('utf8')));
      } catch (error) {
        finish(reject, new Error('WSC bridge returned invalid JSON', { cause: error }));
      }
    });
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') finish(reject, error);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function runBridge(request, signal) {
  const candidates = readExecutable();
  let lastError;
  for (const candidate of candidates) {
    try {
      return await runPython(candidate, request, signal);
    } catch (error) {
      lastError = error;
      if (error?.code !== 'ENOENT' || candidates.length === 1) break;
    }
  }
  const detail = String(lastError?.message || lastError || 'unknown error').trim();
  throw new Error(`WSC ${request.implementation} bridge failed: ${detail}`, { cause: lastError });
}

function latestSourcePrefixFits(previous, sourceSeqs) {
  if (!previous?.sourceSeqs || !Array.isArray(previous.sourceSeqs)) return false;
  if (previous.sourceSeqs.length > sourceSeqs.length) return false;
  return previous.sourceSeqs.every((seq, index) => seq === sourceSeqs[index]);
}

function viewPathFor(cwd, sessionId, compactionId) {
  if (!cwd) throw new Error('WSC Read handles require a session workspace (session.header.cwd)');
  const relative = path.posix.join('.xeyo_offload', 'dsh-wsc', stableId(sessionId, 16), `${stableId(compactionId, 16)}.txt`);
  return {
    absolute: path.resolve(cwd, ...relative.split('/')),
    reference: relative,
  };
}

export class XeyoWscCompactionEngine extends BasicCompactionEngine {
  pendingStates = new Map();
  pendingViews = new Map();

  constructor(ctx, config = {}) {
    super(ctx, config);
    ctx.on('session/event', (session, event) => this.#onSessionEvent(session, event));
  }

  async summarize(input, agent, signal) {
    signal?.throwIfAborted();
    const implementation = readSettings().implementation;
    const compactionId = getOpenCompaction(agent.session);
    const rawEvents = expandSelectedMessages(agent.session, input.messages);
    if (rawEvents.length === 0) throw new Error('WSC selected span has no recoverable append-origin messages');

    const sessionId = String(agent.session.id);
    const sourceSeqs = rawEvents.map((event) => event.seq);
    const previousPath = statePath(sessionId);
    const committed = implementation === 'v1' ? readState(previousPath) : undefined;
    const keepPrevious = implementation === 'v1' && latestSourcePrefixFits(committed, sourceSeqs);
    const cwd = agent.session.header.cwd;
    const view = implementation === 'v1' ? viewPathFor(cwd, sessionId, compactionId) : undefined;
    let result;
    try {
      result = await runBridge({
        implementation,
        sessionId,
        cwd,
        events: rawEvents,
        state: keepPrevious ? committed.state : undefined,
        viewPath: view?.absolute,
        viewRef: view?.reference,
      }, signal);
      signal?.throwIfAborted();
    } catch (error) {
      if (view) rmSync(view.absolute, { force: true });
      throw error;
    }
    if (!result?.text || result.compressed === false) {
      if (view) rmSync(view.absolute, { force: true });
      throw new Error(result?.reason || `WSC ${implementation} did not produce a shrinking projection`);
    }

    if (implementation === 'v1') {
      this.pendingStates.set(sessionId, {
        compactionId,
        filename: previousPath,
        document: { sourceSeqs, state: result.state },
      });
      this.pendingViews.set(sessionId, { compactionId, filename: view.absolute });
    }
    return {
      summary: [{ type: 'text', text: result.text.replaceAll('Read(file_path=', 'read(file_path=') }],
      provider: 'xeyo-wsc',
      model: implementation,
    };
  }

  #onSessionEvent(session, event) {
    if (event.type !== 'compaction/end') return;
    const sessionId = String(session.id);
    const pending = this.pendingStates.get(sessionId);
    if (!pending || pending.compactionId !== event.data.compactionId) return;
    this.pendingStates.delete(sessionId);
    const view = this.pendingViews.get(sessionId);
    this.pendingViews.delete(sessionId);
    if (event.data.error) {
      if (view) rmSync(view.filename, { force: true });
      return;
    }
    try {
      const compressed = gzipSync(Buffer.from(JSON.stringify(pending.document), 'utf8'));
      atomicWrite(pending.filename, compressed);
    } catch (error) {
      this.ctx.logger.warn(`WSC state cache could not be committed: ${String(error)}`);
    }
  }
}

export default XeyoWscCompactionEngine;
