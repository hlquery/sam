'use strict'

const crypto = require('node:crypto')

const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379'
const DEFAULT_TTL_SECONDS = 24 * 60 * 60
const DEFAULT_LOOKBACK = 100
const DEFAULT_MIN_SCORE = 0.55
const CACHE_PREFIX = 'sam::cache::search'
const INDEX_KEY = `${CACHE_PREFIX}:index`
const QUERY_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'can', 'find', 'for', 'from',
  'give', 'how', 'i', 'in', 'is', 'it', 'list', 'look', 'me', 'near', 'of', 'on',
  'or', 'search', 'show', 'that', 'the', 'this', 'to', 'what', 'when', 'where',
  'who', 'with', 'you',
])

let redisModule
let redisClient
let redisConnectPromise
let redisUnavailableReason = ''

const normalizeEnabled = (value) => {
  if (value === undefined || value === null || value === '') {
    return true
  }
  return !['0', 'false', 'off', 'no', 'disabled'].includes(String(value).toLowerCase())
}

const cacheEnabled = (options = {}) => normalizeEnabled(
  options.searchCache ?? process.env.SAM_SEARCH_CACHE ?? process.env.HLQUERY_SAM_SEARCH_CACHE,
)

const resolveRedisUrl = (options = {}) => String(
  options.redisUrl ||
  process.env.SAM_REDIS_URL ||
  process.env.REDIS_URL ||
  DEFAULT_REDIS_URL
).trim()

const resolveTtlSeconds = (options = {}) => {
  const configured = Number(
    options.searchCacheTtlSeconds ||
    process.env.SAM_SEARCH_CACHE_TTL_SECONDS ||
    DEFAULT_TTL_SECONDS,
  )
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_TTL_SECONDS
}

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`
  }
  return JSON.stringify(value)
}

const searchCacheKey = (source, identity) => {
  const digest = crypto
    .createHash('sha256')
    .update(stableStringify(identity))
    .digest('hex')
  return `${CACHE_PREFIX}:${source}:${digest}`
}

const normalizeSearchText = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}_. -]+/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const queryTokens = (value) => normalizeSearchText(value)
  .split(' ')
  .map((token) => token.trim())
  .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token))

const tokenOverlapScore = (left, right) => {
  const leftTokens = new Set(queryTokens(left))
  const rightTokens = new Set(queryTokens(right))
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }

  const smaller = Math.min(leftTokens.size, rightTokens.size)
  const larger = Math.max(leftTokens.size, rightTokens.size)
  return (overlap / smaller) * 0.75 + (overlap / larger) * 0.25
}

const identityQuery = (identity = {}) => (
  identity.query ||
  identity.body?.q ||
  identity.metadata?.query ||
  ''
)

const sameSearchScope = (source, requested = {}, candidate = {}) => {
  if (source === 'hlquery') {
    return requested.baseUrl === candidate.baseUrl &&
      requested.path === candidate.path &&
      requested.method === candidate.method
  }
  return true
}

const resolveSimilarOptions = (options = {}) => {
  const enabledValue = options.searchCacheSimilar ??
    process.env.SAM_SEARCH_CACHE_SIMILAR ??
    process.env.HLQUERY_SAM_SEARCH_CACHE_SIMILAR
  const enabled = normalizeEnabled(enabledValue)
  const lookback = Number(options.searchCacheLookback || process.env.SAM_SEARCH_CACHE_LOOKBACK || DEFAULT_LOOKBACK)
  const minScore = Number(options.searchCacheMinScore || process.env.SAM_SEARCH_CACHE_MIN_SCORE || DEFAULT_MIN_SCORE)
  return {
    enabled,
    lookback: Number.isFinite(lookback) && lookback > 0 ? Math.min(Math.floor(lookback), 500) : DEFAULT_LOOKBACK,
    minScore: Number.isFinite(minScore) && minScore > 0 ? Math.min(minScore, 1) : DEFAULT_MIN_SCORE,
  }
}

const loadRedis = () => {
  if (redisModule !== undefined) {
    return redisModule
  }
  try {
    redisModule = require('redis')
  } catch (err) {
    redisUnavailableReason = err.message
    redisModule = null
  }
  return redisModule
}

const getRedisClient = async (options = {}) => {
  if (!cacheEnabled(options)) {
    return null
  }

  const redis = loadRedis()
  if (!redis) {
    return null
  }

  if (redisClient?.isOpen) {
    return redisClient
  }

  if (!redisClient) {
    redisClient = redis.createClient({
      url: resolveRedisUrl(options),
      socket: {
        reconnectStrategy: false,
      },
    })
    redisClient.on('error', (err) => {
      redisUnavailableReason = err.message
    })
  }

  if (!redisConnectPromise) {
    redisConnectPromise = redisClient.connect()
      .catch((err) => {
        redisUnavailableReason = err.message
        const failedClient = redisClient
        redisClient = null
        redisConnectPromise = null
        if (failedClient?.isOpen) {
          failedClient.disconnect().catch(() => {})
        }
        return null
      })
  }

  await redisConnectPromise
  return redisClient?.isOpen ? redisClient : null
}

const readSearchCache = async (source, identity, options = {}) => {
  const client = await getRedisClient(options)
  if (!client) {
    return null
  }

  const key = searchCacheKey(source, identity)
  const raw = await client.get(key)
  if (!raw) {
    return null
  }

  const entry = JSON.parse(raw)
  return {
    key,
    hit: true,
    payload: entry.payload,
    metadata: entry.metadata || {},
  }
}

const findSimilarSearchCache = async (source, identity, options = {}) => {
  const similar = resolveSimilarOptions(options)
  if (!similar.enabled) {
    return null
  }

  const query = identityQuery(identity)
  if (!query) {
    return null
  }

  const client = await getRedisClient(options)
  if (!client) {
    return null
  }

  const keys = await client.zRange(INDEX_KEY, -similar.lookback, -1, { REV: true })
  let best = null
  for (const key of keys) {
    if (!key.startsWith(`${CACHE_PREFIX}:${source}:`)) {
      continue
    }

    const raw = await client.get(key)
    if (!raw) {
      await client.zRem(INDEX_KEY, key).catch(() => {})
      continue
    }

    let entry
    try {
      entry = JSON.parse(raw)
    } catch {
      continue
    }

    if (entry.source !== source || !sameSearchScope(source, identity, entry.identity || {})) {
      continue
    }

    const candidateQuery = identityQuery(entry.identity || {}) || entry.metadata?.query
    const score = tokenOverlapScore(query, candidateQuery)
    if (score < similar.minScore) {
      continue
    }

    if (!best || score > best.score) {
      best = {
        key,
        hit: true,
        similar: true,
        score,
        payload: entry.payload,
        metadata: entry.metadata || {},
        identity: entry.identity || {},
      }
    }
  }

  return best
}

const writeSearchCache = async (source, identity, payload, options = {}, metadata = {}) => {
  const client = await getRedisClient(options)
  if (!client) {
    return null
  }

  const key = searchCacheKey(source, identity)
  const ttlSeconds = resolveTtlSeconds(options)
  const now = new Date().toISOString()
  const entry = {
    source,
    identity,
    metadata,
    payload,
    created_at: now,
    ttl_seconds: ttlSeconds,
  }

  await client.set(key, JSON.stringify(entry), { EX: ttlSeconds })
  await client.zAdd(INDEX_KEY, [{ score: Date.now(), value: key }])
  await client.expire(INDEX_KEY, ttlSeconds)
  return { key, hit: false }
}

const listSearchCache = async (options = {}, limit = 50) => {
  const client = await getRedisClient(options)
  if (!client) {
    return {
      enabled: cacheEnabled(options),
      available: false,
      reason: redisUnavailableReason || 'Redis is not connected.',
      entries: [],
    }
  }

  const count = Math.max(1, Math.min(Number(limit) || 50, 500))
  const keys = await client.zRange(INDEX_KEY, -count, -1, { REV: true })
  const entries = []
  for (const key of keys) {
    const raw = await client.get(key)
    if (!raw) {
      await client.zRem(INDEX_KEY, key).catch(() => {})
      continue
    }
    const entry = JSON.parse(raw)
    entries.push({
      key,
      source: entry.source,
      identity: entry.identity,
      metadata: entry.metadata || {},
      created_at: entry.created_at,
      ttl_seconds: entry.ttl_seconds,
    })
  }

  return {
    enabled: true,
    available: true,
    prefix: CACHE_PREFIX,
    entries,
  }
}

const closeSearchCache = async () => {
  const client = redisClient
  redisClient = null
  redisConnectPromise = null
  if (client?.isOpen) {
    await client.disconnect()
  }
}

module.exports = {
  CACHE_PREFIX,
  INDEX_KEY,
  closeSearchCache,
  findSimilarSearchCache,
  listSearchCache,
  readSearchCache,
  searchCacheKey,
  tokenOverlapScore,
  writeSearchCache,
}
