'use strict'

const { createSamService } = require('./service')

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

const DEFAULT_ASK_TIMEOUT_MS = 300000

const withTimeout = (promise, timeoutMs, message, getDetails = () => '') => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise
  }

  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const details = String(getDetails() || '').trim()
      const err = new Error(details ? `${message} Last stage: ${details}` : message)
      err.status = 504
      reject(err)
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

const createSamRouter = (express, serviceOptions = {}) => {
  if (!express || typeof express.Router !== 'function') {
    throw new Error('createSamRouter requires the express module.')
  }

  const router = express.Router()
  const service = createSamService(serviceOptions)
  const askTimeoutMs = Number(serviceOptions.askTimeoutMs || process.env.SAM_ASK_TIMEOUT_MS || DEFAULT_ASK_TIMEOUT_MS)
  const debug = !!serviceOptions.debug

  const debugLog = (message, details) => {
    if (!debug) {
      return
    }
    if (details === undefined) {
      console.error(`[sam debug] ${message}`)
      return
    }
    console.error(`[sam debug] ${message}: ${JSON.stringify(details, null, 2)}`)
  }

  const safeOptions = (options) => {
    const copy = { ...(options || {}) }
    if (copy.token) {
      copy.token = `***${String(copy.token).slice(-4)}`
    }
    if (copy.braveApiKey) {
      copy.braveApiKey = `***${String(copy.braveApiKey).slice(-4)}`
    }
    return copy
  }

  router.get('/models', (_req, res) => {
    debugLog('listing models')
    res.json(service.listModels())
  })

  router.post('/plan', asyncHandler(async (req, res) => {
    const question = req.body?.question
    const options = req.body?.options || {}
    debugLog('planning request', { question, options: safeOptions(options) })
    const route = await service.planRoute(question, options)
    debugLog('planned route', route)
    res.json({ route })
  }))

  router.post('/ask', asyncHandler(async (req, res) => {
    const question = req.body?.question
    const options = req.body?.options || {}
    const progress = { stage: 'received request' }
    debugLog('ask request', {
      question,
      options: safeOptions(options),
      askTimeoutMs,
    })
    const result = await withTimeout(
      service.answer(question, {
        ...options,
        onProgress: (stage, details) => {
          progress.stage = stage
          progress.details = details
          debugLog(`progress: ${stage}`, details)
        },
      }),
      askTimeoutMs,
      `SAM ask timed out after ${Math.round(askTimeoutMs / 1000)} seconds.`,
      () => progress.details
        ? `${progress.stage} ${JSON.stringify(progress.details)}`
        : progress.stage,
    )
    debugLog('ask response', {
      action: result?.action,
      answerChars: typeof result?.answer === 'string' ? result.answer.length : undefined,
      contextDocs: Array.isArray(result?.context?.documents) ? result.context.documents.length : undefined,
      route: result?.route,
    })
    res.json(result)
  }))

  return router
}

module.exports = {
  createSamRouter,
}
