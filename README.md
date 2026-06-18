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
$ node hlquery_ask.js "list all collections"
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
SAM_HOST=127.0.0.1
SAM_PORT=9300
SAM_LLM_BACKEND=node
LLM_BASE_URL=http://127.0.0.1:8080/v1/chat/completions
```

Command-line options override these defaults. Use `node hlquery_ask.js --help` or `node server.js --help` for the complete option lists.

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
- `POST /sam/plan`
- `POST /sam/ask`

## Asking hlquery

### Built-in routing

```bash
$ node hlquery_ask.js "list all collections"
$ node hlquery_ask.js "show server status"
$ node hlquery_ask.js "list documents in music"
$ node hlquery_ask.js "search queen in music"
$ node hlquery_ask.js "show schema for universities"
$ node hlquery_ask.js --dry-run "give me all collections"
```

Use another hlquery endpoint with `--url` or `HLQUERY_URL`:

```bash
$ node hlquery_ask.js --url http://127.0.0.1:9200 "show server status"
```

### Local GGUF models

The default `node` backend looks for the first `.gguf` file in `run/models` or `etc/sam/run/models`. You can also provide an explicit path:

```bash
$ node hlquery_ask.js --list-models
$ node hlquery_ask.js --llm --model-path /path/to/model.gguf "where is Chile?"
```

Use `--llm-gpu auto`, `vulkan`, `cuda`, or `metal` to request GPU acceleration. The default is `off`.

### OpenAI-compatible model server

Start a compatible server separately, then select the `server` backend:

```bash
$ node hlquery_ask.js --llm \
    --llm-backend server \
    --llm-url http://127.0.0.1:8080/v1/chat/completions \
    "where is Chile?"
```

Use `--route-llm` when the model should classify a question into an allowlisted hlquery route before execution.

### Collection-grounded answers

SAM can search one collection or all collections, select relevant documents, and answer from that context:

```bash
$ node hlquery_ask.js --ask-collection music "find a good female singer"
$ node hlquery_ask.js --ask-collection clothing --context-limit 20 "give me wedding ideas"
$ node hlquery_ask.js --ask-all "tell me about universities in the Boston area"
```

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

The package exports its CLI helpers, service, and Express adapter from `src/index.js`. For the browser interface, see [`../samweb/README.md`](../samweb/README.md).
