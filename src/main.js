const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');

const OLLAMA_BASE = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const allowedModels = new Set(['qwen2.5:3b', 'qwen2.5:7b']);
const activeRequests = new Map();
let mainWindow;

function getOllamaUrl() {
  const url = new URL(OLLAMA_BASE);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('OLLAMA_HOST must be an HTTP(S) URL without credentials.');
  }
  return url;
}

function validateMessages(messages) {
  if (!Array.isArray(messages)) throw new Error('Messages must be an array.');
  return messages
    .filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-24)
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#030911',
    title: 'NARGIS // QWEN LOCAL INTELLIGENCE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
}

app.whenReady().then(() => {
  try {
    getOllamaUrl();
  } catch (error) {
    console.error(error.message);
  }

  ipcMain.handle('ollama:status', async () => {
    try {
      const base = getOllamaUrl().toString().replace(/\/$/, '');
      const [tagsRes, versionRes] = await Promise.all([
        fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) }),
        fetch(`${base}/api/version`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      ]);
      if (!tagsRes.ok) throw new Error(`Ollama returned HTTP ${tagsRes.status}`);
      const tags = await tagsRes.json();
      const version = versionRes && versionRes.ok ? (await versionRes.json()).version : 'unknown';
      return { ok: true, version, models: (tags.models || []).map(m => m.name), host: base };
    } catch (err) {
      return { ok: false, error: `${err.message}. Is Ollama running?`, host: OLLAMA_BASE };
    }
  });

  ipcMain.on('ollama:chat:start', async (event, payload) => {
    const requestId = typeof payload?.requestId === 'string' ? payload.requestId : '';
    if (!requestId || activeRequests.has(requestId)) {
      event.sender.send('ollama:chat:error', { requestId, error: 'Invalid or duplicate request ID.' });
      return;
    }

    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    let selectedModel = 'qwen2.5:3b';
    try {
      const base = getOllamaUrl().toString().replace(/\/$/, '');
      const model = allowedModels.has(payload?.model) ? payload.model : selectedModel;
      selectedModel = model;
      const cleanMessages = validateMessages(payload?.messages);

    if (!cleanMessages.some(m => m.role === 'user')) {
      throw new Error('Please enter a message first.');
    }

    const response = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: cleanMessages,
        stream: true,
        options: { temperature: 0.7, num_ctx: 8192 }
      }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)])
    });

    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status}: ${details.slice(0, 300)}`);
    }
      if (!response.body) throw new Error('Ollama returned an empty response stream.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let responseModel = model;
      let emittedText = false;
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let data;
          try { data = JSON.parse(line); } catch { throw new Error('Ollama returned malformed streaming data.'); }
          if (data.error) throw new Error(data.error);
          responseModel = data.model || responseModel;
          const text = typeof data.message?.content === 'string' ? data.message.content : '';
          if (text) {
            emittedText = true;
            event.sender.send('ollama:chat:chunk', { requestId, text });
          }
          if (data.done) {
            event.sender.send('ollama:chat:done', { requestId, model: responseModel, empty: !emittedText });
            return;
          }
        }
        if (done) break;
      }
      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          responseModel = data.model || responseModel;
          if (data.message?.content) {
            emittedText = true;
            event.sender.send('ollama:chat:chunk', { requestId, text: data.message.content });
          }
        } catch { throw new Error('Ollama returned incomplete streaming data.'); }
      }
      event.sender.send('ollama:chat:done', { requestId, model: responseModel, empty: !emittedText });
    } catch (err) {
      let error = controller.signal.aborted ? 'Generation cancelled.' : (err?.message || String(err));
      if (/not found|model .* does not exist/i.test(error)) {
        error += ` Install it with: ollama pull ${selectedModel}`;
      }
      event.sender.send('ollama:chat:error', { requestId, error });
    } finally {
      activeRequests.delete(requestId);
    }
  });
  ipcMain.on('ollama:chat:cancel', (_event, requestId) => {
    if (typeof requestId === 'string') activeRequests.get(requestId)?.abort();
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
