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

const buildPrompt = (text, target) =>
  `Translate the following filename into ${target}. ` +
  `Respond with only the translated filename and no extra text.\n\n` +
  `${text}`;

const callOllama = async ({ text, target }) => {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: buildPrompt(text, target),
      stream: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Ollama request failed with ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const data = await response.json();
  return data.response?.trim() || '';
};

const startServer = async () => {
  const [cert, key] = await Promise.all([
    fs.readFile(CERT_PATH, 'utf8'),
    fs.readFile(KEY_PATH, 'utf8')
  ]);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, model: OLLAMA_MODEL });
  });

  app.post('/translate', async (req, res) => {
    const { text, target = 'en' } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, message: 'text is required' });
    }

    try {
      const translated = await callOllama({ text, target });
      return res.json({ ok: true, translated });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: error.message,
        status: error.status,
        body: error.body
      });
    }
  });

  const server = https.createServer({ key, cert }, app);
  server.listen(PORT, () => {
    console.log(`Ollama HTTPS translation server listening on https://localhost:${PORT}`);
  });
};

startServer().catch((error) => {
  console.error('Failed to start HTTPS server:', error);
  process.exit(1);
});
