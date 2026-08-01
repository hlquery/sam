'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { runCli } = require('../src/cli')

test('one-shot CLI closes resources after a successful query', async () => {
  const events = []

  await runCli(
    async () => {
      events.push('query')
    },
    async () => {
      events.push('close')
    },
  )

  assert.deepEqual(events, ['query', 'close'])
})

test('one-shot CLI closes resources after a failed query', async () => {
  const events = []
  const previousExitCode = process.exitCode
  const previousConsoleError = console.error
  const errors = []

  console.error = (message) => errors.push(message)
  process.exitCode = 0

  try {
    await runCli(
      async () => {
        events.push('query')
        throw new Error('query failed')
      },
      async () => {
        events.push('close')
      },
    )

    assert.deepEqual(events, ['query', 'close'])
    assert.deepEqual(errors, ['query failed'])
    assert.equal(process.exitCode, 1)
  } finally {
    console.error = previousConsoleError
    process.exitCode = previousExitCode
  }
})
