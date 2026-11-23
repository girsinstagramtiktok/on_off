import { loadEdgeImpulse } from './edge-impulse.js';

const $ = id => document.getElementById(id);
const elements = {
  lightCard: $('lightCard'), lightState: $('lightStateText'), lightSubtitle: $('lightSubtitle'),
  stateSymbol: $('stateSymbol'), bulb: $('bulbSvg'), listen: $('listenButton'),
  micTitle: $('micTitle'), micSubtitle: $('micSubtitle'), wave: $('wave'),
  topDot: $('topDot'), topText: $('topPillText'), error: $('errorMessage'),
  word: $('detectedWord'), confidence: $('confidenceText'),
  threshold: $('thresholdInput'), thresholdText: $('thresholdValue'), modelStatus: $('modelStatus')
};

let enabled = false;
let lightOn = false;
let model = null;
let stream = null;
let context = null;
let micSource = null;
let captureNode = null;
let muteNode = null;
let inferTimer = null;
let ring = null;
let ringOffset = 0;
let ringFilled = 0;
let isClassifying = false;
let lastActionAt = 0;
let votes = [];
let sampleTail = [];
let samplePos = 0;
let nativeRate = 48000;
const INFERENCE_INTERVAL = 460;
const COOLDOWN_MS = 1800;

function errorMessage(msg) { elements.error.textContent = msg; elements.error.hidden = !msg; }

function setLight(value) {
  lightOn = !!value;
  elements.lightCard.classList.toggle('on', lightOn);
  elements.lightState.textContent = lightOn ? 'Luz encendida' : 'Luz apagada';
  elements.stateSymbol.textContent = lightOn ? '✦' : '○';
  elements.lightSubtitle.textContent = lightOn ? 'Comando ON reconocido' : 'Comando OFF reconocido';
  elements.bulb.setAttribute('aria-label', lightOn ? 'Bombillo encendido' : 'Bombillo apagado');
  document.querySelector('.topbar').style.setProperty('--bulb-on', lightOn ? '1' : '0');
}

function setListening(isListening) {
  enabled = isListening;
  elements.listen.classList.toggle('listening', enabled);
  elements.topDot.classList.toggle('live', enabled);
  elements.wave.classList.toggle('live', enabled);
  elements.listen.querySelector('span').textContent = enabled ? 'Detener escucha' : 'Activar escucha';
  elements.listen.querySelector('svg').innerHTML = enabled
    ? '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>'
    : '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>';
  elements.topText.textContent = enabled ? 'Escuchando' : 'En espera';
  elements.micTitle.textContent = enabled ? 'Escucha activa' : 'Micrófono desactivado';
  elements.micSubtitle.textContent = enabled ? 'Habla con naturalidad' : 'Pulsa para comenzar a escuchar';
  if (!enabled) elements.wave.querySelectorAll('i').forEach(i => i.style.height='7px');
}

function drawWave(energy) {
  const level = Math.min(1, energy * 7);
  elements.wave.querySelectorAll('i').forEach((bar, i) => {
    const shape = [0.42,0.74,0.53,1,0.67,0.89,0.4][i];
    bar.style.height = `${7 + 19 * level * shape}px`;
  });
}

function putSamples(samples) {
  if (!ring) return;
  for (let i=0;i<samples.length;i++) {
    ring[ringOffset] = Math.max(-1, Math.min(1, samples[i]));
    ringOffset = (ringOffset + 1) % ring.length;
    if (ringFilled < ring.length) ringFilled++;
  }
}

// Remuestreo lineal continuo, respetando el límite entre bloques.
function resample(input) {
  sampleTail.push(...input);
  const step = nativeRate / 16000;
  const converted = [];
  while (samplePos + 1 < sampleTail.length) {
    const i = Math.floor(samplePos);
    const frac = samplePos - i;
    converted.push(sampleTail[i] * (1-frac) + sampleTail[i+1] * frac);
    samplePos += step;
  }
  const used = Math.floor(samplePos);
  if (used) {
    sampleTail = sampleTail.slice(used);
    samplePos -= used;
  }
  return converted;
}

function audioReceived(buffer) {
  if (!enabled) return;
  const input = buffer instanceof Float32Array ? buffer : Float32Array.from(buffer);
  let rms = 0;
  for(let i=0;i<input.length;i++)rms += input[i] * input[i];
  drawWave(Math.sqrt(rms/input.length));
  putSamples(resample(input));
}

function sampleFrame() {
  const frame = new Float32Array(ring.length);
  const start = ringOffset;
  for (let i=0;i<frame.length;i++) {
    // La inferencia Edge Impulse necesita PCM16 numérico (no valores [-1,1]).
    frame[i] = Math.max(-32768, Math.min(32767, ring[(start+i)%ring.length] * 32768));
  }
  return frame;
}

function showPredictions(scores) {
  const entries = Object.entries(scores).filter(([,v])=>Number.isFinite(v));
  if (!entries.length) return;
  entries.sort((a,b)=>b[1]-a[1]);
  const [word, confidence] = entries[0];
  const runnerUp = entries[1]?.[1] ?? 0;
  const label = word.toUpperCase();
  elements.word.textContent = label;
  elements.confidence.textContent = Math.round(confidence*100) + '% de confianza';
  const now = Date.now();
  const threshold = Number(elements.threshold.value) / 100;

  // UNKNOWN o predicciones inseguras jamás cambian el bombillo.
  const valid = (word === 'on' || word === 'off') &&
    confidence >= threshold && confidence - runnerUp >= 0.12;
  votes = votes.filter(v => now-v.when < 1500);
  if (!valid) return;
  votes.push({ word, when: now });
  const consistent = votes.filter(v => v.word === word).length >= 2;
  if (consistent && now-lastActionAt > COOLDOWN_MS) {
    setLight(word === 'on');
    lastActionAt = now;
    votes=[];
  }
}

async function classify() {
  if (!enabled || !model || !ring || ringFilled < ring.length || isClassifying) return;
  isClassifying = true;
  try {
    const scores = model.classify(sampleFrame());
    showPredictions(scores);
  } catch (e) {
    errorMessage('Error de inferencia: '+e.message);
    await stop();
  } finally {
    isClassifying = false;
  }
}

async function start() {
  elements.listen.disabled = true;
  errorMessage('');
  elements.micSubtitle.textContent = 'Cargando modelo...';
  try {
    if (!window.isSecureContext) throw new Error('El micrófono exige HTTPS o localhost. Publica la web en GitHub Pages.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('El navegador no ofrece acceso al micrófono.');
    if (!model) {
      model = await loadEdgeImpulse();
      elements.modelStatus.textContent = `Modelo activo · ${model.frequency/1000} kHz`;
    }
    ring = new Float32Array(model.frameSampleCount);
    ringOffset = 0; ringFilled = 0; sampleTail = []; samplePos = 0; votes=[];
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1
    }, video: false });
    context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    nativeRate = context.sampleRate;
    micSource = context.createMediaStreamSource(stream);
    muteNode = context.createGain();
    muteNode.gain.value = 0;

    setListening(true);
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await context.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
        captureNode = new AudioWorkletNode(context, 'luma-recorder', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount:[1] });
        captureNode.port.onmessage = event => audioReceived(event.data);
      } catch (workletError) {
        console.warn('AudioWorklet no disponible, se usa ScriptProcessor:', workletError);
      }
    }
    if (!captureNode) {
      captureNode = context.createScriptProcessor(2048,1,1);
      captureNode.onaudioprocess = event => {
        audioReceived(event.inputBuffer.getChannelData(0));
        event.outputBuffer.getChannelData(0).fill(0);
      };
    }
    micSource.connect(captureNode);
    captureNode.connect(muteNode);
    muteNode.connect(context.destination);
    inferTimer = setInterval(classify, INFERENCE_INTERVAL);
  } catch (e) {
    await stop();
    errorMessage(e.message || String(e));
    if (!model) elements.modelStatus.textContent = 'Falta instalar el modelo';
  } finally {
    elements.listen.disabled = false;
  }
}

async function stop() {
  clearInterval(inferTimer); inferTimer = null;
  try {captureNode?.disconnect();} catch {}
  try {micSource?.disconnect();} catch {}
  try {muteNode?.disconnect();} catch {}
  stream?.getTracks().forEach(t=>t.stop());
  if (context) {try {await context.close();}catch{}}
  captureNode = null; micSource = null; muteNode = null; context = null; stream = null;
  votes = [];
  setListening(false);
}

elements.listen.addEventListener('click', () => enabled ? stop() : start());
elements.threshold.addEventListener('input', () => {
  elements.thresholdText.textContent = elements.threshold.value + '%';
  votes=[];
});
window.addEventListener('pagehide', () => {if(enabled)stop();});

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}
