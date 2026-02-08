# Ollama HTTPS Translation Service

This repository includes a small HTTPS service that wraps a local Ollama model so
your translation pipeline can call a secure endpoint.

## Prerequisites

- Ollama running locally with the `shisa-v2.1-llama3.2-3b` model pulled.
- Node.js 18+ (for global `fetch`).

## Generate a self-signed certificate

```bash
npm run generate-cert
```

This writes `certs/cert.pem` and `certs/key.pem`. The folder is gitignored.

## Start the HTTPS server

```bash
npm run start-ollama-https
```

The server listens on `https://localhost:8443`.

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `OLLAMA_HTTPS_PORT` | `8443` | HTTPS port for the server |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama base URL |
| `OLLAMA_MODEL` | `shisa-v2.1-llama3.2-3b` | Model name to use |
| `CERT_DIR` | `certs` | Directory that stores `cert.pem`/`key.pem` |
| `CERT_PATH` | `certs/cert.pem` | Custom cert path |
| `KEY_PATH` | `certs/key.pem` | Custom key path |
| `CERT_COMMON_NAME` | `localhost` | Used by the cert generator |
| `OLLAMA_HTTPS_LOG_LEVEL` | `info` | Log level: `error`, `warn`, `info`, `debug` |
| `OLLAMA_SUBSTITUTIONS_PATH` | - | JSON substitutions applied before translation |

## Request format

```
POST /translate
Content-Type: application/json

{
  "text": "日本語ファイル名",
  "target": "en"
}
```

Response:

```json
{
  "ok": true,
  "translated": "English filename"
}
```

## Health check

```
GET /health
```

Returns the model name and status.

## Using Ollama from the translation generator

The translation generator supports switching to the Ollama HTTPS endpoint:

```bash
npm run generate-translations -- \
  --input "D:\\Downloads\\Manga" \
  --output translations.json \
  --provider ollama \
  --ollama-endpoint https://localhost:8443/translate \
  --ollama-model shisa-v2.1-llama3.2-3b \
  --ollama-cert certs/cert.pem
```

The generator detects `/translate` endpoints and sends `{ "text": "...", "target": "en" }`.
If you point `--ollama-endpoint` at the native Ollama API (e.g. `http://localhost:11434/api/generate`),
it will send the model/prompt payload instead.

## Standard substitutions (optional)

You can provide a JSON file with text replacements to normalize common phrases before translation.

Example `substitutions.json`:

```json
{
  "DL版": "digital version",
  "ブルーアーカイブ": "Blue Archive"
}
```

Generator usage:

```bash
npm run generate-translations -- \
  --input "D:\\Downloads\\Manga" \
  --output translations.json \
  --provider ollama \
  --ollama-endpoint https://localhost:8443/translate \
  --ollama-model shisa-v2.1-llama3.2-3b \
  --ollama-cert certs/cert.pem \
  --substitutions substitutions.json
```

Server usage:

```bash
OLLAMA_SUBSTITUTIONS_PATH=substitutions.json npm run start-ollama-https
```
