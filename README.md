> **Development Status**: SAM is under active development and is not recommended for production use. Routes, model behavior, and response formats may change without notice.

<div align="center">
  <img src="https://docs.hlquery.com/img/hlquery/2.png" alt="hlquery logo" width="200">
</div>

<div align="center">

**A natural-language query service and CLI for hlquery.**

[![Follow hlquery](https://img.shields.io/badge/Follow-%40hlquery-blue?logo=x&logoColor=white&labelColor=000000)](https://x.com/hlquery)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white&labelColor=000000)](https://nodejs.org/)
[![API](https://img.shields.io/badge/API-Express-000000?logo=express&logoColor=white&labelColor=000000)](https://expressjs.com/)
[![License](https://img.shields.io/badge/License-BSD%203--Clause-a35a0f?logo=open-source-initiative&logoColor=white&labelColor=000000)](https://opensource.org/licenses/BSD-3-Clause)

</div>

### What is SAM?

SAM is a standalone natural-language layer for hlquery. It accepts questions through a command-line tool, HTTP API, or Node interface and translates supported requests into calls to the existing hlquery HTTP API.

Built-in route matching handles common database operations without a model. Optional local GGUF or OpenAI-compatible backends add general answers, route classification, and answers grounded in collection documents.

### Why use it?

Use SAM when you want to query hlquery in plain language, prototype model-assisted search without modifying the core server, or embed the same planning and answer behavior in another Node application. It runs as a sidecar, keeping model dependencies and natural-language logic separate from hlquery itself.

### Quick Start

From the repository root:

```bash
$ cd etc/sam/
$ npm install
$ node ask.js "list all collections"
```

No model is required for built-in requests such as collection listing, server status, document listing, search, and schema inspection.

## Detailed Setup

### Prerequisites

**Node.js and npm:**

- Node.js 18.0.0 or higher
- npm 9.0.0 or higher
- A running hlquery server, available at `http://127.0.0.1:9200` by default

For model-backed answers, provide either a local GGUF model for the optional `node-llama-cpp` backend or an OpenAI-compatible chat-completions server.

### Installation

```bash
$ cd etc/sam/
$ npm install
```

### Configuration

Common environment variables include:

```bash
HLQUERY_URL=http://127.0.0.1:9200
HLQUERY_TOKEN=
BRAVE_SEARCH_API_KEY=
SAM_HOST=127.0.0.1
SAM_PORT=9300
SAM_LLM_BACKEND=node
LLM_BASE_URL=http://127.0.0.1:8080/v1/chat/completions
```

Command-line options override these defaults. Use `node ask.js --help` or `node server.js --help` for the complete option lists.

### Running the SAM API

```bash
$ npm run server
```

The server listens at `http://127.0.0.1:9300/sam` and targets hlquery at `http://127.0.0.1:9200` by default.

Custom examples:

```bash
$ node server.js --debug
$ node server.js --port 9310 --url http://127.0.0.1:9200
$ node server.js --llm-backend server \
    --llm-url http://127.0.0.1:8080/v1/chat/completions
```

The API exposes:

- `GET /sam/models`
- `GET /sam/cache/search`
- `POST /sam/plan`
- `POST /sam/ask`

### Reusing already-fetched documents

`POST /sam/ask` can answer from documents that a client already has in memory. Pass them as `options.contextDocuments`; SAM validates, deduplicates, ranks, and compacts this context locally instead of fetching the same collection again. Up to 200 candidates and 750 KiB are accepted by the service, after which the normal `contextLimit` controls how many documents reach the model.

```bash
curl -X POST http://127.0.0.1:9300/sam/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Summarize and improve these results",
    "options": {
      "askCollection": "universities",
      "contextDocuments": [
        {"id":"u-1","name":"Example University","state":"Chile"}
      ],
      "contextCollection": "universities",
      "contextQuery": "universities in Chile",
      "contextSource": "my-fetched-results",
      "preferProvidedContext": true,
      "contextLimit": 12
    }
  }'
```

When reusable context is used, the response has `action: "ask_provided_context"` and `context.reusedFetchedDocuments: true`. Set `preferProvidedContext: false` to ignore the supplied documents and run the usual hlquery retrieval pipeline.

## Asking hlquery

### Built-in routing

```bash
$ node ask.js "list all collections"
$ node ask.js "show server status"
$ node ask.js "list documents in music"
$ node ask.js "search queen in music"
$ node ask.js "show schema for universities"
$ node ask.js --raw "whats the capital of lima"
$ node ask.js --dry-run "give me all collections"
```

Use `--raw` for a direct model-backed answer when the question should not be mapped to an hlquery route.

Use another hlquery endpoint with `--url` or `HLQUERY_URL`:

```bash
$ node ask.js --url http://127.0.0.1:9200 "show server status"
```

`ask.js` is a one-shot command: after a supplied question succeeds or fails,
SAM closes its Redis and local-model resources and exits. Only `server.js` is
intended to remain running for multiple requests.

### Local GGUF models

The default `node` backend looks for the first `.gguf` file in `run/models` or `etc/sam/run/models`. You can also provide an explicit path:

```bash
$ node ask.js --list-models
$ node ask.js --llm --model-path /path/to/model.gguf "where is Chile?"
```

Use `--llm-gpu auto`, `vulkan`, `cuda`, or `metal` to request GPU acceleration. The default is `off`.

### OpenAI-compatible model server

Start a compatible server separately, then select the `server` backend:

```bash
$ node ask.js --llm \
    --llm-backend server \
    --llm-url http://127.0.0.1:8080/v1/chat/completions \
    "where is Chile?"
```

Use `--route-llm` when the model should classify a question into an allowlisted hlquery route before execution.

### Optional Brave Search fallback

`--search` enables a single Brave web-search fallback for model-backed answers. SAM first asks the model whether it has enough reliable information. It calls Brave only when the model requests external information, then asks the model to answer from the returned results.

```bash
$ BRAVE_SEARCH_API_KEY=your-token node ask.js --search "what happened in Chile today?"
```

The token can be placed in the optional `BRAVE_SEARCH_API_KEY` constant near the top of `ask.js`, or read from the `BRAVE_SEARCH_API_KEY`/`BRAVE_API_KEY` environment variables. It is sent in Brave's `X-Subscription-Token` header. If `--search` is used without a token, SAM exits immediately with `No API key provided.`

### Redis search cache

SAM records successful Brave searches and hlquery document searches in Redis when Redis is available. Cache keys use the `sam::cache::search:*` prefix, and recent keys are tracked in `sam::cache::search:index`.

On a new search SAM first checks for an exact cached request. If there is no exact hit, it scans recent cached searches, scores query-token overlap, and can reuse the best sufficiently similar result before calling Brave or hlquery again. hlquery document-search reuse is limited to the same base URL, method, and collection search path.

```bash
$ redis-server
$ SAM_REDIS_URL=redis://127.0.0.1:6379 node ask.js "search queen in music"
$ curl http://127.0.0.1:9300/sam/cache/search?limit=20
```

Configure the cache with `SAM_REDIS_URL`, `REDIS_URL`, and `SAM_SEARCH_CACHE_TTL_SECONDS`. Set `SAM_SEARCH_CACHE=0` or pass `--no-search-cache` to skip Redis for a run.

Similar-search reuse is enabled by default. Tune it with `SAM_SEARCH_CACHE_MIN_SCORE` or `--search-cache-min-score`; disable it with `SAM_SEARCH_CACHE_SIMILAR=0` or `--no-search-cache-similar`.

### Collection-grounded answers

SAM can search one collection or all collections, select relevant documents, and answer from that context:

```bash
$ node ask.js --ask-collection music "find a good female singer"
$ node ask.js --ask-collection clothing --context-limit 20 "give me wedding ideas"
$ node ask.js --ask-collection universities "universities where it snows"
$ node ask.js --ask-all "tell me about universities in the Boston area"
```

`--search` enables the fallback pipeline: when literal collection search finds no useful evidence, SAM scans and compactly supplies up to 100 collection documents to the LLM for semantic inference. It permits one Brave fallback only if the model still reports insufficient information. Without `--search`, neither fallback is activated.

Add `--debug` to print query expansion, API calls, fallback scans, scoring, and context selection to stderr while keeping the final answer on stdout.

## Use from Node or Express

Create a service directly:

```js
const { createSamService } = require('./etc/sam')

const sam = createSamService({
  url: 'http://127.0.0.1:9200',
  token: process.env.HLQUERY_TOKEN || '',
})

const result = await sam.answer('give me all collections')
console.log(result)
```

Or mount the router in an Express application:

```js
const express = require('express')
const { createSamRouter } = require('./etc/sam')

const app = express()
app.use(express.json())
app.use('/sam', createSamRouter(express, {
  url: 'http://127.0.0.1:9200',
  token: process.env.HLQUERY_TOKEN || '',
}))
```

The package exports its CLI helpers, service, and Express adapter from `src/index.js`.
