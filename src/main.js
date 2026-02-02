const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const { parse } = require('shell-quote');
const translate = require('@vitalets/google-translate-api');

const translationCache = new Map();

const isJapanese = (value) => /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9faf]/.test(value);

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

ipcMain.handle('translate-filename', async (_event, filename) => {
  if (!isJapanese(filename)) {
    return { original: filename, translated: null };
  }

  if (translationCache.has(filename)) {
    return { original: filename, translated: translationCache.get(filename) };
  }

  try {
    const result = await translate(filename, { to: 'en' });
    translationCache.set(filename, result.text);
    return { original: filename, translated: result.text };
  } catch (error) {
    return { original: filename, translated: null, error: error.message };
  }
});
