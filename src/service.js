'use strict'

const core = require('./cli')

const MAX_PROVIDED_DOCUMENTS = 200
const MAX_PROVIDED_CONTEXT_BYTES = 750 * 1024

const defaultOptionsFor = () => core.parseArgs(['node', 'ask.js', '__question__'])

const createOptions = (question, defaults = {}, overrides = {}) => {
  const options = {
    ...defaultOptionsFor(question),
    ...defaults,
    ...overrides,
    question: String(question || overrides.question || defaults.question || '').trim(),
  }

  if (options.askAll || options.askCollection) {
    options.llm = true
  }

  return options
}

const documentId = (doc) => {
  if (!doc || typeof doc !== 'object') {
    return undefined
  }
  return doc.id || doc.doc_id || doc.document_id || doc._id || doc.name || doc.title
}

const normalizeProvidedDocuments = (options = {}) => {
  if (!Array.isArray(options.contextDocuments)) {
    return []
  }

  const collection = String(options.contextCollection || options.askCollection || '').trim()
  const documents = []
  let usedBytes = 2

  for (const entry of options.contextDocuments.slice(0, MAX_PROVIDED_DOCUMENTS)) {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry.document || entry.doc || entry.fields || entry)
      : { value: entry }
    const sourceCollection = source?._collection || source?.collection || entry?._collection || entry?.collection || collection || undefined
    const normalized = source && typeof source === 'object' && !Array.isArray(source)
      ? { _collection: sourceCollection, ...source }
      : { value: source, _collection: sourceCollection }
    if (!normalized._collection) {
      normalized._collection = sourceCollection
    }
    let serialized
    try {
      serialized = JSON.stringify(normalized)
    } catch {
      continue
    }
    if (!serialized) {
      continue
    }
    const documentBytes = Buffer.byteLength(serialized, 'utf8') + 1

    if (usedBytes + documentBytes > MAX_PROVIDED_CONTEXT_BYTES) {
      continue
    }

    documents.push(normalized)
    usedBytes += documentBytes
  }

  return documents
}

const buildProvidedContext = (options, documents) => {
  const collection = String(options.contextCollection || options.askCollection || 'provided').trim() || 'provided'
  const source = String(options.contextSource || 'client-provided').trim() || 'client-provided'
  return core.buildContextFromDocuments(options, documents, {
    collection,
    query: String(options.contextQuery || options.question || '').trim(),
    route: { action: 'provided_context', method: 'CONTEXT', path: source },
    routes: [],
    scanned: documents.length,
    source,
    reusedFetchedDocuments: true,
    receivedDocuments: Array.isArray(options.contextDocuments) ? options.contextDocuments.length : documents.length,
  }, {
    rankingQuestion: options.question,
    contextLimit: options.contextLimit,
    requirePositiveScore: false,
  })
}

const contextSearchPayload = (context) => {
  const documents = Array.isArray(context?.documents) ? context.documents : []
  const scores = Array.isArray(context?.documentScores) ? context.documentScores : []
  const hits = documents.map((doc, index) => {
    const score = scores[index]?.score
    return {
      id: documentId(doc),
      document: doc,
      _collection: doc?._collection || doc?.collection || context?.collection,
      _text_match: Number.isFinite(score) ? score : undefined,
      highlights: doc && typeof doc === 'object' && doc.highlights ? doc.highlights : {},
    }
  })

  return {
    collection: context?.collection,
    filter_by: context?.filterBy,
    found: hits.length,
    hits,
    query: context?.query,
    search_time_ms: 0,
    sort_by: context?.sortBy || 'relevance',
  }
}

const createSamService = (defaults = {}) => {
  const planRoute = async (question, overrides = {}) => {
    const options = createOptions(question, defaults, overrides)

    if (options.routeLlm) {
      try {
        return await core.parseLlmIntent(options.question, options.llmUrl)
      } catch (err) {
        if (options.fallbackToHeuristic === false) {
          throw err
        }
      }
    }

    const route = core.parseHeuristicIntent(options.question)
    if (!route) {
      throw new Error(`Could not map question to an hlquery route: ${options.question}`)
    }
    return route
  }

  const executeRoute = async (question, overrides = {}) => {
    const options = createOptions(question, defaults, overrides)
    const route = overrides.route || await planRoute(options.question, options)
    const result = await core.executeHlquery(options.url, options.token, route, options)
    return { route, result }
  }

  const answer = async (question, overrides = {}) => {
    const options = createOptions(question, defaults, overrides)
    const providedDocuments = normalizeProvidedDocuments(options)

    if (providedDocuments.length > 0 && options.preferProvidedContext !== false) {
      const context = buildProvidedContext(options, providedDocuments)
      const payload = contextSearchPayload(context)
      if (typeof options.onProgress === 'function') {
        options.onProgress('asking model with reused fetched context', {
          collection: context.collection,
          documents: context.documents.length,
          receivedDocuments: context.receivedDocuments,
          source: context.source,
        })
      }
      const answer = await core.askWithOptionalSearch(options.question, options, core.buildCollectionPrompt(options.question, context))
      return {
        action: 'ask_provided_context',
        answer,
        context,
        ...payload,
      }
    }

    if (options.askAll) {
      const context = await core.fetchAllCollectionsContext(options)
      if (context.documents.length === 0 && !options.search) {
        throw new Error('No matching documents found across collections.')
      }
      const payload = contextSearchPayload(context)
      if (typeof options.onProgress === 'function') {
        options.onProgress('asking model with all-collections context', {
          collections: Array.isArray(context.collections) ? context.collections.length : undefined,
          documents: context.documents.length,
        })
      }
      const answer = await core.askWithOptionalSearch(options.question, {
        ...options,
        forceWebSearch: options.search && context.documents.length === 0,
        externalSearchQuery: context.query || options.question,
        externalSearchReason: context.documents.length === 0 ? 'empty all-collections context' : undefined,
      }, core.buildCollectionPrompt(options.question, context))
      return {
        action: 'ask_all',
        answer,
        context,
        ...payload,
      }
    }

    if (options.askCollection) {
      const context = await core.fetchCollectionContext(options)
      if (context.documents.length === 0 && !options.search) {
        throw new Error(`No documents found in collection "${context.collection}" for query "${context.query}".`)
      }
      const payload = contextSearchPayload(context)
      if (typeof options.onProgress === 'function') {
        options.onProgress('asking model with collection context', {
          collection: context.collection,
          route: context.route ? `${context.route.method} ${context.route.path}` : undefined,
          scanned: context.scanned || undefined,
          documents: context.documents.length,
        })
      }
      const answer = await core.askWithOptionalSearch(options.question, {
        ...options,
        forceWebSearch: options.search && context.documents.length === 0,
        externalSearchQuery: context.query || options.question,
        externalSearchReason: context.documents.length === 0 ? 'empty collection context' : undefined,
      }, core.buildCollectionPrompt(options.question, context))
      return {
        action: 'ask_collection',
        answer,
        context,
        ...payload,
      }
    }

    if (options.llm) {
      const text = await core.askWithOptionalSearch(options.question, options)
      return { action: 'direct_llm', answer: text }
    }

    const executed = await executeRoute(options.question, options)
    return { action: executed.route.action, ...executed }
  }

  return {
    answer,
    executeRoute,
    listSearchCache: (overrides = {}) => core.listSearchCache({ ...defaults, ...overrides }, overrides.limit),
    listModels: core.listModelInfo,
    optionsFor: (question, overrides = {}) => createOptions(question, defaults, overrides),
    planRoute,
  }
}

module.exports = {
  createOptions,
  createSamService,
}
