# NARGIS Qwen — local desktop AI

A Windows-friendly holographic assistant UI using Electron + Node.js + Ollama. It uses your local `qwen2.5:3b` and `qwen2.5:7b` models; no OpenAI API key is needed.

## Requirements
- Windows 10/11 (also likely to work on macOS/Linux)
- Node.js 20+ recommended
- Ollama installed and running
- At least one Qwen model pulled locally

## 1. Check Ollama
Open PowerShell or Command Prompt:

```powershell
ollama list
ollama run qwen2.5:3b
```

If needed, pull the models:

```powershell
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b
```

Quit the interactive `ollama run` session with `/bye`; Ollama should keep its local service running.

## 2. Install and launch NARGIS
Extract this ZIP, open a terminal in the `NARGIS-Qwen` folder, then run:

```powershell
npm install
npm start
```

NARGIS connects to `http://127.0.0.1:11434`. If Ollama is using a different HTTP(S) host/port, set `OLLAMA_HOST` before launching. Credentials are not accepted in this URL.

## 3. Use it
- Select Qwen 3B or 7B in the model selector.
- Type a message and press Enter, or click the microphone and speak.
- Turn on **Voice replies** to hear assistant responses.
- Click **Clear** to start a fresh conversation.
- Click **Check system** to test Ollama and list available models.
- Responses stream into the chat; click **Stop** to cancel an active generation.

## Voice notes
Voice input uses the browser SpeechRecognition API when available (usually works best on Windows). If your Electron build does not support it, use text input. Speech output uses the built-in Web Speech API.

## Troubleshooting
- **Ollama offline:** open the Ollama app or run `ollama serve`, then click Check system.
- **Model missing:** run `ollama pull qwen2.5:3b` or `ollama pull qwen2.5:7b`; ensure the exact name appears in `ollama list`.
- **Model downloads:** Qwen models can require several gigabytes of disk space. NARGIS never downloads models automatically.
- **Slow responses:** use Qwen 3B, shorten the conversation, or close other apps that use RAM/VRAM.
- **Blank window:** check Node.js and npm versions, then run `npm install` again.

## Safety / scope
This starter project is a chat assistant, not a fully autonomous computer controller. It does not run arbitrary shell commands or delete/change files. Treat model output as untrusted. You can add explicit, allowlisted tools later.
