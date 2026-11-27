import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { STATUS_ROUTE, createStatusHandler, readStatus, statusPath, writeStatus } from '../lib/status.js'

const withHome = (fn) => {
  const previous = process.env.DSH_HOME
  const home = mkdtempSync(join(tmpdir(), 'wsc-status-'))
  process.env.DSH_HOME = home
  try {
    return fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

const call = (handler, method, url) => {
  const chunks = []
  const res = {
    status: 0,
    headers: {},
    writeHead(status, headers = {}) { this.status = status; this.headers = headers },
    end(body = '') { chunks.push(String(body)) },
  }
  handler({ method, url }, res)
  return { status: res.status, body: chunks.join('') }
}

test('status: writes merge phases and read back per session', () => withHome(() => {
  writeStatus('session-a', { phase: 'running', fromTokens: 143784, segmentsDone: 0, segmentsTotal: 19 })
  assert.equal(writeStatus('session-a', { phase: 'prepared', segmentsDone: 19, accepted: 79 }), true)
  const status = readStatus('session-a')
  assert.equal(status.phase, 'prepared')
  assert.equal(status.fromTokens, 143784)
  assert.equal(status.segmentsDone, 19)
  assert.equal(status.accepted, 79)
  assert.match(statusPath('session-a'), /wsc[\\/]status[\\/]session-a\.json$/)
  assert.equal(readStatus('session-b'), null)
}))

test('status: unsafe ids are refused and never join the path', () => withHome(() => {
  assert.equal(readStatus('../escape'), null)
  assert.equal(writeStatus('', { phase: 'done' }), false)
}))

test('status: the route serves a record and rejects bad requests', () => withHome(() => {
  writeStatus('session-a', { phase: 'done', fromTokens: 1000, toTokens: 200 })
  const handler = createStatusHandler()
  const ok = call(handler, 'GET', `${STATUS_ROUTE}?sessionId=session-a`)
  assert.equal(ok.status, 200)
  assert.equal(JSON.parse(ok.body).status.phase, 'done')
  assert.equal(JSON.parse(ok.body).status.toTokens, 200)
  const bad = call(handler, 'GET', `${STATUS_ROUTE}?sessionId=../escape`)
  assert.equal(bad.status, 400)
  const method = call(handler, 'POST', `${STATUS_ROUTE}?sessionId=session-a`)
  assert.equal(method.status, 405)
}))
