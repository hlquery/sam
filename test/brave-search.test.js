'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { tokenOverlapScore } = require('../src/search-cache')
const { askWithOptionalSearch, resolveSearchDecision, searchBrave } = require('../src/cli')

test('invalid model decisions fall back to the original Brave query', () => {
  assert.deepEqual(
    resolveSearchDecision('I cannot return JSON.', '  latest   Chile news  '),
    { needsSearch: true, query: 'latest Chile news' },
  )
})

test('searchBrave sends the API token and parses web results', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return new Response(JSON.stringify({
      web: {
        results: [{
          title: 'HLQuery',
          url: 'https://www.hlquery.com/',
          description: 'Search beyond keywords.',
        }],
      },
    }), { status: 200 })
  }

  const result = await searchBrave('  hlquery   search  ', {
    braveApiKey: 'test-token',
    fetchImpl,
    searchCache: false,
  })

  assert.equal(request.url.searchParams.get('q'), 'hlquery search')
  assert.equal(request.options.headers['X-Subscription-Token'], 'test-token')
  assert.equal(result.results.length, 1)
  assert.equal(result.results[0].title, 'HLQuery')
})

test('searchBrave reports structured API errors', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    error: { code: 'SUBSCRIPTION_TOKEN_INVALID' },
  }), { status: 401, statusText: 'Unauthorized' })

  await assert.rejects(
    searchBrave('hlquery', { braveApiKey: 'bad-token', fetchImpl, searchCache: false }),
    /HTTP 401.*SUBSCRIPTION_TOKEN_INVALID/,
  )
})

test('searchBrave aborts requests that exceed the timeout', async () => {
  const fetchImpl = async (_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })

  await assert.rejects(
    searchBrave('hlquery', {
      braveApiKey: 'test-token',
      braveSearchTimeoutMs: 5,
      fetchImpl,
      searchCache: false,
    }),
    /timed out after 5ms/,
  )
})

test('askWithOptionalSearch can force Brave when db context is empty', async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url instanceof URL && url.hostname === 'api.search.brave.com') {
      return new Response(JSON.stringify({
        web: {
          results: [{
            title: 'Outside result',
            url: 'https://example.com/outside',
            description: 'External evidence for an out-of-database question.',
          }],
        },
      }), { status: 200 })
    }

    const body = JSON.parse(options.body)
    assert.match(body.messages[1].content, /Brave Search results/)
    assert.match(body.messages[1].content, /https:\/\/example\.com\/outside/)
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'Answered from Brave results.' } }],
    }), { status: 200 })
  }

  try {
    const answer = await askWithOptionalSearch('outside db question', {
      braveApiKey: 'test-token',
      externalSearchQuery: 'outside db question',
      forceWebSearch: true,
      llmBackend: 'server',
      llmModel: 'test-model',
      llmUrl: 'https://llm.example/v1/chat/completions',
      maxTokens: 128,
      search: true,
      searchCache: false,
      temperature: 0,
    }, {
      system: 'Answer with evidence.',
      question: 'Collection context has no documents.',
    })

    assert.equal(answer, 'Answered from Brave results.')
    assert.equal(calls.length, 2)
    assert.equal(calls[0].url.hostname, 'api.search.brave.com')
    assert.equal(calls[1].url, 'https://llm.example/v1/chat/completions')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('search cache similarity scores related queries above unrelated queries', () => {
  const related = tokenOverlapScore('female singer wedding songs', 'best female singer for wedding')
  const unrelated = tokenOverlapScore('female singer wedding songs', 'redis connection timeout')

  assert.ok(related >= 0.55)
  assert.ok(unrelated < 0.55)
})
