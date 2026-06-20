#!/usr/bin/env node
'use strict'

// Optional Brave Search token. Prefer BRAVE_SEARCH_API_KEY in the environment
// for shared repositories so the secret is not committed to Git.
const BRAVE_SEARCH_API_KEY = ''

if (BRAVE_SEARCH_API_KEY && !process.env.BRAVE_SEARCH_API_KEY) {
  process.env.BRAVE_SEARCH_API_KEY = BRAVE_SEARCH_API_KEY
}

const { main } = require('./src/cli')

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
