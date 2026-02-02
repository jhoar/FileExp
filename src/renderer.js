const fileList = document.getElementById('fileList');
const currentPathInput = document.getElementById('currentPath');
const browseButton = document.getElementById('browse');
const refreshButton = document.getElementById('refresh');
const programPathInput = document.getElementById('programPath');
const programArgsInput = document.getElementById('programArgs');
const saveConfigButton = document.getElementById('saveConfig');
const status = document.getElementById('status');

const STATE_KEY = 'fileexp_open_config';

const setStatus = (message, type = 'info') => {
  status.textContent = message;
  status.dataset.type = type;
};

const loadConfig = () => {
  const saved = window.localStorage.getItem(STATE_KEY);
  if (!saved) return;
  try {
    const { program, args } = JSON.parse(saved);
    programPathInput.value = program || '';
    programArgsInput.value = args || '';
  } catch (error) {
    console.warn('Failed to load config', error);
  }
};

const saveConfig = () => {
  const payload = {
    program: programPathInput.value.trim(),
    args: programArgsInput.value.trim()
  };
  window.localStorage.setItem(STATE_KEY, JSON.stringify(payload));
  setStatus('Open command saved.', 'success');
};

const getOpenConfig = () => ({
  program: programPathInput.value.trim(),
  args: programArgsInput.value.trim()
});

const renderEntries = async (directory, entries) => {
  fileList.innerHTML = '';
  currentPathInput.value = directory;

  for (const entry of entries) {
    const listItem = document.createElement('li');
    listItem.className = entry.isDirectory ? 'entry entry--dir' : 'entry';
    listItem.dataset.path = entry.fullPath;
    listItem.dataset.isdir = entry.isDirectory ? 'true' : 'false';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = entry.name;
    nameSpan.className = 'entry__name';

    listItem.appendChild(nameSpan);

    if (!entry.isDirectory) {
      const translated = document.createElement('span');
      translated.className = 'entry__translation';
      listItem.appendChild(translated);

      window.fileExp.translateFilename(entry.name).then((result) => {
        if (result?.translated) {
          translated.textContent = `(${result.translated})`;
        }
      });
    }

    fileList.appendChild(listItem);
  }
};

const loadDirectory = async (directoryPath) => {
  try {
    setStatus('Loading...', 'info');
    const result = await window.fileExp.listDirectory(directoryPath);
    const sorted = result.entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    await renderEntries(result.directory, sorted);
    setStatus(`Showing ${sorted.length} entries`, 'success');
  } catch (error) {
    setStatus(`Failed to load: ${error.message}`, 'error');
  }
};

fileList.addEventListener('dblclick', async (event) => {
  const target = event.target.closest('.entry');
  if (!target) return;

  const isDirectory = target.dataset.isdir === 'true';
  const fullPath = target.dataset.path;

  if (isDirectory) {
    loadDirectory(fullPath);
    return;
  }

  const openConfig = getOpenConfig();
  const response = await window.fileExp.openFile({
    filePath: fullPath,
    program: openConfig.program,
    args: openConfig.args
  });

  if (!response.ok) {
    setStatus(response.message || 'Failed to open file.', 'error');
    return;
  }
  setStatus('File opened with custom command.', 'success');
});

browseButton.addEventListener('click', async () => {
  const chosen = await window.fileExp.selectDirectory();
  if (chosen) {
    loadDirectory(chosen);
  }
});

refreshButton.addEventListener('click', () => {
  if (currentPathInput.value.trim()) {
    loadDirectory(currentPathInput.value.trim());
  }
});

saveConfigButton.addEventListener('click', saveConfig);

currentPathInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    loadDirectory(currentPathInput.value.trim());
  }
});

const initialize = async () => {
  loadConfig();
  const initial = await window.fileExp.getInitialDirectory();
  await loadDirectory(initial);
};

initialize();
