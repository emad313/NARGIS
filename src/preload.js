const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nargis', {
  checkStatus: () => ipcRenderer.invoke('ollama:status'),
  openApprovedCommand: (command) => ipcRenderer.invoke('system:open-approved', command),
  transcribe: (payload) => ipcRenderer.invoke('speech:transcribe', payload),
  startChat: (payload) => ipcRenderer.send('ollama:chat:start', payload),
  cancelChat: (requestId) => ipcRenderer.send('ollama:chat:cancel', requestId),
  onChatChunk: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:chunk', listener);
    return () => ipcRenderer.removeListener('ollama:chat:chunk', listener);
  },
  onChatDone: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:done', listener);
    return () => ipcRenderer.removeListener('ollama:chat:done', listener);
  },
  onChatError: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('ollama:chat:error', listener);
    return () => ipcRenderer.removeListener('ollama:chat:error', listener);
  }
});
