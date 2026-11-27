/**
 * One-line compaction status for the client.
 *
 * The engine writes a small JSON record per session; the host serves it on an
 * exact route and the chat UI polls it. A failed write is a lost status line,
 * never a lost checkpoint.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveHome } from './home.js'

export const STATUS_ROUTE = '/plugins/dsh-wsc/status'
const SESSION_ID = /^[A-Za-z0-9._-]{1,200}$/

export function statusPath(sessionId) {
  const safe = String(sessionId ?? '').replace(/[^A-Za-z0-9._-]/g, '_')
  return join(resolveHome(), 'wsc', 'status', `${safe}.json`)
}

/** Merge one phase update into the session's status record. */
export function writeStatus(sessionId, patch) {
  if (typeof sessionId !== 'string' || sessionId === '' || patch === null || typeof patch !== 'object') {
    return false
  }
  try {
    const file = statusPath(sessionId)
    mkdirSync(dirname(file), { recursive: true })
    let current = {}
    try {
      current = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      current = {}
    }
    const next = {
      ...current,
      ...patch,
      sessionId,
      at: new Date().toISOString(),
    }
    writeFileSync(file, JSON.stringify(next), 'utf8')
    return true
  } catch {
    return false
  }
}

export function readStatus(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  try {
    const row = JSON.parse(readFileSync(statusPath(sessionId), 'utf8'))
    return row !== null && typeof row === 'object' ? row : null
  } catch {
    return null
  }
}

/** Exact-route handler: `GET /plugins/dsh-wsc/status?sessionId=...`. */
export function createStatusHandler() {
  return (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'method' }))
        return
      }
      const url = new URL(String(req.url ?? STATUS_ROUTE), 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (!SESSION_ID.test(sessionId)) {
        res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'sessionId' }))
        return
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ ok: true, status: readStatus(sessionId) }))
    } catch {
      try {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'status' }))
      } catch {
        // The socket is already gone; nothing to report to.
      }
    }
  }
}
