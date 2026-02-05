#!/usr/bin/env node
const fs = require('fs').promises;
const path = require('path');

const isJapanese = (value) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(value);

const loadGoogleTranslateClient = async () => {
  const module = await import('@vitalets/google-translate-api');
  const candidate = module.default || module;
  return candidate.translate || candidate;
};

const buildOllamaPrompt = (text, target) =>
  `Translate the following filename into ${target}. ` +
  `Respond with only the translated filename and no extra text.\n\n` +
  `${text}`;

const createOllamaClient = ({ endpoint, model, certPath }) => {
  if (!endpoint) {
    throw new Error('Ollama endpoint is required.');
  }

  return async (text, target) => {
    const url = new URL(endpoint);
    const isHttps = url.protocol === 'https:';
    let dispatcher;

    if (isHttps && certPath) {
      const { Agent } = require('undici');
      dispatcher = new Agent({
        connect: {
          ca: await fs.readFile(certPath, 'utf8')
        }
      });
    }

    const isProxyEndpoint = url.pathname.endsWith('/translate');
    const payload = isProxyEndpoint
      ? { text, target }
      : {
          model,
          prompt: buildOllamaPrompt(text, target),
          stream: false
        };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      dispatcher
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(`Ollama request failed with ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    const data = await response.json();
    if (isProxyEndpoint) {
      return data.translated?.trim() || '';
    }
    return data.response?.trim() || '';
  };
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (argv) => {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    args[key] = value;
    i += 1;
  }
  return args;
};

const usage = () => {
  console.log(`Usage: node scripts/generate-translations.js --input <dir> --output <file> [options]

Options:
  --provider <google|ollama> Translate provider (default: google)
  --ollama-endpoint <url>    Ollama HTTPS endpoint (default: https://localhost:8443/translate)
  --ollama-model <name>      Ollama model (default: shisa-v2.1-llama3.2-3b)
  --ollama-cert <path>       Path to CA cert to trust self-signed Ollama HTTPS
  --batch-size <n>         Number of files per translation batch (default: 100)
  --batch-delay <ms>       Delay between batches in ms (default: 1000)
  --rate-limit-delay <ms>  Delay after 429 errors in ms (default: 5000)
`);
};

const walkFiles = async (dir) => {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
};

const loadExistingDb = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.entries)
        ? parsed.entries
        : [];
    return { entries };
  } catch (error) {
    return { entries: [] };
  }
};

const updateEntry = (entryMap, filePath, payload) => {
  const existing = entryMap.get(filePath) || {};
  entryMap.set(filePath, { ...existing, ...payload });
};

const run = async () => {
  const args = parseArgs(process.argv);
  const inputDir = args.input;
  const outputFile = args.output;
  if (!inputDir || !outputFile) {
    usage();
    process.exit(1);
  }

  const batchSize = Math.max(1, Number(args['batch-size'] || 100));
  const batchDelayMs = Math.max(0, Number(args['batch-delay'] || 1000));
  const rateLimitDelayMs = Math.max(0, Number(args['rate-limit-delay'] || 5000));
  const provider = (args.provider || 'google').toLowerCase();
  const ollamaEndpoint = args['ollama-endpoint'] || 'https://localhost:8443/translate';
  const ollamaModel = args['ollama-model'] || 'shisa-v2.1-llama3.2-3b';
  const ollamaCert = args['ollama-cert'];

  const { entries: existingEntries } = await loadExistingDb(outputFile);
  const entryMap = new Map();
  existingEntries.forEach((entry) => {
    if (entry?.file_path) {
      entryMap.set(entry.file_path, entry);
    }
  });

  const files = await walkFiles(inputDir);
  const toTranslate = [];

  for (const filePath of files) {
    const fileName = path.basename(filePath);
    const extension = path.extname(fileName);
    const baseName = extension ? fileName.slice(0, -extension.length) : fileName;
    const existing = entryMap.get(filePath);

    if (existing && existing.file_name === fileName && existing.status === 'translated') {
      continue;
    }

    if (!isJapanese(baseName)) {
      updateEntry(entryMap, filePath, {
        file_path: filePath,
        file_name: fileName,
        translated_name: null,
        status: 'skipped',
        error_message: null,
        updated_at: new Date().toISOString()
      });
      continue;
    }

    toTranslate.push({ filePath, fileName, baseName, extension });
  }

  if (toTranslate.length === 0) {
    const output = {
      generatedAt: new Date().toISOString(),
      entries: Array.from(entryMap.values())
    };
    await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
    console.log('No files needed translation. Database updated.');
    return;
  }

  const translate =
    provider === 'ollama'
      ? await createOllamaClient({
          endpoint: ollamaEndpoint,
          model: ollamaModel,
          certPath: ollamaCert
        })
      : await loadGoogleTranslateClient();

  for (let i = 0; i < toTranslate.length; i += batchSize) {
    const batch = toTranslate.slice(i, i + batchSize);
    let pending = batch;
    while (pending.length > 0) {
      const results = await Promise.all(
        pending.map(async (item) => {
          try {
            const translatedText =
              provider === 'ollama'
                ? await translate(item.baseName, 'en')
                : (await translate(item.baseName, { to: 'en' })).text;
            updateEntry(entryMap, item.filePath, {
              file_path: item.filePath,
              file_name: item.fileName,
              translated_name: `${translatedText}${item.extension}`,
              status: 'translated',
              error_message: null,
              updated_at: new Date().toISOString()
            });
            return { ok: true };
          } catch (error) {
            const statusCode = error?.response?.status || error?.status || error?.code;
            const isRateLimited = statusCode === 429 || `${statusCode}` === '429';
            if (isRateLimited) {
              return { ok: false, rateLimited: true, item };
            }
            updateEntry(entryMap, item.filePath, {
              file_path: item.filePath,
              file_name: item.fileName,
              translated_name: null,
              status: 'failed',
              error_message: error.message,
              updated_at: new Date().toISOString()
            });
            return { ok: false };
          }
        })
      );

      const rateLimitedItems = results
        .filter((result) => result.rateLimited)
        .map((result) => result.item);
      if (rateLimitedItems.length > 0) {
        console.warn('Rate limit hit. Waiting before retry...');
        await wait(rateLimitDelayMs);
        pending = rateLimitedItems;
      } else {
        pending = [];
      }
    }

    if (i + batchSize < toTranslate.length && batchDelayMs > 0) {
      await wait(batchDelayMs);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    entries: Array.from(entryMap.values())
  };
  await fs.writeFile(outputFile, JSON.stringify(output, null, 2));
  console.log(`Translation database saved to ${outputFile}`);
};

run();
