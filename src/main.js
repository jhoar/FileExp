const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { parse } = require('shell-quote');
const translationCache = new Map();
let translateClient = null;
const translationQueue = [];
let isProcessingTranslations = false;
let translationConfig = {
  batchSize: 100,
  batchDelayMs: 1000,
  rateLimitDelayMs: 5000
};

const isJapanese = (value) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(value);

const loadTranslateClient = async () => {
  if (translateClient) return translateClient;
  const module = await import('@vitalets/google-translate-api');
  const candidate = module.default || module;
  translateClient = candidate.translate || candidate;
  return translateClient;
};

const getTranslatorName = () => '@vitalets/google-translate-api';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeTranslationConfig = (config) => {
  const parsed = { ...translationConfig, ...config };
  parsed.batchSize = Number.isFinite(parsed.batchSize) ? Math.max(1, parsed.batchSize) : 100;
  parsed.batchDelayMs = Number.isFinite(parsed.batchDelayMs)
    ? Math.max(0, parsed.batchDelayMs)
    : 1000;
  parsed.rateLimitDelayMs = Number.isFinite(parsed.rateLimitDelayMs)
    ? Math.max(0, parsed.rateLimitDelayMs)
    : 5000;
  return parsed;
};

const setTranslationConfig = (config) => {
  translationConfig = normalizeTranslationConfig(config);
  console.info('Translation config updated', translationConfig);
};

const translateFilename = async (filename) => {
  const extension = path.extname(filename);
  const baseName = extension ? filename.slice(0, -extension.length) : filename;

  if (!isJapanese(baseName)) {
    console.info('Translation skipped (no Japanese characters)', {
      original: filename,
      baseName,
      translator: getTranslatorName()
    });
    return { original: filename, translated: null };
  }

  if (translationCache.has(baseName)) {
    const cached = translationCache.get(baseName);
    console.info('Translation cache hit', {
      original: filename,
      baseName,
      translated: cached,
      translator: getTranslatorName()
    });
    return { original: filename, translated: cached ? `${cached}${extension}` : null };
  }

  console.info('Translation request', {
    original: filename,
    baseName,
    translator: getTranslatorName()
  });

  try {
    const translate = await loadTranslateClient();
    const result = await translate(baseName, { to: 'en' });
    console.info('Translation response', {
      original: filename,
      translated: result.text,
      translator: getTranslatorName()
    });
    translationCache.set(baseName, result.text);
    return { original: filename, translated: `${result.text}${extension}` };
  } catch (error) {
    const statusCode = error?.response?.status || error?.status || error?.code;
    console.info('Translation error', {
      original: filename,
      translator: getTranslatorName(),
      error: error.message,
      statusCode
    });
    const isRateLimited = statusCode === 429 || `${statusCode}` === '429';
    if (isRateLimited) {
      return { original: filename, translated: null, rateLimited: true, error: error.message };
    }
    return { original: filename, translated: null, error: error.message };
  }
};

const scheduleTranslationProcessing = () => {
  if (isProcessingTranslations) return;
  if (translationQueue.length === 0) return;
  isProcessingTranslations = true;

  const processQueue = async () => {
    while (translationQueue.length > 0) {
      const batch = translationQueue.splice(0, translationConfig.batchSize);
      let rateLimited = false;
      const retryItems = [];

      await Promise.all(
        batch.map(async (item) => {
          const result = await translateFilename(item.filename);
          if (result?.rateLimited) {
            rateLimited = true;
            retryItems.push(item);
            return;
          }
          item.resolve(result);
        })
      );

      if (retryItems.length > 0) {
        translationQueue.unshift(...retryItems);
      }

      if (translationQueue.length === 0) break;

      if (rateLimited) {
        await wait(translationConfig.rateLimitDelayMs);
      } else if (translationConfig.batchDelayMs > 0) {
        await wait(translationConfig.batchDelayMs);
      }
    }

    isProcessingTranslations = false;

    if (translationQueue.length > 0) {
      scheduleTranslationProcessing();
    }
  };

  processQueue();
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));
};

app.whenReady().then(() => {
  setTranslationConfig({
    batchSize: Number(process.env.FILEEXP_TRANSLATION_BATCH_SIZE),
    batchDelayMs: Number(process.env.FILEEXP_TRANSLATION_BATCH_DELAY_MS),
    rateLimitDelayMs: Number(process.env.FILEEXP_TRANSLATION_RATE_LIMIT_DELAY_MS)
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('list-directory', async (_event, directoryPath) => {
  const resolved = path.resolve(directoryPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const mapped = entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    fullPath: path.join(resolved, entry.name)
  }));
  return { directory: resolved, entries: mapped };
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('get-initial-directory', () => app.getPath('home'));

ipcMain.handle('set-translation-config', (_event, config) => {
  if (config && typeof config === 'object') {
    setTranslationConfig(config);
  }
  return translationConfig;
});

ipcMain.handle('open-file', async (_event, { filePath, program, args }) => {
  if (!program || program.trim().length === 0) {
    return { ok: false, message: 'Program path is required.' };
  }

  const parsedArgs = Array.isArray(args)
    ? args
    : parse(args || '').filter((item) => typeof item === 'string');

  return new Promise((resolve) => {
    const child = spawn(program, [...parsedArgs, filePath], {
      detached: true,
      stdio: 'ignore'
    });

    child.on('error', (error) => {
      resolve({ ok: false, message: error.message });
    });

    child.unref();
    resolve({ ok: true });
  });
});

ipcMain.handle('translate-filename', async (_event, filename) =>
  new Promise((resolve) => {
    translationQueue.push({ filename, resolve });
    scheduleTranslationProcessing();
  })
);
