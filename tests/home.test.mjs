import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveHome } from '../lib/home.js'

test('home: an explicit DSH_HOME wins', () => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = join('C:', 'tmp', 'dsh-home')
  try {
    assert.equal(resolveHome(), join('C:', 'tmp', 'dsh-home'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('home: unset or empty falls back to ~/.dsh', () => {
  const previous = process.env.DSH_HOME
  try {
    delete process.env.DSH_HOME
    assert.equal(resolveHome(), join(homedir(), '.dsh'))
    process.env.DSH_HOME = ''
    assert.equal(resolveHome(), join(homedir(), '.dsh'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
