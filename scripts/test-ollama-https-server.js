#!/usr/bin/env node
const fs = require('fs').promises;
const http = require('http');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');
const { Agent } = require('undici');
const { startServer } = require('./ollama-https-server');

const withMockOllama = async (handler) =>
  new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, () => {
      resolve(server);
    });
    server.on('error', reject);
  });

const makeCerts = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fileexp-cert-'));
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, { days: 1, keySize: 2048, algorithm: 'sha256' });
  const certPath = path.join(dir, 'cert.pem');
  const keyPath = path.join(dir, 'key.pem');
  await fs.writeFile(certPath, pems.cert, 'utf8');
  await fs.writeFile(keyPath, pems.private, 'utf8');
  return { dir, certPath, keyPath };
};

const postTranslate = async ({ port, ca, text }) => {
  const dispatcher = new Agent({ connect: { ca } });
  const response = await fetch(`https://localhost:${port}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, target: 'en' }),
    dispatcher
  });
  const body = await response.json();
  return { status: response.status, body };
};

const run = async () => {
  const { certPath, keyPath } = await makeCerts();
  const ca = await fs.readFile(certPath, 'utf8');

  const successServer = await withMockOllama((req, res) => {
    if (req.url === '/api/generate') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: 'Translated name' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const successPort = successServer.address().port;

  process.env.OLLAMA_URL = `http://localhost:${successPort}`;
  process.env.OLLAMA_HTTPS_PORT = '0';
  process.env.CERT_PATH = certPath;
  process.env.KEY_PATH = keyPath;
  process.env.OLLAMA_HTTPS_LOG_LEVEL = 'error';

  const httpsServer = await startServer();
  const address = httpsServer.address();
  const httpsPort = typeof address === 'object' && address ? address.port : 0;

  const successResponse = await postTranslate({
    port: httpsPort,
    ca,
    text: '日本語'
  });

  if (!successResponse.body.ok || successResponse.body.translated !== 'Translated name') {
    throw new Error(`Unexpected success response: ${JSON.stringify(successResponse.body)}`);
  }

  await new Promise((resolve) => httpsServer.close(resolve));
  await new Promise((resolve) => successServer.close(resolve));

  const failureServer = await withMockOllama((req, res) => {
    if (req.url === '/api/generate') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Boom' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const failurePort = failureServer.address().port;
  process.env.OLLAMA_URL = `http://localhost:${failurePort}`;
  process.env.OLLAMA_HTTPS_PORT = '0';

  const httpsServerFail = await startServer();
  const failAddress = httpsServerFail.address();
  const httpsFailPort = typeof failAddress === 'object' && failAddress ? failAddress.port : 0;

  const failureResponse = await postTranslate({
    port: httpsFailPort,
    ca,
    text: '日本語'
  });

  if (failureResponse.status !== 500 || failureResponse.body.ok !== false) {
    throw new Error(`Unexpected failure response: ${JSON.stringify(failureResponse.body)}`);
  }

  await new Promise((resolve) => httpsServerFail.close(resolve));
  await new Promise((resolve) => failureServer.close(resolve));

  console.log('Ollama HTTPS server tests passed.');
};

run().catch((error) => {
  console.error('Ollama HTTPS server tests failed:', error);
  process.exit(1);
});
