const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { parse } = require('shell-quote');
let translationDbPath = null;
const translationEntries = new Map();

const loadTranslationDb = async (filePath) => {
  const raw = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);
  const entries = Array.isArray(data)
    ? data
    : Array.isArray(data?.entries)
      ? data.entries
      : [];

  translationEntries.clear();
  entries.forEach((entry) => {
    if (entry?.file_path) {
      translationEntries.set(entry.file_path, entry);
    }
  });
  translationDbPath = filePath;
  return { count: entries.length, path: translationDbPath };
};

const getTranslationForPath = (filePath) => {
  const entry = translationEntries.get(filePath);
  if (!entry) {
    return { status: 'missing', translated: null };
  }
  if (entry.status !== 'translated' || !entry.translated_name) {
    return { status: entry.status || 'pending', translated: null, error: entry.error_message };
  }
  return { status: entry.status, translated: entry.translated_name };
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

ipcMain.handle('select-translation-db', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Translation Database', extensions: ['json'] }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('load-translation-db', async (_event, filePath) => {
  if (!filePath) return { ok: false, message: 'No translation database path provided.' };
  try {
    const summary = await loadTranslationDb(filePath);
    return { ok: true, ...summary };
  } catch (error) {
    return { ok: false, message: error.message };
  }
});

ipcMain.handle('get-translation', (_event, filePath) => getTranslationForPath(filePath));

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
