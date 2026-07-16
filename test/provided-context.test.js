'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { createSamService } = require('../src/service')

test('answer reuses provided documents without fetching hlquery', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    const body = JSON.parse(options.body)
    assert.match(body.messages[1].content, /reused_fetched_documents/)
    assert.match(body.messages[1].content, /Fetched University/)
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Improved answer from fetched records.' } }],
    }), { status: 200 })
  }

  try {
    const sam = createSamService({
      llmBackend: 'server',
      llmModel: 'test-model',
      llmUrl: 'https://llm.example/v1/chat/completions',
      maxTokens: 128,
      temperature: 0,
    })
    const result = await sam.answer('Improve and summarize these records', {
      askCollection: 'universities',
      contextCollection: 'universities',
      contextDocuments: [
        { id: 'too-large', content: 'x'.repeat(751 * 1024) },
        { id: 'u-1', name: 'Fetched University', state: 'Chile' },
      ],
      contextSource: 'samweb-search-results',
      preferProvidedContext: true,
    })

    assert.equal(result.action, 'ask_provided_context')
    assert.equal(result.answer, 'Improved answer from fetched records.')
    assert.equal(result.context.reusedFetchedDocuments, true)
    assert.equal(result.context.source, 'samweb-search-results')
    assert.equal(result.context.receivedDocuments, 2)
    assert.equal(result.context.scanned, 1)
    assert.equal(result.context.documents.length, 1)
    assert.equal(result.context.documents[0]._collection, 'universities')
    assert.equal(result.hits[0]._collection, 'universities')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://llm.example/v1/chat/completions')
  } finally {
    globalThis.fetch = originalFetch
  }
})
