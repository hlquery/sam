'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveSearchDecision, searchBrave } = require('../src/cli')

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
    searchBrave('hlquery', { braveApiKey: 'bad-token', fetchImpl }),
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
    }),
    /timed out after 5ms/,
  )
})
