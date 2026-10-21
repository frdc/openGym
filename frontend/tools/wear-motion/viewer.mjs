import { BASE_ORIENTATION, createMotionState, acceptHello, acceptSample, calibrate, isFresh, isEmulator, rotateVector, createRecording, recordSample, recordCalibration, recordEvent, stopRecording, tickRecording } from './motion.mjs';

const $ = id => document.getElementById(id);
const axisColors = ['#ebc173', '#69c9c3', '#ad9fe6'];
const channels = ['accel', 'gyro', 'linear'];
let motion = createMotionState();
let status = { state: 'disconnected', message: '' };
let recording = null;
let paused = false;
let pausedPose = null;
let pausedSample = null;
let pausedHistory = [];
let history = [];
let arrivals = [];
let camera = 'perspective';
let arm = 'left';
let busy = false;
let refreshing = false;
let streamAvailable = false;
let staleGap = false;
let lastDraw = 0;
let lastControls = 0;
let dirty = true;
let displayedPose = BASE_ORIENTATION;

function notice(message = '') {
  $('notice').textContent = message;
  $('notice').hidden = !message;
}

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || value.message || 'Não foi possível concluir a operação.');
  return value;
}

async function refreshDevices() {
  refreshing = true;
  $('refresh').disabled = true;
  const selected = $('device').value;
  try {
    const { devices } = await api('/api/devices');
    const options = devices.map(device => {
      const option = document.createElement('option');
      option.value = device.serial;
      option.textContent = `${isEmulator(device) ? 'Emulador · ' : ''}${device.model || device.serial}`;
      option.selected = device.serial === selected;
      return option;
    });
    if (!options.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum relógio encontrado';
      options.push(option);
    }
    $('device').replaceChildren(...options);
    $('device-help').textContent = devices.length ? 'Conexão local via ADB. Somente relógios.' : 'Autorize o relógio no ADB e atualize a lista.';
  } catch (error) {
    $('device').replaceChildren(new Option('Busca indisponível', ''));
    notice(error.message);
  } finally {
    refreshing = false;
    $('refresh').disabled = false;
    updateControls();
  }
}

function setStatus(next) {
  status = next;
  if (next.state !== 'connected') {
    stopRecording(recording, Date.now(), next.state === 'error' ? 'connection-error' : 'disconnected');
    arrivals = [];
  }
  if (next.state === 'error') notice(next.message || 'A conexão foi interrompida.');
  if (next.device?.model) $('device-help').textContent = isEmulator(next.device) ? 'Emulador · sinal de teste, sem sensor físico.' : next.device.model;
  dirty = true;
  updateControls();
}

function receiveHello(value) {
  const newSession = motion.hello?.session !== value.session;
  if (newSession) {
    recordEvent(recording, 'session', Date.now(), { hello: value });
    history = [];
    arrivals = [];
    pausedHistory = [];
    pausedSample = null;
    pausedPose = null;
    paused = false;
    $('pause').setAttribute('aria-pressed', 'false');
    $('pause-label').textContent = 'Pausar';
    $('pause-icon').textContent = 'Ⅱ';
    displayedPose = BASE_ORIENTATION;
    staleGap = false;
  }
  motion = acceptHello(motion, value);
  $('session-detail').textContent = `${isEmulator(status.device) || isEmulator(value) ? 'EMULADOR · ' : ''}${value.model || 'WEAR OS'} · SESSÃO LOCAL · SEM DADOS DE TREINO`;
  dirty = true;
  updateControls();
}

function receiveSample(value) {
  const now = Date.now();
  const result = acceptSample(motion, value, now);
  if (!result.accepted) return;
  motion = result.state;
  arrivals.push(value.receivedAt);
  arrivals = arrivals.slice(-50).filter(time => value.receivedAt - time < 2000);
  history.push(value);
  history = history.slice(-240).filter(sample => value.tMs - sample.tMs <= 8000);
  recordSample(recording, value, now);
  if (staleGap) {
    recordEvent(recording, 'data-resumed', now, { seq: value.seq });
    staleGap = false;
  }
  if (!paused && isFresh(value, now, true) && motion.display) displayedPose = motion.display;
  dirty = true;
}

function updateControls(now = Date.now()) {
  const connected = streamAvailable && status.state === 'connected';
  const emulated = isEmulator(status.device) || isEmulator(motion.hello);
  const fresh = connected && isFresh(motion.latest, now);
  const orientationFresh = fresh && isFresh(motion.latest, now, true);
  const connecting = status.state === 'connecting';
  const canDisconnect = status.state === 'connected' || connecting;
  $('connect').disabled = busy || (!canDisconnect && !$('device').value);
  $('connect').textContent = busy ? 'Aguarde…' : canDisconnect ? 'Desconectar relógio' : '↗  Conectar relógio';
  $('connect').classList.toggle('primary', !canDisconnect);
  $('connect').classList.toggle('secondary', canDisconnect);
  $('device').disabled = busy || canDisconnect;
  $('refresh').disabled = refreshing || busy || canDisconnect;
  $('calibrate').disabled = !orientationFresh || paused;
  $('calibrate').textContent = motion.reference ? '⊕  Recalibrar posição' : '⊕  Calibrar posição';
  $('pause').disabled = !fresh && !paused;
  $('record').disabled = !recording?.active && !fresh;
  $('export').disabled = !recording?.samples.length;
  $('record-label').textContent = recording?.active ? 'Encerrar' : recording?.samples.length ? 'Nova gravação' : 'Gravar';
  document.querySelector('.recording-panel').classList.toggle('is-recording', Boolean(recording?.active));
  $('record-clock').classList.toggle('is-recording', Boolean(recording?.active));
  const elapsed = recording ? (recording.stoppedAt ?? now) - recording.startedAt : 0;
  $('record-clock').textContent = `${String(Math.floor(elapsed / 60000)).padStart(2, '0')}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, '0')}`;
  if (recording) {
    const count = recording.samples.length.toLocaleString('pt-BR');
    $('recording-help').textContent = recording.active ? `${count} amostras · Gravando dados brutos, mesmo com a visualização pausada.` : `${count} amostras preservadas${recording.stopReason === 'limit' ? ' · Limite de 30 min / 45 mil amostras atingido' : ''}. Exporte antes de iniciar uma nova gravação.`;
  }
  const visibleState = !streamAvailable ? 'disconnected' : connected && !fresh ? 'stale' : status.state;
  const labels = { disconnected: 'Desconectado', connecting: 'Conectando…', connected: 'Conectado', stale: 'Sem dados recentes', error: 'Conexão interrompida' };
  $('connection-pill').dataset.state = visibleState;
  $('connection-label').textContent = `${labels[visibleState] || 'Desconectado'}${emulated ? ' · Emulador' : ''}`;
  $('live-label').classList.toggle('is-live', fresh && !paused);
  $('live-label').lastChild.textContent = paused ? ' PAUSADO' : fresh ? emulated ? ' EMULADOR' : ' AO VIVO' : ' SEM SINAL';
  let title = 'Pronto para conectar';
  let hint = 'Conecte seu relógio para começar.';
  let orientation = 'Aguardando';
  if (connected) {
    if (!fresh) {
      title = 'Aguardando dados recentes'; hint = 'A pose permanece congelada até o sinal voltar.'; orientation = 'Sem dados';
    } else if (!orientationFresh) {
      title = motion.latest?.q ? 'Orientação sem atualização' : 'Orientação indisponível'; hint = 'Os outros sensores disponíveis continuam nos gráficos.'; orientation = 'Indisponível';
    } else if (!motion.reference) {
      title = 'Calibre para orientar a cena'; hint = 'Siga os três passos ao lado e defina a referência.'; orientation = 'Calibre primeiro';
    } else {
      title = emulated ? 'Orientação do emulador' : 'Orientação medida'; hint = emulated ? 'Sinal de teste do emulador; não representa um sensor físico.' : 'A direção acompanha o relógio. A posição do braço é ilustrativa.'; orientation = emulated ? 'Emulada · relativa' : 'Medida · relativa';
    }
  } else if (motion.latest) {
    title = 'Conexão encerrada'; hint = 'Última pose preservada. Reconecte e calibre a nova sessão.'; orientation = 'Sem sinal';
  }
  if (paused && fresh) { title = 'Visualização pausada'; hint = recording?.active ? 'A gravação continua recebendo os sensores.' : 'Os dados continuam chegando. Retome para atualizar a cena.'; orientation = 'Pausada'; }
  $('hint-title').textContent = title;
  $('hint-text').textContent = hint;
  $('orientation-state').textContent = orientation;
  $('rate').textContent = fresh && arrivals.length > 1 && arrivals.at(-1) > arrivals[0] ? ((arrivals.length - 1) * 1000 / (arrivals.at(-1) - arrivals[0])).toFixed(1) : '—';
  $('age').textContent = connected && motion.latest ? Math.min(99999, Math.max(0, now - motion.latest.receivedAt)).toFixed(0) : '—';
  $('age').parentElement.title = 'Tempo desde a chegada da última amostra ao PC; não mede latência ponta a ponta.';
  $('calibration-help').textContent = motion.reference ? 'Referência definida. Recalibre ao mudar a direção do tronco ou reiniciar a sessão.' : 'Mantenha o tronco na mesma direção. Recalibre ao mudar de posição.';
  const displayed = paused ? pausedSample : motion.latest;
  for (const channel of channels) {
    const available = Boolean(displayed?.[channel]);
    const channelLive = available && fresh;
    const valueNode = $(`${channel}-value`);
    if (available) {
      valueNode.replaceChildren(...displayed[channel].map((value, index) => {
        const span = document.createElement('span');
        span.style.color = axisColors[index];
        span.textContent = `${'XYZ'[index]} ${value.toFixed(2)}`;
        return span;
      }));
    } else valueNode.textContent = motion.hello ? 'Sensor indisponível' : 'Sem dados';
    $(`${channel}-state`).textContent = channelLive ? paused ? 'PAUSADO' : 'AO VIVO' : available ? 'ÚLTIMO SINAL' : motion.hello ? 'INDISPONÍVEL' : 'AGUARDANDO';
    $(`${channel}-state`).classList.toggle('is-live', channelLive && !paused);
  }
  if (connected && motion.latest && !fresh && !staleGap) {
    recordEvent(recording, 'gap', now, { reason: 'stale', afterSeq: motion.latest.seq });
    staleGap = true;
  }
}

$('refresh').addEventListener('click', refreshDevices);
$('device').addEventListener('change', () => updateControls());
$('connect').addEventListener('click', async () => {
  busy = true;
  notice();
  updateControls();
  try {
    const disconnect = status.state === 'connected' || status.state === 'connecting';
    const next = await api(disconnect ? '/api/disconnect' : '/api/connect', disconnect ? {} : { serial: $('device').value });
    if (next.state) setStatus(next);
    else if (next.status?.state) setStatus(next.status);
  } catch (error) { notice(error.message); }
  finally { busy = false; updateControls(); }
});
$('calibrate').addEventListener('click', () => {
  const next = calibrate(motion, Date.now());
  if (!next || paused || status.state !== 'connected') return;
  motion = next;
  displayedPose = next.display;
  recordCalibration(recording, next.reference, next.hello.session, next.calibratedAt);
  dirty = true;
  updateControls();
});
$('pause').addEventListener('click', () => {
  paused = !paused;
  pausedPose = paused ? displayedPose : null;
  pausedSample = paused ? motion.latest : null;
  pausedHistory = paused ? [...history] : [];
  if (!paused && motion.display && isFresh(motion.latest, Date.now(), true)) displayedPose = motion.display;
  $('pause').setAttribute('aria-pressed', String(paused));
  $('pause-label').textContent = paused ? 'Retomar' : 'Pausar';
  $('pause-icon').textContent = paused ? '▷' : 'Ⅱ';
  dirty = true;
  updateControls();
});
$('record').addEventListener('click', () => {
  const now = Date.now();
  if (recording?.active) stopRecording(recording, now);
  else if (status.state === 'connected' && isFresh(motion.latest, now)) {
    recording = createRecording(now, motion.hello, motion.reference);
    recordSample(recording, motion.latest, now);
  }
  updateControls();
});
$('export').addEventListener('click', () => {
  if (!recording?.samples.length) return;
  const snapshot = { ...recording, exportedAt: Date.now() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `opengym-motion-${new Date(recording.startedAt).toISOString().replace(/[:.]/g, '-')}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
for (const button of document.querySelectorAll('[data-camera]')) button.addEventListener('click', () => {
  camera = button.dataset.camera;
  document.querySelectorAll('[data-camera]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  dirty = true;
});
for (const button of document.querySelectorAll('[data-arm]')) button.addEventListener('click', () => {
  arm = button.dataset.arm;
  document.querySelectorAll('[data-arm]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  recordEvent(recording, 'illustrated-arm', Date.now(), { arm });
  dirty = true;
});

// A small perspective renderer. Only the measured rotation moves the model.
// Arm dimensions and the fixed elbow are display geometry, never sensor output.
const add = (a, b) => a.map((v, i) => v + b[i]);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = a => a.map(v => v / (Math.hypot(...a) || 1));
function fitCanvas(canvas) {
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const context = canvas.getContext('2d');
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return { context, width, height };
}

function drawScene() {
  const { context: ctx, width, height } = fitCanvas($('scene'));
  if (!width || !height) return;
  const target = [0, 0.1, -1.15];
  const cameraPositions = { perspective: [4.3, 3.4, -5.8], front: [0, 1.0, -8], side: [7.5, 1.3, -1.15], top: [0, 8.3, -1.15] };
  const eye = cameraPositions[camera];
  const forward = unit(sub(target, eye));
  const right = unit(cross(forward, camera === 'top' ? [0, 0, 1] : [0, 1, 0]));
  const up = cross(right, forward);
  const focal = Math.min(width * 1.36, height * 1.85);
  const project = point => {
    const relative = sub(point, eye);
    const depth = dot(relative, forward);
    return { x: width * .5 + dot(relative, right) * focal / depth, y: height * .49 - dot(relative, up) * focal / depth, depth };
  };
  function line(a, b, color, weight = 1, dashed = false) {
    const p = project(a); const q = project(b);
    if (p.depth <= .2 || q.depth <= .2) return;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    ctx.strokeStyle = color; ctx.lineWidth = weight; ctx.setLineDash(dashed ? [3, 5] : []); ctx.stroke(); ctx.setLineDash([]);
  }
  // Ground grid gives a stable reference while the arm rotates.
  for (let step = -6; step <= 6; step++) {
    const position = step * .5;
    line([position, -.72, -4], [position, -.72, 2], step === 0 ? '#34454b' : '#283338', .7);
    line([-3, -.72, position - 1], [3, -.72, position - 1], step === 0 ? '#34454b' : '#283338', .7);
  }
  const origin = [arm === 'left' ? -.18 : .18, 0, .45];
  const q = paused ? pausedPose || BASE_ORIENTATION : displayedPose;
  const world = point => add(origin, rotateVector(q, point));
  const faces = [];
  function face(points, color, edge = null) { faces.push({ points: points.map(world), color, edge }); }
  function prism(min, max, color, edge) {
    const [x, y, z] = min; const [X, Y, Z] = max;
    const p = [[x,y,z],[X,y,z],[X,Y,z],[x,Y,z],[x,y,Z],[X,y,Z],[X,Y,Z],[x,Y,Z]];
    for (const indices of [[0,3,2,1],[4,5,6,7],[0,1,5,4],[3,7,6,2],[0,4,7,3],[1,2,6,5]]) face(indices.map(i => p[i]), color, edge);
  }
  function tube(y0, y1, rx0, rz0, rx1, rz1, color, offsetX = 0, offsetZ = 0) {
    const n = 12;
    const ring = (y, rx, rz) => Array.from({ length: n }, (_, i) => [offsetX + Math.cos(i * Math.PI * 2 / n) * rx, y, offsetZ + Math.sin(i * Math.PI * 2 / n) * rz]);
    const a = ring(y0, rx0, rz0); const b = ring(y1, rx1, rz1);
    face([...a].reverse(), color);
    face(b, color);
    for (let i = 0; i < n; i++) face([a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]], color);
  }
  // Elbow, tapered forearm, wrist and relaxed hand form one rigid illustration.
  tube(-.15, .16, .23, .24, .36, .29, [80, 99, 106]);
  tube(.16, 1.65, .36, .29, .25, .19, [107, 132, 142]);
  tube(1.65, 2.50, .25, .19, .22, .16, [114, 139, 146]);
  tube(2.50, 2.75, .22, .16, .31, .13, [120, 143, 149]);
  prism([-.31, 2.69, -.13], [.31, 3.10, .13], [119, 143, 149]);
  for (let i = 0; i < 4; i++) {
    const x = -.235 + i * .155;
    const length = [.42, .53, .49, .36][i];
    tube(3.07, 3.07 + length, .069, .095, .05, .065, [118, 140, 148], x, 0);
  }
  const thumb = arm === 'left' ? 1 : -1;
  prism([thumb > 0 ? .26 : -.45, 2.65, -.12], [thumb > 0 ? .45 : -.26, 3.02, .07], [109, 133, 141]);
  // Band, metal case and face follow the watch's local +Z screen normal.
  tube(1.93, 2.31, .278, .223, .25, .205, [35, 42, 44]);
  prism([-.315, 1.91, .17], [.315, 2.38, .365], [167, 154, 126], '#b1a486');
  prism([-.276, 1.95, .365], [.276, 2.34, .39], [20, 27, 29], '#4b595c');
  prism([.315, 2.08, .235], [.355, 2.20, .31], [146, 136, 111]);
  // Simple face marks are purely decorative; actual measurements are outside the model.
  prism([-.17, 2.12, .391], [-.045, 2.25, .395], [221, 185, 116]);
  prism([-.005, 2.12, .391], [.12, 2.25, .395], [104, 180, 171]);
  prism([-.17, 2.04, .391], [.12, 2.065, .395], [80, 100, 105]);
  const light = unit([-.3, .8, -.45]);
  for (const item of faces) {
    item.depth = item.points.reduce((sum, point) => sum + project(point).depth, 0) / item.points.length;
  }
  faces.sort((a, b) => b.depth - a.depth);
  for (const item of faces) {
    const points = item.points.map(project);
    if (points.some(point => point.depth <= .2)) continue;
    const normal = unit(cross(sub(item.points[1], item.points[0]), sub(item.points[2], item.points[0])));
    const brightness = .68 + Math.max(0, dot(normal, light)) * .40;
    ctx.beginPath(); points.forEach((point, i) => i ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.closePath();
    ctx.fillStyle = `rgb(${item.color.map(value => Math.round(value * brightness)).join(',')})`;
    ctx.fill(); ctx.strokeStyle = item.edge || 'rgba(22,35,41,.18)'; ctx.lineWidth = .6; ctx.stroke();
  }
  const elbow = project(origin);
  ctx.beginPath(); ctx.arc(elbow.x, elbow.y, 5, 0, Math.PI * 2); ctx.strokeStyle = '#a2b7b9'; ctx.lineWidth = 1; ctx.stroke();
  const labelX = Math.min(width - 98, Math.max(80, elbow.x + (camera === 'side' ? -110 : 52)));
  ctx.beginPath(); ctx.moveTo(elbow.x + 9, elbow.y); ctx.lineTo(labelX - 8, elbow.y + 24); ctx.strokeStyle = '#596c74'; ctx.lineWidth = .7; ctx.stroke();
  ctx.fillStyle = '#8f9da2'; ctx.font = '8px "Segoe UI",sans-serif'; ctx.fillText('COTOVELO FIXO', labelX, elbow.y + 27);
  // A fixed corner triad keeps scene axes readable at every camera angle.
  const triad = [width - 67, 73];
  const axes = [[1,0,0],[0,1,0],[0,0,-1]];
  const labels = ['DIREITA', 'CIMA', 'FRENTE'];
  axes.forEach((axis, i) => {
    const x = triad[0] + dot(axis, right) * 28; const y = triad[1] - dot(axis, up) * 28;
    ctx.beginPath(); ctx.moveTo(...triad); ctx.lineTo(x, y); ctx.strokeStyle = axisColors[i]; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fillStyle = axisColors[i]; ctx.fill();
    ctx.font = '6px "Segoe UI",sans-serif'; ctx.textAlign = x < triad[0] - 2 ? 'right' : 'left'; ctx.fillText(labels[i], x + (x < triad[0] - 2 ? -5 : 5), y + 2);
  });
  ctx.textAlign = 'left';
}

function drawChart(channel) {
  const { context: ctx, width, height } = fitCanvas($(`${channel}-chart`));
  const samples = paused ? pausedHistory : history;
  const latestTime = samples.at(-1)?.tMs || 0;
  const values = samples.flatMap(sample => sample[channel] || []);
  const range = Math.max(channel === 'gyro' ? .5 : 2, ...values.map(Math.abs)) * 1.15;
  const y = value => height / 2 - value / range * (height / 2 - 8);
  ctx.lineWidth = .7;
  for (const part of [.16, .5, .84]) {
    ctx.beginPath(); ctx.moveTo(0, height * part); ctx.lineTo(width, height * part); ctx.strokeStyle = part === .5 ? '#3b454a' : '#2b3439'; ctx.setLineDash(part === .5 ? [] : [2, 4]); ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!values.length) { ctx.fillStyle = '#52636b'; ctx.font = '9px Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText('—', width / 2, height / 2 - 7); ctx.textAlign = 'left'; return; }
  for (let axis = 0; axis < 3; axis++) {
    ctx.beginPath(); let previous = null;
    for (const sample of samples) {
      if (!sample[channel]) { previous = null; continue; }
      const x = width * (1 - (latestTime - sample.tMs) / 8000);
      if (!previous || sample.tMs - previous.tMs > 160 || sample.seq !== previous.seq + 1) ctx.moveTo(x, y(sample[channel][axis]));
      else ctx.lineTo(x, y(sample[channel][axis]));
      previous = sample;
    }
    ctx.strokeStyle = axisColors[axis]; ctx.lineWidth = 1.2; ctx.stroke();
  }
  ctx.font = '7px Consolas,monospace'; ctx.fillStyle = '#687c86'; ctx.fillText(`±${range.toFixed(1)}`, 1, 8);
}

const resizeObserver = new ResizeObserver(() => { dirty = true; });
resizeObserver.observe($('scene'));
channels.forEach(channel => resizeObserver.observe($(`${channel}-chart`)));

function frame(time) {
  if (time - lastControls >= 200) {
    const wasActive = Boolean(recording?.active);
    tickRecording(recording, Date.now());
    if (wasActive && !recording.active) notice('Gravação encerrada no limite de 30 minutos. As amostras estão prontas para exportar.');
    updateControls();
    lastControls = time;
  }
  if (time - lastDraw >= 32) {
    if (dirty) { drawScene(); channels.forEach(drawChart); dirty = false; }
    lastDraw = time;
  }
  requestAnimationFrame(frame);
}

const events = new EventSource('/events');
events.addEventListener('open', () => { streamAvailable = true; updateControls(); });
events.addEventListener('status', event => { streamAvailable = true; setStatus(JSON.parse(event.data)); });
events.addEventListener('hello', event => receiveHello(JSON.parse(event.data)));
events.addEventListener('sample', event => receiveSample(JSON.parse(event.data)));
events.addEventListener('error', () => {
  streamAvailable = false;
  stopRecording(recording, Date.now(), 'connection-error');
  dirty = true;
  updateControls();
});
window.addEventListener('beforeunload', () => events.close());
refreshDevices();
api('/api/status').then(value => setStatus(value.status || value)).catch(error => notice(error.message));
requestAnimationFrame(frame);
