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
let mediaRecorder = null;
let recordedChunks = [];
let listening = false;
let speechLanguage = 'en-US';
let recordingTimer = null;
let silenceTimer = null;
let silenceMonitor = null;
let hasSpeech = false;
let selectedSpeechVoice = '';

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
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find(voice => voice.voiceURI === selectedSpeechVoice) || null;
  window.speechSynthesis.speak(utterance);
}

function updateSpeechVoices() {
  const voiceSelect = $('voiceSelect');
  if (!voiceSelect || !('speechSynthesis' in window)) return;
  const current = selectedSpeechVoice || voiceSelect.value;
  voiceSelect.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'System default';
  voiceSelect.appendChild(defaultOption);
  window.speechSynthesis.getVoices().forEach(voice => {
    const option = document.createElement('option');
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    voiceSelect.appendChild(option);
  });
  voiceSelect.value = current;
}

function handleVoiceCommand(content) {
  const command = content.toLowerCase();
  if (!command.includes('voice')) return false;
  const voices = window.speechSynthesis?.getVoices() || [];
  let matches;
  if (/\bfemale|woman|girl\b/.test(command)) {
    matches = voices.filter(voice => /female|woman|samantha|zira|hazel|susan|aria|jenny/i.test(voice.name));
  } else if (/\bmale|man|boy\b/.test(command)) {
    matches = voices.filter(voice => /male|david|mark|george|ryan|guy/i.test(voice.name));
  } else if (/\bchange|switch|different\b/.test(command)) {
    matches = voices.filter(voice => voice.voiceURI !== selectedSpeechVoice);
  } else {
    return false;
  }
  if (!matches.length) {
    addMessage('assistant', 'That voice type is not available in your Windows speech voices. Choose a voice manually from the Speaking Voice selector.', true);
    return true;
  }
  selectedSpeechVoice = matches[0].voiceURI;
  $('voiceSelect').value = selectedSpeechVoice;
  voiceReplies = true;
  $('voiceToggle').textContent = 'VOICE: ON';
  $('voiceToggle').classList.add('active');
  addMessage('assistant', `Voice changed to ${matches[0].name}. Voice replies are now enabled.`);
  speak(`Voice changed to ${matches[0].name}.`);
  return true;
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

async function runApprovedCommand(content) {
  const command = content.trim().toLowerCase();
  const approvedCommands = new Set([
    'open notepad',
    'open calculator',
    'open chrome',
    'open visual studio code',
    'open my documents folder'
  ]);
  if (!approvedCommands.has(command)) return false;
  const result = await window.nargis.openApprovedCommand(command);
  addMessage('assistant', result.ok ? result.message : `I could not complete that command: ${result.error}`, !result.ok);
  return true;
}

async function sendMessage(text) {
  const content = (text ?? input.value).trim();
  if (!content || busy) return;
  if (handleVoiceCommand(content)) {
    input.value = '';
    input.style.height = 'auto';
    return;
  }
  if (await runApprovedCommand(content)) {
    input.value = '';
    input.style.height = 'auto';
    return;
  }
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

async function decodeRecording(blob) {
  const buffer = await blob.arrayBuffer();
  const context = new AudioContext();
  const source = await context.decodeAudioData(buffer);
  const inputData = source.getChannelData(0);
  const targetLength = Math.floor(inputData.length * 16000 / source.sampleRate);
  const output = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i++) {
    const position = i * source.sampleRate / 16000;
    const left = Math.floor(position);
    const right = Math.min(left + 1, inputData.length - 1);
    const fraction = position - left;
    output[i] = inputData[left] * (1 - fraction) + inputData[right] * fraction;
  }
  await context.close();
  return Array.from(output);
}

async function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = null;
  }
  if (silenceMonitor) {
    cancelAnimationFrame(silenceMonitor);
    silenceMonitor = null;
  }
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
  mediaRecorder.stop();
  listening = false;
  $('micBtn').classList.remove('listening');
  $('coreState').textContent = 'TRANSCRIBING LOCALLY';
  input.placeholder = 'Transcribing with local Whisper…';
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    hasSpeech = false;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    const microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    const levels = new Uint8Array(analyser.fftSize);
    const monitorSilence = () => {
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        audioContext.close();
        return;
      }
      analyser.getByteTimeDomainData(levels);
      let total = 0;
      for (const level of levels) {
        const normalized = (level - 128) / 128;
        total += normalized * normalized;
      }
      const volume = Math.sqrt(total / levels.length);
      if (volume > 0.025) {
        hasSpeech = true;
        if (silenceTimer) {
          clearTimeout(silenceTimer);
          silenceTimer = null;
        }
      } else if (hasSpeech && !silenceTimer) {
        silenceTimer = setTimeout(() => stopRecording(), 5000);
      }
      silenceMonitor = requestAnimationFrame(monitorSilence);
    };
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = event => { if (event.data.size) recordedChunks.push(event.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(track => track.stop());
      try {
        if (!recordedChunks.length) throw new Error('No microphone audio was recorded.');
        addMessage('assistant', 'Audio captured. Loading local Whisper and transcribing…');
        const audio = await decodeRecording(new Blob(recordedChunks, { type: mediaRecorder.mimeType }));
        const result = await window.nargis.transcribe({ audio, language: speechLanguage });
        if (!result.ok) throw new Error(result.error);
        if (result.text) {
          input.value = result.text;
          $('coreState').textContent = 'SENDING TRANSCRIPTION';
          await sendMessage(result.text);
        } else {
          addMessage('assistant', 'No speech was detected. Please try again.', true);
        }
      } catch (error) {
        addMessage('assistant', `${error.message} You can still type your message.`, true);
      } finally {
        $('coreState').textContent = 'AWAITING INPUT';
        input.placeholder = 'Transmit a command to NARGIS...';
      }
    };
    mediaRecorder.start();
    silenceMonitor = requestAnimationFrame(monitorSilence);
    recordingTimer = setTimeout(() => stopRecording(), 60000);
    listening = true;
    $('micBtn').classList.add('listening');
    $('coreState').textContent = 'LISTENING';
    input.placeholder = 'Listening… stops after 5 seconds of silence';
  } catch (error) {
    $('voiceInputStatus').textContent = 'PERMISSION NEEDED';
    addMessage('assistant', `Microphone access failed: ${error.message}. You can still type your message.`, true);
  }
}

function setupVoice() {
  if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.AudioContext) {
    $('voiceInputStatus').textContent = 'LOCAL WHISPER';
    $('micBtn').title = 'Record speech and transcribe locally with Whisper';
    $('micBtn').addEventListener('click', () => listening ? stopRecording() : startRecording());
  } else {
    $('voiceInputStatus').textContent = 'UNAVAILABLE';
    $('micBtn').title = 'Local microphone recording is not supported in this build';
    $('micBtn').addEventListener('click', () => addMessage('assistant', 'Local microphone recording is not available in this build. Please type your message instead.', true));
  }
  $('voiceOutputStatus').textContent = 'speechSynthesis' in window ? 'AVAILABLE' : 'UNAVAILABLE';
  if ('speechSynthesis' in window) {
    selectedSpeechVoice = localStorage.getItem('nargis-speech-voice') || '';
    updateSpeechVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateSpeechVoices);
    $('voiceSelect').addEventListener('change', event => {
      selectedSpeechVoice = event.target.value;
      localStorage.setItem('nargis-speech-voice', selectedSpeechVoice);
    });
  }
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
