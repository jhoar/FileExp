#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const express = require('express');

const PORT = Number(process.env.OLLAMA_HTTPS_PORT || 8443);
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, '..', 'certs');
const CERT_PATH = process.env.CERT_PATH || path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = process.env.KEY_PATH || path.join(CERT_DIR, 'key.pem');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'shisa-v2.1-llama3.2-3b';
const OLLAMA_SUBSTITUTIONS_PATH = process.env.OLLAMA_SUBSTITUTIONS_PATH;

const LOG_LEVEL = (process.env.OLLAMA_HTTPS_LOG_LEVEL || 'info').toLowerCase();

const shouldLog = (level) => {
  const order = { error: 0, warn: 1, info: 2, debug: 3 };
  return (order[level] ?? 2) <= (order[LOG_LEVEL] ?? 2);
};

const log = (level, message, payload) => {
  if (!shouldLog(level)) return;
  if (payload) {
    console[level](message, payload);
  } else {
    console[level](message);
  }
};

const applySubstitutions = (text, substitutions) => {
  if (!substitutions || Object.keys(substitutions).length === 0) return text;
  let updated = text;
  const orderedKeys = Object.keys(substitutions).sort((a, b) => b.length - a.length);
  orderedKeys.forEach((key) => {
    const value = substitutions[key];
    if (!key) return;
    updated = updated.split(key).join(value);
  });
  return updated;
};

const loadSubstitutions = async (filePath) => {
  if (!filePath) return {};
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    log('warn', 'Failed to load substitutions', { message: error.message, path: filePath });
    return {};
  }
};

const buildPrompt = (text, target) =>
  `Translate the following filename into ${target}. ` +
  `Respond with only the translated filename and no extra text.\n\n` +
  `${text}`;

const callOllama = async ({ text, target, substitutions }) => {
  const normalizedText = applySubstitutions(text, substitutions);
  log('debug', 'Ollama request payload', {
    model: OLLAMA_MODEL,
    target,
    text: normalizedText
  });
  const payload = {
    model: OLLAMA_MODEL,
    prompt: buildPrompt(normalizedText, target),
    stream: false
  };
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Ollama request failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    error.requestBody = payload;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    const parseError = new Error('Ollama response was not valid JSON.');
    parseError.status = response.status;
    parseError.body = body;
    throw parseError;
  }
  return data.response?.trim() || '';
};

const startServer = async () => {
  const [cert, key] = await Promise.all([
    fs.readFile(CERT_PATH, 'utf8'),
    fs.readFile(KEY_PATH, 'utf8')
  ]);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const substitutions = await loadSubstitutions(OLLAMA_SUBSTITUTIONS_PATH);
  if (Object.keys(substitutions).length > 0) {
    log('info', 'Loaded substitutions', { count: Object.keys(substitutions).length });
  }

  app.get('/health', (_req, res) => {
    res.json({ ok: true, model: OLLAMA_MODEL });
  });

  app.post('/translate', async (req, res) => {
    const { text, target = 'en' } = req.body || {};
    if (!text || typeof text !== 'string') {
      log('warn', 'Translation request missing text');
      return res.status(400).json({ ok: false, message: 'text is required' });
    }

    try {
      const translated = await callOllama({ text, target, substitutions });
      log('info', 'Translation success', { target, length: translated.length });
      return res.json({ ok: true, translated });
    } catch (error) {
      log('error', 'Translation failed', {
        message: error.message,
        status: error.status,
        body: error.body,
        requestBody: error.requestBody
      });
      return res.status(error.status || 500).json({
        ok: false,
        message: error.message,
        status: error.status,
        body: error.body
      });
    }
  });

  const server = https.createServer({ key, cert }, app);
  await new Promise((resolve) => {
    server.listen(PORT, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : PORT;
      log('info', `Ollama HTTPS translation server listening on https://localhost:${port}`);
      resolve();
    });
  });

  return server;
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start HTTPS server:', error);
    process.exit(1);
  });
}

module.exports = { startServer };
