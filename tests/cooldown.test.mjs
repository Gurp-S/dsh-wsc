import assert from 'node:assert/strict'
import test from 'node:test'

import { Cooldown } from '../lib/cooldown.js'

test('cooldown: an active block expires on its own clock', () => {
  const cooldown = new Cooldown()
  const key = {}
  cooldown.block(key, 60_000, 1_000)
  assert.equal(cooldown.active(key, 1_000), true)
  assert.equal(cooldown.active(key, 60_999), true)
  assert.equal(cooldown.active(key, 61_000), false)
  assert.equal(cooldown.remaining(key, 31_000), 30_000)
  assert.equal(cooldown.remaining(key, 61_000), 0)
})

test('cooldown: clear lifts the block immediately', () => {
  const cooldown = new Cooldown()
  const key = {}
  cooldown.block(key, 60_000, 0)
  assert.equal(cooldown.active(key, 1), true)
  cooldown.clear(key)
  assert.equal(cooldown.active(key, 1), false)
})

test('cooldown: a non-positive duration is a no-op', () => {
  const cooldown = new Cooldown()
  const key = {}
  cooldown.block(key, 0, 0)
  assert.equal(cooldown.active(key, 0), false)
  cooldown.block(key, -5, 0)
  assert.equal(cooldown.active(key, 0), false)
})

test('cooldown: sessions are independent', () => {
  const cooldown = new Cooldown()
  const first = {}
  const second = {}
  cooldown.block(first, 60_000, 0)
  assert.equal(cooldown.active(first, 1), true)
  assert.equal(cooldown.active(second, 1), false)
})
