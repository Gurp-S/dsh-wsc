import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('client: registers the settings page and the one-line status dock', async () => {
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { definition = value },
    },
  }
  const React = {
    createElement() { return null },
    useState() { return [undefined, () => {}] },
    useEffect() {},
  }
  await import(`../client.js?test=${Date.now()}`)
  assert.equal(definition?.id, '@gurp-s/dsh-wsc')

  const slots = []
  const injected = []
  const ctx = {
    effect(fn) { fn() },
    locale: {
      register() {},
      bind() { return (key) => key },
    },
    configForms: { get() { return undefined } },
    slots: {
      inject(name, register) {
        injected.push(name)
        register()
      },
      register(spec) {
        slots.push(spec)
        return () => {}
      },
    },
  }
  const module = definition.factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected module ${id}`)
  })
  module.apply(ctx)

  assert.deepEqual(injected.sort(), ['conversation.input.dock', 'settings.section'])
  assert.deepEqual(slots.map((slot) => slot.name).sort(), ['conversation.input.dock', 'settings.section'])
  const status = slots.find((slot) => slot.name === 'conversation.input.dock')
  assert.equal(status.id, 'wsc-status')
  assert.equal(typeof status.inject, 'function')
  // Same level as the todo panel, above the goal banner (order 10).
  assert.equal(status.order, 0)
})

test('client: the status line carries a live progress sweep and expandable detail', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(source, /wsc-status-sweep/)
  assert.match(source, /aria-expanded/)
  assert.match(source, /prefers-reduced-motion/)
  assert.match(source, /statusWaiting/)
})
