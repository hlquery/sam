# hlquery Natural Query Utility

This directory contains standalone helper scripts and the SAM HTTP API for asking hlquery natural-language questions.

It is not wired into the hlquery core server. It runs as a sidecar and calls the existing hlquery HTTP API.

The old terminal entry point is still supported:

```sh
node etc/sam/hlquery_ask.js "list all collections"
```

The implementation now lives under `etc/sam/src`:

- `src/cli.js` contains the command-line behavior.
- `src/service.js` exposes a programmatic SAM service for later Node/Express use.
- `src/express.js` exposes an optional Express router adapter.
- `src/index.js` exports the public CommonJS API.

Start the SAM HTTP API sidecar:

```sh
cd etc/sam
npm install
npm run server
```

The server listens on `http://127.0.0.1:9300/sam` by default and uses `HLQUERY_URL=http://127.0.0.1:9200` unless overridden.

Run with request/debug logs:

```sh
node server.js --debug
node server.js --debug --port 9310 --url http://127.0.0.1:9200
```

## Download Qwen

Download the default Qwen2.5 14B GGUF model into `run/models` relative to your current directory. This default is the stronger `Q6_K_L` quantization and is about 12.5 GB:

```sh
perl etc/sam/download_qwen.pl
```

Choose a destination or model preset:

```sh
perl etc/sam/download_qwen.pl --model qwen_14 --dir run/models
perl etc/sam/download_qwen.pl --model qwen_14_q4 --dir run/models
perl etc/sam/download_qwen.pl --model qwen_1_5 --dir run/models
perl etc/sam/download_qwen.pl --model qwen_coder_1_5 --dir run/models
```

The downloader checks available disk space before starting known large presets.

Start a local OpenAI-compatible llama.cpp server separately, for example:

```sh
llama-server -m run/models/Qwen2.5-14B-Instruct-Q6_K_L.gguf --port 8080
```

## Ask hlquery

No model is required for the built-in route matcher:

```sh
node etc/sam/hlquery_ask.js "list all collections"
node etc/sam/hlquery_ask.js "show server status"
node etc/sam/hlquery_ask.js "list documents in music"
node etc/sam/hlquery_ask.js "search queen in music"
node etc/sam/hlquery_ask.js "show schema for universities"
node etc/sam/hlquery_ask.js --dry-run "give me all collections"
```

Use a different hlquery server:

```sh
HLQUERY_URL=http://127.0.0.1:9200 node etc/sam/hlquery_ask.js "give me all collections"
```

For direct general questions unrelated to the database, `--llm` uses the internal Node llama backend by default. From the repo root, install the optional helper dependency once:

```sh
npm --prefix etc/sam install
```

Then download a model if needed:

```sh
perl etc/sam/download_qwen.pl
```

Now ask without passing a model path. The script searches `run/models` and `etc/sam/run/models` for a `.gguf` file:

```sh
node etc/sam/hlquery_ask.js --llm "where is Chile?"
```

Check which local GGUF model the script would choose:

```sh
node etc/sam/hlquery_ask.js --list-models
```

Ask a model to answer from documents in a specific collection. The script searches the collection first, passes matching documents as context, and asks the model to recommend or answer only from those documents:

```sh
node etc/sam/hlquery_ask.js --ask-collection music "find a good female singer"
node etc/sam/hlquery_ask.js --debug --ask-collection music "find a good female singer"
node etc/sam/hlquery_ask.js --ask-collection clothing "give me wedding ideas"
node etc/sam/hlquery_ask.js --ask-collection clothing --context-limit 20 "give me wedding ideas"
node etc/sam/hlquery_ask.js --ask-collection universities "universities near a city"
node etc/sam/hlquery_ask.js --ask-all "find a good female singer"
node etc/sam/hlquery_ask.js --debug --ask-all "tell me about universities in the Boston area"
```

For open-ended collection questions, the helper reads collection field hints, asks the configured LLM to rewrite the question into broad lexical search terms, then queries hlquery. If search is sparse, it supplements results with a bounded document scan and reranks candidates locally, weighting the user's original words above LLM-expanded terms. Set `HLQUERY_ASK_LLM_REWRITE=0` to disable the rewrite step.

`--debug` prints the derived search query, hlquery API calls, fallback behavior, document scores, and selected context to stderr. Normal output stays on stdout.

To use an OpenAI-compatible model server instead:

```sh
LLM_BASE_URL=http://127.0.0.1:8080/v1/chat/completions \
node etc/sam/hlquery_ask.js --llm --llm-backend server "where is Chile?"
```

Use a local OpenAI-compatible model server to classify a request into an allowlisted hlquery route first:

```sh
LLM_BASE_URL=http://127.0.0.1:8080/v1/chat/completions \
node etc/sam/hlquery_ask.js --route-llm "give me all collections"
```

## Use from Node or Express

The package can be imported without going through the CLI:

```js
const { createSamService } = require('./etc/sam')

const sam = createSamService({
  url: 'http://127.0.0.1:9200',
  token: process.env.HLQUERY_TOKEN || '',
})

const result = await sam.answer('give me all collections')
console.log(result)
```

Mount the optional Express router in an app that already uses JSON bodies:

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

The router exposes `GET /sam/models`, `POST /sam/plan`, and `POST /sam/ask`.
