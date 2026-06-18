#!/usr/bin/env node
'use strict'

const express = require('express')
const { createSamRouter } = require('./src/express')

const DEFAULT_ASK_TIMEOUT_MS = 300000

const usage = () => `Usage: node server.js [--debug] [--host HOST] [--port PORT] [--url URL] [--ask-timeout-ms MS] [--llm-backend node|server] [--llm-url URL]

Options:
  --debug              Print SAM request flow and CLI debug logs
  --host HOST          Listen host; defaults to 127.0.0.1
  --port PORT          Listen port; defaults to 9300
  --url URL            hlquery API URL; defaults to http://127.0.0.1:9200
  --ask-timeout-ms MS  Request timeout for POST /sam/ask; defaults to ${DEFAULT_ASK_TIMEOUT_MS}
  --llm-backend MODE   LLM backend for answers: node or server
  --llm-url URL        OpenAI-compatible chat completions URL for server backend
`

const readOptionValue = (argv, index, name) => {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`)
  }
  return value
}

const parseServerArgs = (argv) => {
  const options = {
    port: Number(process.env.SAM_PORT || process.env.SAMWEB_SAM_PORT || process.env.PORT || 9300),
    host: process.env.SAM_HOST || process.env.SAMWEB_SAM_HOST || '127.0.0.1',
    hlqueryUrl: process.env.HLQUERY_URL || 'http://127.0.0.1:9200',
    askTimeoutMs: Number(process.env.SAM_ASK_TIMEOUT_MS || process.env.SAMWEB_ASK_TIMEOUT_MS || DEFAULT_ASK_TIMEOUT_MS),
    llmBackend: process.env.SAM_LLM_BACKEND || process.env.LLM_BACKEND || 'node',
    llmUrl: String(process.env.SAM_LLM_URL || process.env.LLM_BASE_URL || '').trim() || 'http://127.0.0.1:8080/v1/chat/completions',
    debug: process.env.SAM_DEBUG === '1' || process.env.SAMWEB_DEBUG === '1',
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--debug') {
      options.debug = true
      continue
    }
    if (arg === '--host') {
      options.host = readOptionValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--port') {
      options.port = Number(readOptionValue(argv, i, arg))
      i += 1
      continue
    }
    if (arg === '--url') {
      options.hlqueryUrl = readOptionValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--ask-timeout-ms') {
      options.askTimeoutMs = Number(readOptionValue(argv, i, arg))
      i += 1
      continue
    }
    if (arg === '--llm-backend') {
      options.llmBackend = readOptionValue(argv, i, arg)
      i += 1
      continue
    }
    if (arg === '--llm-url') {
      options.llmUrl = readOptionValue(argv, i, arg)
      i += 1
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error('--port must be a positive number.')
  }
  if (!Number.isFinite(options.askTimeoutMs) || options.askTimeoutMs <= 0) {
    throw new Error('--ask-timeout-ms must be a positive number.')
  }
  options.llmBackend = String(options.llmBackend || 'node').toLowerCase()
  if (!['node', 'server'].includes(options.llmBackend)) {
    throw new Error('--llm-backend must be "node" or "server".')
  }

  return options
}

const serverOptions = parseServerArgs(process.argv)
const { port, host, hlqueryUrl, askTimeoutMs, llmBackend, llmUrl, debug } = serverOptions

const app = express()

app.use((req, res, next) => {
  const origin = req.headers.origin
  res.setHeader('Access-Control-Allow-Origin', origin || '*')
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-API-Key')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
})

app.use(express.json({ limit: '1mb' }))
if (debug) {
  app.use((req, res, next) => {
    const started = Date.now()
    console.error(`[sam debug] -> ${req.method} ${req.originalUrl}`)
    res.on('finish', () => {
      console.error(`[sam debug] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - started}ms`)
    })
    next()
  })
}
app.use('/sam', createSamRouter(express, {
  url: hlqueryUrl,
  token: process.env.HLQUERY_TOKEN || '',
  askTimeoutMs,
  llmBackend,
  llmUrl,
  debug,
}))

app.use((err, _req, res, _next) => {
  const status = Number(err?.status || err?.statusCode || 500)
  const safeStatus = status >= 400 && status < 600 ? status : 500
  const message = err?.message || 'SAM request failed'
  console.error(`[sam] ${message}`)
  if (debug && err?.stack) {
    console.error(err.stack)
  }
  res.status(safeStatus).json({
    error: safeStatus >= 500 ? 'SAM Error' : 'SAM Request Error',
    message,
  })
})

const samServer = app.listen(port, host, () => {
  setTimeout(() => {
    if (!samServer.listening) {
      return
    }

    console.log(`SAM API listening at http://${host}:${port}/sam`)
    console.log(`hlquery target: ${hlqueryUrl}`)
    console.log(`LLM backend: ${llmBackend}${llmBackend === 'server' ? ` (${llmUrl})` : ''}`)
    if (debug) {
      console.log(`SAM debug: enabled`)
      console.log(`SAM ask timeout: ${askTimeoutMs}ms`)
    }
  }, 50)
})

samServer.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`SAM API could not start: ${host}:${port} is already in use.`)
    console.error(`Another SAM server may already be running at http://${host}:${port}/sam`)
    process.exit(1)
  }

  console.error(`SAM API server error: ${err?.message || err}`)
  process.exit(1)
})
