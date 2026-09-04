import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import "./style.css";

type PianoNote = {
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  track: number;
};

const NOTE_MIN = 21;
const NOTE_MAX = 108;
const KEYBOARD_HEIGHT = 112;
const BASE_BPM = 120;
const LEFT_COLOR = "#55a7ff";
const RIGHT_COLOR = "#4ee1d0";

const canvas = document.querySelector<HTMLCanvasElement>("#visualizer")!;
const ctx = canvas.getContext("2d")!;
const fileInput = document.querySelector<HTMLInputElement>("#fileInput")!;
const playButton = document.querySelector<HTMLButtonElement>("#playButton")!;
const playIcon = document.querySelector<HTMLSpanElement>("#playIcon")!;
const timeline = document.querySelector<HTMLInputElement>("#timeline")!;
const currentTimeLabel = document.querySelector<HTMLElement>("#currentTime")!;
const durationLabel = document.querySelector<HTMLElement>("#duration")!;
const speedSelect = document.querySelector<HTMLSelectElement>("#speedSelect")!;
const volumeSlider = document.querySelector<HTMLInputElement>("#volumeSlider")!;
const songTitle = document.querySelector<HTMLElement>("#songTitle")!;
const songMeta = document.querySelector<HTMLElement>("#songMeta")!;
const trackInfo = document.querySelector<HTMLElement>("#trackInfo")!;
const emptyState = document.querySelector<HTMLElement>("#emptyState")!;
const dropZone = document.querySelector<HTMLElement>("#dropZone")!;
const dropMask = document.querySelector<HTMLElement>("#dropMask")!;
const midiStatus = document.querySelector<HTMLElement>("#midiStatus")!;
const connectMidiButton = document.querySelector<HTMLButtonElement>("#connectMidiButton")!;
const settingsMidiButton = document.querySelector<HTMLButtonElement>("#settingsMidiButton")!;
const settingsMidiStatus = document.querySelector<HTMLElement>("#settingsMidiStatus")!;
const libraryImportButton = document.querySelector<HTMLButtonElement>("#libraryImportButton")!;
const libraryOpenButton = document.querySelector<HTMLButtonElement>("#libraryOpenButton")!;
const libraryEmpty = document.querySelector<HTMLElement>("#libraryEmpty")!;
const libraryCurrent = document.querySelector<HTMLElement>("#libraryCurrent")!;
const librarySongTitle = document.querySelector<HTMLElement>("#librarySongTitle")!;
const librarySongMeta = document.querySelector<HTMLElement>("#librarySongMeta")!;
const pageTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-target]"));
const pageViews = Array.from(document.querySelectorAll<HTMLElement>("[data-page]"));

const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "triangle8" },
  envelope: { attack: 0.008, decay: 0.75, sustain: 0.24, release: 1.7 },
  volume: -8,
}).toDestination();
synth.maxPolyphony = 64;
const transport = Tone.getTransport();
transport.bpm.value = BASE_BPM;
const TICKS_PER_SECOND = transport.PPQ * 2;

let notes: PianoNote[] = [];
let duration = 0;
let currentTime = 0;
let speed = 1;
let isPlaying = false;
let midiAccess: MIDIAccess | null = null;
const activeNotes = new Set<number>();

function activatePage(pageName: string) {
  const pageExists = pageViews.some(page => page.dataset.page === pageName);
  const activePage = pageExists ? pageName : "studio";
  pageViews.forEach(page => { page.hidden = page.dataset.page !== activePage; });
  pageTabs.forEach(tab => {
    const isActive = tab.dataset.pageTarget === activePage;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  if (activePage === "studio") requestAnimationFrame(resizeCanvas);
}

function openPage(pageName: string) {
  if (window.location.hash === `#${pageName}`) activatePage(pageName);
  else window.location.hash = pageName;
}

const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);
const midiName = (midi: number) => `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function whiteKeyMetrics(width: number) {
  const whiteNotes: number[] = [];
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) if (!isBlack(midi)) whiteNotes.push(midi);
  const whiteWidth = width / whiteNotes.length;
  const starts = new Map<number, number>();
  whiteNotes.forEach((midi, index) => starts.set(midi, index * whiteWidth));
  return { whiteWidth, starts };
}

function noteGeometry(midi: number, width: number) {
  const { whiteWidth, starts } = whiteKeyMetrics(width);
  if (!isBlack(midi)) return { x: starts.get(midi)!, width: whiteWidth, black: false };
  let previous = midi - 1;
  while (isBlack(previous)) previous--;
  const center = starts.get(previous)! + whiteWidth;
  return { x: center - whiteWidth * 0.32, width: whiteWidth * 0.64, black: true };
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return requestAnimationFrame(draw);

  if (isPlaying) {
    currentTime = Math.min(duration, transport.ticks / TICKS_PER_SECOND);
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#08131d";
  ctx.fillRect(0, 0, width, height);

  const fallHeight = height - KEYBOARD_HEIGHT;
  const pxPerSecond = Math.max(100, Math.min(185, fallHeight / 3.2));
  const { whiteWidth, starts } = whiteKeyMetrics(width);

  ctx.strokeStyle = "rgba(104, 145, 158, .10)";
  ctx.lineWidth = 1;
  starts.forEach((x, midi) => {
    if (midi % 12 === 0) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + .5, 0);
      ctx.lineTo(Math.round(x) + .5, fallHeight);
      ctx.stroke();
    }
  });

  const startWindow = currentTime - .2;
  const endWindow = currentTime + fallHeight / pxPerSecond;
  const fileActiveNotes = new Set<number>();
  for (const note of notes) {
    if (note.time + note.duration < startWindow || note.time > endWindow) continue;
    if (note.time <= currentTime && note.time + note.duration >= currentTime) fileActiveNotes.add(note.midi);
    const key = noteGeometry(note.midi, width);
    const noteEndY = fallHeight - (note.time - currentTime) * pxPerSecond;
    const noteHeight = Math.max(5, note.duration * pxPerSecond);
    const xPad = Math.max(1, key.width * .09);
    const color = note.midi < 60 ? LEFT_COLOR : RIGHT_COLOR;
    ctx.shadowBlur = noteEndY > fallHeight - 14 ? 14 : 5;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    roundRect(key.x + xPad, noteEndY - noteHeight, key.width - xPad * 2, noteHeight, Math.min(4, key.width / 4));
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  ctx.fillStyle = "#dfe8e9";
  ctx.fillRect(0, fallHeight, width, KEYBOARD_HEIGHT);
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (isBlack(midi)) continue;
    const x = starts.get(midi)!;
    const active = activeNotes.has(midi) || fileActiveNotes.has(midi);
    ctx.fillStyle = active ? (midi < 60 ? "#75baff" : "#75edde") : "#e9eeee";
    ctx.fillRect(x + .5, fallHeight + 1, whiteWidth - 1, KEYBOARD_HEIGHT - 2);
    ctx.strokeStyle = "#83939a";
    ctx.strokeRect(x + .5, fallHeight + .5, whiteWidth, KEYBOARD_HEIGHT);
    if (midi % 12 === 0 && whiteWidth > 12) {
      ctx.fillStyle = "#62737a";
      ctx.font = "10px Manrope";
      ctx.textAlign = "center";
      ctx.fillText(midiName(midi), x + whiteWidth / 2, height - 9);
    }
  }
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (!isBlack(midi)) continue;
    const key = noteGeometry(midi, width);
    const active = activeNotes.has(midi) || fileActiveNotes.has(midi);
    ctx.fillStyle = active ? (midi < 60 ? "#2f83d5" : "#20aa9b") : "#0b151b";
    roundRect(key.x, fallHeight, key.width, KEYBOARD_HEIGHT * .61, 0, 0, 3, 3);
    ctx.fill();
  }

  timeline.value = duration ? String(Math.round((currentTime / duration) * 1000)) : "0";
  currentTimeLabel.textContent = formatTime(currentTime);
  requestAnimationFrame(draw);
}

function roundRect(x: number, y: number, width: number, height: number, ...radii: number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radii.length ? radii : [4]);
}

function scheduleSong() {
  transport.stop();
  transport.cancel();
  transport.bpm.value = BASE_BPM * speed;
  for (const note of notes) {
    const startTicks = Math.round(note.time * TICKS_PER_SECOND);
    const durationTicks = Math.max(1, Math.round(note.duration * TICKS_PER_SECOND));
    transport.schedule(time => {
      synth.triggerAttackRelease(note.name, `${durationTicks}i`, time, Math.max(.08, note.velocity));
    }, `${startTicks}i`);
  }
  const endTicks = Math.max(1, Math.ceil(duration * TICKS_PER_SECOND));
  transport.schedule(time => {
    transport.stop(time);
    Tone.getDraw().schedule(() => {
      isPlaying = false;
      currentTime = 0;
      playIcon.textContent = "▶";
      playButton.setAttribute("aria-label", "播放");
    }, time);
  }, `${endTicks}i`);
}

async function togglePlayback() {
  if (!notes.length) return;
  await Tone.start();
  if (isPlaying) pausePlayback();
  else startPlayback();
}

function startPlayback() {
  if (currentTime >= duration) currentTime = 0;
  isPlaying = true;
  transport.ticks = currentTime * TICKS_PER_SECOND;
  transport.start();
  playIcon.textContent = "Ⅱ";
  playButton.setAttribute("aria-label", "暂停");
}

function pausePlayback() {
  if (isPlaying) currentTime = Math.min(duration, transport.ticks / TICKS_PER_SECOND);
  isPlaying = false;
  transport.pause();
  synth.releaseAll();
  playIcon.textContent = "▶";
  playButton.setAttribute("aria-label", "播放");
}

async function loadMidi(file: File) {
  if (!/\.(mid|midi)$/i.test(file.name)) {
    songMeta.textContent = "请选择 .mid 或 .midi 文件";
    return;
  }
  try {
    pausePlayback();
    const midi = new Midi(await file.arrayBuffer());
    notes = midi.tracks.flatMap((track, trackIndex) => track.notes.map(note => ({
      midi: note.midi,
      name: note.name,
      time: note.time,
      duration: note.duration,
      velocity: note.velocity,
      track: trackIndex,
    }))).filter(note => note.midi >= NOTE_MIN && note.midi <= NOTE_MAX).sort((a, b) => a.time - b.time);
    duration = notes.reduce((end, note) => Math.max(end, note.time + note.duration), midi.duration || 0);
    currentTime = 0;
    scheduleSong();
    const musicalTracks = midi.tracks.filter(track => track.notes.length > 0).length;
    const bpm = Math.round(midi.header.tempos[0]?.bpm || 120);
    songTitle.textContent = midi.name?.trim() || file.name.replace(/\.(mid|midi)$/i, "");
    songMeta.textContent = `${musicalTracks} 条音轨 · ${notes.length.toLocaleString()} 个音符 · ${bpm} BPM`;
    librarySongTitle.textContent = songTitle.textContent;
    librarySongMeta.textContent = songMeta.textContent;
    libraryEmpty.hidden = true;
    libraryCurrent.hidden = false;
    trackInfo.textContent = `${file.name} · ${formatTime(duration)}`;
    durationLabel.textContent = formatTime(duration);
    emptyState.classList.add("hidden");
    playButton.disabled = !notes.length;
    timeline.disabled = !notes.length;
    if (!notes.length) songMeta.textContent = "这个文件中没有可播放的钢琴音符";
    openPage("studio");
  } catch (error) {
    console.error(error);
    songMeta.textContent = "无法读取这个 MIDI，文件可能已损坏";
  }
}

function handleMidiMessage(event: MIDIMessageEvent) {
  if (!event.data) return;
  const [status = 0, note = 0, velocity = 0] = event.data;
  const command = status & 0xf0;
  if (note < NOTE_MIN || note > NOTE_MAX) return;
  if (command === 0x90 && velocity > 0) {
    void Tone.start();
    synth.triggerAttack(midiName(note), Tone.now(), Math.max(.08, velocity / 127));
    activeNotes.add(note);
  } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    synth.triggerRelease(midiName(note));
    activeNotes.delete(note);
  }
}

function bindMidiInputs() {
  if (!midiAccess) return;
  const inputs = Array.from(midiAccess.inputs.values());
  inputs.forEach(input => { input.onmidimessage = handleMidiMessage; });
  if (inputs.length) {
    midiStatus.classList.add("connected");
    midiStatus.innerHTML = `<span></span>${inputs.length === 1 ? inputs[0].name || "MIDI 键盘" : `${inputs.length} 个 MIDI 输入`}已连接`;
    connectMidiButton.textContent = "重新扫描";
    settingsMidiStatus.textContent = inputs.length === 1 ? inputs[0].name || "MIDI 键盘已连接" : `${inputs.length} 个 MIDI 输入已连接`;
    settingsMidiButton.textContent = "重新扫描";
  } else {
    midiStatus.classList.remove("connected");
    midiStatus.innerHTML = "<span></span>未发现 MIDI 输入";
    settingsMidiStatus.textContent = "未发现 MIDI 输入";
  }
}

async function connectMidi() {
  if (!navigator.requestMIDIAccess) {
    midiStatus.innerHTML = "<span></span>当前浏览器不支持 Web MIDI";
    settingsMidiStatus.textContent = "当前浏览器不支持 Web MIDI";
    return;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    midiAccess.onstatechange = bindMidiInputs;
    bindMidiInputs();
  } catch {
    midiStatus.innerHTML = "<span></span>MIDI 权限未开启";
    settingsMidiStatus.textContent = "MIDI 权限未开启";
  }
}

function pointerToMidi(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height - KEYBOARD_HEIGHT) return null;
  const x = event.clientX - rect.left;
  if (y < rect.height - KEYBOARD_HEIGHT * .39) {
    for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
      if (!isBlack(midi)) continue;
      const key = noteGeometry(midi, rect.width);
      if (x >= key.x && x <= key.x + key.width) return midi;
    }
  }
  const { whiteWidth } = whiteKeyMetrics(rect.width);
  const whiteIndex = Math.min(51, Math.max(0, Math.floor(x / whiteWidth)));
  let index = -1;
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (!isBlack(midi) && ++index === whiteIndex) return midi;
  }
  return null;
}

let pointerNote: number | null = null;
canvas.addEventListener("pointerdown", async event => {
  const midi = pointerToMidi(event);
  if (midi === null) return;
  await Tone.start();
  canvas.setPointerCapture(event.pointerId);
  pointerNote = midi;
  synth.triggerAttack(midiName(midi), Tone.now(), .65);
  activeNotes.add(midi);
});
canvas.addEventListener("pointerup", () => {
  if (pointerNote === null) return;
  synth.triggerRelease(midiName(pointerNote));
  activeNotes.delete(pointerNote);
  pointerNote = null;
});
canvas.addEventListener("pointercancel", () => {
  if (pointerNote !== null) synth.triggerRelease(midiName(pointerNote));
  activeNotes.clear();
  pointerNote = null;
});

fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) void loadMidi(fileInput.files[0]); });
playButton.addEventListener("click", togglePlayback);
connectMidiButton.addEventListener("click", connectMidi);
settingsMidiButton.addEventListener("click", connectMidi);
libraryImportButton.addEventListener("click", () => fileInput.click());
libraryOpenButton.addEventListener("click", () => openPage("studio"));
pageTabs.forEach(tab => tab.addEventListener("click", () => openPage(tab.dataset.pageTarget || "studio")));
window.addEventListener("hashchange", () => activatePage(window.location.hash.slice(1)));
speedSelect.addEventListener("change", () => {
  const wasPlaying = isPlaying;
  if (wasPlaying) pausePlayback();
  speed = Number(speedSelect.value);
  transport.bpm.value = BASE_BPM * speed;
  transport.ticks = currentTime * TICKS_PER_SECOND;
  if (wasPlaying) startPlayback();
});
volumeSlider.addEventListener("input", () => { synth.volume.value = Number(volumeSlider.value); });
timeline.addEventListener("input", () => {
  const wasPlaying = isPlaying;
  if (wasPlaying) pausePlayback();
  currentTime = duration * Number(timeline.value) / 1000;
  transport.ticks = currentTime * TICKS_PER_SECOND;
  if (wasPlaying) startPlayback();
});

for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, event => { event.preventDefault(); dropMask.classList.add("visible"); });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, event => { event.preventDefault(); dropMask.classList.remove("visible"); });
}
dropZone.addEventListener("drop", event => {
  const file = event.dataTransfer?.files[0];
  if (file) void loadMidi(file);
});

new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();
activatePage(window.location.hash.slice(1));
requestAnimationFrame(draw);
