const $ = (id) => document.getElementById(id);
const messagesEl = $('chatMessages');
const input = $('messageInput');
const sendBtn = $('sendBtn');
const stopBtn = $('stopBtn');
const modelSelect = $('modelSelect');
let conversation = [];
let busy = false;
let activeRequestId = null;
let activeAssistantBubble = null;
let activeAssistantText = '';
let voiceReplies = false;
let recognition = null;
let listening = false;

const SYSTEM_PROMPT = `You are NARGIS, a capable, calm, concise personal AI assistant inspired by a futuristic cinematic assistant. You run locally on the user's computer using Qwen through Ollama. Be helpful and direct. Use clear formatting when useful. You may speak English or Bangla based on the user's language. Never claim you have performed actions on the computer unless a real tool has confirmed it. You do not have access to the web, files, or operating system unless a tool is explicitly provided. If asked to control the computer, explain what the user can do or ask before suggesting risky steps.`;

function timeNow() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function updateClock() { $('clock').textContent = timeNow(); }
setInterval(updateClock, 1000); updateClock();

function addMessage(role, content, error = false) {
  const row = document.createElement('div');
  row.className = `message ${role === 'user' ? 'user-message' : 'assistant-message'}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'U' : 'N';
  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  meta.textContent = `${role === 'user' ? 'OPERATOR' : 'NARGIS'} `;
  const time = document.createElement('span');
  time.textContent = timeNow();
  meta.appendChild(time);
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (error ? ' error' : '');
  bubble.textContent = content;
  body.append(meta, bubble);
  row.append(avatar, body);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  $('messageCount').textContent = String(conversation.filter(m => m.role !== 'system').length).padStart(2, '0');
  return bubble;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  input.disabled = value;
  stopBtn.hidden = !value;
  sendBtn.hidden = value;
  $('typingRow').hidden = !value;
  $('coreState').textContent = value ? 'PROCESSING REQUEST' : 'AWAITING INPUT';
  $('topStatus').textContent = value ? 'NEURAL CORE PROCESSING' : 'SYSTEM STANDING BY';
}

function speak(text) {
  if (!voiceReplies || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 3500));
  utterance.rate = 1;
  utterance.pitch = 0.92;
  window.speechSynthesis.speak(utterance);
}

function finishRequest() {
  activeRequestId = null;
  activeAssistantBubble = null;
  activeAssistantText = '';
  setBusy(false);
  input.focus();
}

function handleChatChunk(data) {
  if (!busy || data.requestId !== activeRequestId) return;
  activeAssistantText += data.text || '';
  if (activeAssistantBubble) activeAssistantBubble.textContent = activeAssistantText;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function handleChatDone(data) {
  if (data.requestId !== activeRequestId) return;
  if (data.empty || !activeAssistantText) {
    if (activeAssistantBubble) activeAssistantBubble.textContent = '(No text response returned.)';
  } else {
    conversation.push({ role: 'assistant', content: activeAssistantText });
    if (conversation.length > 24) conversation = conversation.slice(-24);
    speak(activeAssistantText);
  }
  $('activeModelValue').textContent = data.model || modelSelect.value;
  $('engineValue').textContent = 'QWEN 2.5';
  finishRequest();
}

function handleChatError(data) {
  if (data.requestId !== activeRequestId) return;
  const message = data.error || 'The local model request failed.';
  if (activeAssistantText) {
    activeAssistantBubble.textContent += `\n\nError: ${message}`;
    activeAssistantBubble.classList.add('error');
  } else if (activeAssistantBubble) {
    activeAssistantBubble.textContent = `Connection error: ${message}\n\nCheck that Ollama is running and that the selected model is installed.`;
    activeAssistantBubble.classList.add('error');
  }
  $('coreState').textContent = message === 'Generation cancelled.' ? 'REQUEST STOPPED' : 'CONNECTION ERROR';
  finishRequest();
}

async function sendMessage(text) {
  const content = (text ?? input.value).trim();
  if (!content || busy) return;
  input.value = '';
  input.style.height = 'auto';
  addMessage('user', content);
  conversation.push({ role: 'user', content });
  if (conversation.length > 24) conversation = conversation.slice(-24);
  setBusy(true);
  activeRequestId = crypto.randomUUID();
  activeAssistantText = '';
  activeAssistantBubble = addMessage('assistant', ' ', false);
  window.nargis.startChat({
    requestId: activeRequestId,
    model: modelSelect.value,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...conversation]
  });
}

sendBtn.addEventListener('click', () => sendMessage());
stopBtn.addEventListener('click', () => {
  if (activeRequestId) window.nargis.cancelChat(activeRequestId);
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 95) + 'px';
});
document.querySelectorAll('.quick-action').forEach(btn => btn.addEventListener('click', () => sendMessage(btn.dataset.prompt)));

modelSelect.addEventListener('change', () => {
  $('activeModelValue').textContent = modelSelect.value;
  $('modelDesc').textContent = modelSelect.value.endsWith(':7b')
    ? 'More capable responses · higher memory use'
    : 'Faster responses · lower memory use';
});

$('voiceToggle').addEventListener('click', () => {
  voiceReplies = !voiceReplies;
  $('voiceToggle').textContent = `VOICE: ${voiceReplies ? 'ON' : 'OFF'}`;
  $('voiceToggle').classList.toggle('active', voiceReplies);
  if (!voiceReplies && 'speechSynthesis' in window) window.speechSynthesis.cancel();
});
$('clearBtn').addEventListener('click', () => {
  if (activeRequestId) window.nargis.cancelChat(activeRequestId);
  conversation = [];
  activeRequestId = null;
  activeAssistantBubble = null;
  activeAssistantText = '';
  setBusy(false);
  messagesEl.innerHTML = '';
  $('messageCount').textContent = '00';
  $('sessionValue').textContent = 'RESET';
  addMessage('assistant', 'Conversation cleared. Neural core is ready for a new session.');
  $('sessionValue').textContent = 'ACTIVE';
});
$('checkBtn').addEventListener('click', checkStatus);

async function checkStatus() {
  $('checkBtn').disabled = true;
  $('checkBtn').textContent = '⟳  SCANNING...';
  $('connectionValue').textContent = 'CHECKING';
  $('connectionLight').style.background = '#e9b65a';
  try {
    const status = await window.nargis.checkStatus();
    $('endpointValue').textContent = status.host.replace(/^https?:\/\//, '');
    if (!status.ok) throw new Error(status.error);
    $('connectionValue').textContent = 'ONLINE';
    $('connectionLight').style.background = '#61ffd0';
    $('connectionLight').style.boxShadow = '0 0 9px #61ffd0';
    $('connectionNote').textContent = `OLLAMA v${status.version}`;
    $('topStatus').textContent = 'OLLAMA LINK ESTABLISHED';
    $('modelList').innerHTML = '';
    if (!status.models.length) {
      $('modelList').innerHTML = '<div class="model-empty">No local models detected. Run ollama pull qwen2.5:3b.</div>';
    } else {
      status.models.forEach(name => {
        const row = document.createElement('div');
        row.className = 'model-item';
        const bullet = document.createElement('span');
        bullet.className = 'model-bullet';
        bullet.textContent = '●';
        const label = document.createElement('span');
        label.textContent = name;
        row.append(bullet, label);
        $('modelList').appendChild(row);
      });
    }
    const selectedExists = status.models.some(name => name === modelSelect.value || name.startsWith(modelSelect.value + '-'));
    $('connectionValue').textContent = selectedExists ? 'ONLINE' : 'ONLINE*';
    $('connectionNote').textContent = selectedExists ? 'MODEL READY' : 'CHECK SELECTED MODEL';
  } catch (err) {
    $('connectionValue').textContent = 'OFFLINE';
    $('connectionLight').style.background = '#ff6f7c';
    $('connectionLight').style.boxShadow = '0 0 9px #ff6f7c';
    $('connectionNote').textContent = 'OLLAMA UNREACHABLE';
    $('topStatus').textContent = 'OLLAMA LINK OFFLINE';
    $('modelList').innerHTML = '';
    const note = document.createElement('div');
    note.className = 'model-empty';
    note.textContent = err.message || 'Could not reach Ollama.';
    $('modelList').appendChild(note);
  } finally {
    $('checkBtn').disabled = false;
    $('checkBtn').textContent = '⟳  CHECK OLLAMA';
  }
}

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    $('voiceInputStatus').textContent = 'AVAILABLE';
    recognition.onstart = () => { listening = true; $('micBtn').classList.add('listening'); $('coreState').textContent = 'LISTENING'; input.placeholder = 'Listening…'; };
    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
      }
      if (finalText.trim()) { input.value = finalText.trim(); sendMessage(); }
    };
    recognition.onerror = (event) => { addMessage('assistant', `Voice input issue: ${event.error}. You can still type your message.`, true); };
    recognition.onend = () => { listening = false; $('micBtn').classList.remove('listening'); $('coreState').textContent = 'AWAITING INPUT'; input.placeholder = 'Transmit a command to NARGIS...'; };
    $('micBtn').addEventListener('click', () => {
      if (listening) recognition.stop();
      else { try { recognition.start(); } catch { /* ignore duplicate starts */ } }
    });
  } else {
    $('voiceInputStatus').textContent = 'UNAVAILABLE';
    $('micBtn').title = 'Speech recognition is not supported in this build';
    $('micBtn').addEventListener('click', () => addMessage('assistant', 'Speech recognition is not available in this build. Please type your message instead.', true));
  }
  $('voiceOutputStatus').textContent = 'speechSynthesis' in window ? 'AVAILABLE' : 'UNAVAILABLE';
}

window.nargis.onChatChunk(handleChatChunk);
window.nargis.onChatDone(handleChatDone);
window.nargis.onChatError(handleChatError);

for (let i = 0; i < 42; i++) {
  const bar = document.createElement('i');
  bar.style.animationDelay = `${(i % 9) * 0.11}s`;
  $('signalBars').appendChild(bar);
}
setupVoice();
$('sessionValue').textContent = 'ACTIVE';
checkStatus();
