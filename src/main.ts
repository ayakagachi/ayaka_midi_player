import { Midi } from "@tonejs/midi";
import * as Tone from "tone";
import { loadConfig, onConfigChange, updateConfig } from "./config";
import * as library from "./libraryStore";
import "./style.css";

type PianoNote = {
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  track: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
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
const transposeDownButton = document.querySelector<HTMLButtonElement>("#transposeDown")!;
const transposeUpButton = document.querySelector<HTMLButtonElement>("#transposeUp")!;
const transposeValue = document.querySelector<HTMLElement>("#transposeValue")!;
const volumeSlider = document.querySelector<HTMLInputElement>("#volumeSlider")!;
const instrumentSelect = document.querySelector<HTMLSelectElement>("#instrumentSelect")!;
const songTitle = document.querySelector<HTMLElement>("#songTitle")!;
const songMeta = document.querySelector<HTMLElement>("#songMeta")!;
const trackInfo = document.querySelector<HTMLElement>("#trackInfo")!;
const emptyState = document.querySelector<HTMLElement>("#emptyState")!;
const emptyStateConnect = document.querySelector<HTMLButtonElement>("#emptyStateConnect")!;
const velocityLegend = document.querySelector<HTMLElement>("#velocityLegend")!;
const dropZone = document.querySelector<HTMLElement>("#dropZone")!;
const dropMask = document.querySelector<HTMLElement>("#dropMask")!;
const midiStatus = document.querySelector<HTMLElement>("#midiStatus")!;
const connectMidiButton = document.querySelector<HTMLButtonElement>("#connectMidiButton")!;
const settingsMidiButton = document.querySelector<HTMLButtonElement>("#settingsMidiButton")!;
const settingsMidiStatus = document.querySelector<HTMLElement>("#settingsMidiStatus")!;
const midiDeviceSelect = document.querySelector<HTMLSelectElement>("#midiDeviceSelect")!;
const settingsInstrumentName = document.querySelector<HTMLElement>("#settingsInstrumentName")!;
const libraryImportButton = document.querySelector<HTMLButtonElement>("#libraryImportButton")!;
const libraryOpenButton = document.querySelector<HTMLButtonElement>("#libraryOpenButton")!;
const libraryEmpty = document.querySelector<HTMLElement>("#libraryEmpty")!;
const libraryCurrent = document.querySelector<HTMLElement>("#libraryCurrent")!;
const librarySongTitle = document.querySelector<HTMLElement>("#librarySongTitle")!;
const librarySongMeta = document.querySelector<HTMLElement>("#librarySongMeta")!;
const libraryList = document.querySelector<HTMLElement>("#libraryList")!;
const toggleBackgroundPlayback = document.querySelector<HTMLButtonElement>("#toggleBackgroundPlayback")!;
const toggleSaveToLibrary = document.querySelector<HTMLButtonElement>("#toggleSaveToLibrary")!;
const libraryDirStatus = document.querySelector<HTMLElement>("#libraryDirStatus")!;
const pageTabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-target]"));
const pageViews = Array.from(document.querySelectorAll<HTMLElement>("[data-page]"));

// 主输出链：混音余量 -> 音量 -> 压缩 -> 限幅，避免和弦叠加削波产生爆音
const masterBus = new Tone.Gain(0.4);
const masterVolume = new Tone.Volume(Number(volumeSlider.value));
const compressor = new Tone.Compressor({ threshold: -18, ratio: 3, attack: 0.003, release: 0.25 });
const limiter = new Tone.Limiter(-1);
masterBus.chain(masterVolume, compressor, limiter, Tone.getDestination());

const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "triangle8" },
  envelope: { attack: 0.008, decay: 0.75, sustain: 0.24, release: 1.7 },
});
synth.maxPolyphony = 48;
synth.connect(masterBus);

const instrumentPresets = {
  piano: {
    label: "原声钢琴",
    oscillator: "triangle8",
    envelope: { attack: 0.008, decay: 0.75, sustain: 0.24, release: 1.7 },
  },
  bright: {
    label: "明亮钢琴",
    oscillator: "triangle4",
    envelope: { attack: 0.004, decay: 0.48, sustain: 0.16, release: 1.05 },
  },
  electric: {
    label: "电钢琴",
    oscillator: "sine8",
    envelope: { attack: 0.012, decay: 0.9, sustain: 0.34, release: 2.15 },
  },
  organ: {
    label: "管风琴",
    oscillator: "sine4",
    envelope: { attack: 0.025, decay: 0.16, sustain: 0.88, release: 0.42 },
  },
} as const;

type InstrumentId = keyof typeof instrumentPresets;

function applyInstrument(instrument: InstrumentId) {
  const preset = instrumentPresets[instrument];
  activeNotes.clear();
  const fade = 0.045; // 切换音色先短淡出，避免波形突变产生“啪”声
  const now = Tone.now();
  synth.volume.cancelScheduledValues(now);
  synth.volume.setValueAtTime(0, now);
  synth.volume.linearRampTo(-60, fade, now);
  window.setTimeout(() => {
    synth.releaseAll();
    synth.set({
      oscillator: { type: preset.oscillator },
      envelope: preset.envelope,
    });
    const t = Tone.now();
    synth.volume.cancelScheduledValues(t);
    synth.volume.setValueAtTime(-60, t);
    synth.volume.linearRampTo(0, fade, t);
  }, (fade + 0.01) * 1000);
  settingsInstrumentName.textContent = `${preset.label} · Tone.js 48 复音`;
}

const transport = Tone.getTransport();
transport.bpm.value = BASE_BPM;
const TICKS_PER_SECOND = transport.PPQ * 2;

let notes: PianoNote[] = [];
let duration = 0;
let currentTime = 0;
let speed = 1;
let transpose = 0;
let isPlaying = false;
let config = loadConfig();
let midiAccess: MIDIAccess | null = null;
let activeMidiInputId: string | null = null;
let nextVisualNoteIndex = 0;
let lastVisualTime = 0;
let lastFrameTime = performance.now();
const activeNotes = new Map<number, number>();
const particles: Particle[] = [];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

function findNextNoteIndex(time: number) {
  let low = 0;
  let high = notes.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (notes[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function emitParticles(midi: number, rawVelocity: number) {
  if (reducedMotion.matches || canvas.clientWidth === 0) return;
  const velocity = Math.min(1, Math.max(.05, rawVelocity));
  const key = noteGeometry(midi, canvas.clientWidth);
  const originX = key.x + key.width / 2;
  const originY = canvas.clientHeight - KEYBOARD_HEIGHT;
  const count = 3 + Math.round(velocity * 13);
  const color = midi < 60 ? "85, 167, 255" : "78, 225, 208";
  for (let index = 0; index < count; index++) {
    const maxLife = .34 + Math.random() * (.26 + velocity * .34);
    particles.push({
      x: originX + (Math.random() - .5) * key.width * velocity,
      y: originY - 2,
      vx: (Math.random() - .5) * (24 + velocity * 115),
      vy: -(35 + Math.random() * (45 + velocity * 105)),
      size: 1.2 + Math.random() * (1.5 + velocity * 3.2),
      life: maxLife,
      maxLife,
      color,
    });
  }
  if (particles.length > 700) particles.splice(0, particles.length - 700);
}

function drawParticles(deltaTime: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let index = particles.length - 1; index >= 0; index--) {
    const particle = particles[index];
    particle.life -= deltaTime;
    if (particle.life <= 0) {
      particles.splice(index, 1);
      continue;
    }
    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    particle.vy += 95 * deltaTime;
    const progress = particle.life / particle.maxLife;
    ctx.fillStyle = `rgba(${particle.color}, ${Math.min(1, progress * 1.35)})`;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (.55 + progress * .45), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return requestAnimationFrame(draw);

  const frameTime = performance.now();
  const deltaTime = Math.min(.05, (frameTime - lastFrameTime) / 1000);
  lastFrameTime = frameTime;

  if (isPlaying) {
    const nextTime = Math.min(duration, transport.ticks / TICKS_PER_SECOND);
    if (nextTime >= lastVisualTime && nextTime - lastVisualTime < .4) {
      while (nextVisualNoteIndex < notes.length && notes[nextVisualNoteIndex].time <= nextTime) {
        const note = notes[nextVisualNoteIndex++];
        const effective = note.midi + transpose;
        if (note.time >= lastVisualTime && effective >= NOTE_MIN && effective <= NOTE_MAX) {
          emitParticles(effective, note.velocity);
        }
      }
    } else {
      nextVisualNoteIndex = findNextNoteIndex(nextTime);
    }
    currentTime = nextTime;
    lastVisualTime = nextTime;
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
  const fileActiveNotes = new Map<number, number>();
  for (const note of notes) {
    if (note.time + note.duration < startWindow || note.time > endWindow) continue;
    const effective = note.midi + transpose;
    if (effective < NOTE_MIN || effective > NOTE_MAX) continue;
    const velocity = Math.min(1, Math.max(.05, note.velocity));
    if (note.time <= currentTime && note.time + note.duration >= currentTime) {
      fileActiveNotes.set(effective, Math.max(fileActiveNotes.get(effective) || 0, velocity));
    }
    const key = noteGeometry(effective, width);
    const noteEndY = fallHeight - (note.time - currentTime) * pxPerSecond;
    const noteHeight = Math.max(5, note.duration * pxPerSecond);
    const xPad = Math.max(.7, key.width * (.18 - velocity * .12));
    const color = note.midi < 60 ? LEFT_COLOR : RIGHT_COLOR;
    ctx.globalAlpha = .32 + velocity * .68;
    ctx.shadowBlur = (noteEndY > fallHeight - 14 ? 7 : 2) + velocity * 13;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    roundRect(key.x + xPad, noteEndY - noteHeight, key.width - xPad * 2, noteHeight, Math.min(4, key.width / 4));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  const keyVelocities = new Map(activeNotes);
  fileActiveNotes.forEach((velocity, midi) => {
    keyVelocities.set(midi, Math.max(keyVelocities.get(midi) || 0, velocity));
  });
  keyVelocities.forEach((velocity, midi) => {
    const key = noteGeometry(midi, width);
    const center = key.x + key.width / 2;
    const radius = Math.max(20, key.width * (1.8 + velocity * 3.8));
    const color = midi < 60 ? "85, 167, 255" : "78, 225, 208";
    const glow = ctx.createRadialGradient(center, fallHeight, 0, center, fallHeight, radius);
    glow.addColorStop(0, `rgba(${color}, ${.24 + velocity * .5})`);
    glow.addColorStop(.35, `rgba(${color}, ${.09 + velocity * .2})`);
    glow.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(center - radius, fallHeight - radius, radius * 2, radius);
  });
  drawParticles(deltaTime);

  ctx.fillStyle = "#dfe8e9";
  ctx.fillRect(0, fallHeight, width, KEYBOARD_HEIGHT);
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (isBlack(midi)) continue;
    const x = starts.get(midi)!;
    const velocity = keyVelocities.get(midi) || 0;
    ctx.fillStyle = "#e9eeee";
    ctx.fillRect(x + .5, fallHeight + 1, whiteWidth - 1, KEYBOARD_HEIGHT - 2);
    if (velocity > 0) {
      ctx.globalAlpha = .28 + velocity * .68;
      ctx.fillStyle = midi < 60 ? "#55a7ff" : "#4ee1d0";
      ctx.fillRect(x + .5, fallHeight + 1, whiteWidth - 1, KEYBOARD_HEIGHT - 2);
      ctx.globalAlpha = 1;
    }
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
    const velocity = keyVelocities.get(midi) || 0;
    ctx.fillStyle = "#0b151b";
    roundRect(key.x, fallHeight, key.width, KEYBOARD_HEIGHT * .61, 0, 0, 3, 3);
    ctx.fill();
    if (velocity > 0) {
      ctx.globalAlpha = .38 + velocity * .62;
      ctx.fillStyle = midi < 60 ? "#2f83d5" : "#20aa9b";
      ctx.fill();
      ctx.globalAlpha = 1;
    }
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
    const effective = note.midi + transpose;
    if (effective < NOTE_MIN || effective > NOTE_MAX) continue;
    const startTicks = Math.round(note.time * TICKS_PER_SECOND);
    const durationTicks = Math.max(1, Math.round(note.duration * TICKS_PER_SECOND));
    transport.schedule(time => {
      synth.triggerAttackRelease(midiName(effective), `${durationTicks}i`, time, Math.max(.08, note.velocity));
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
  lastVisualTime = currentTime - .001;
  nextVisualNoteIndex = findNextNoteIndex(lastVisualTime);
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

let pausedByHidden = false;
document.addEventListener("visibilitychange", () => {
  if (config.backgroundPlayback) return;
  if (document.hidden && isPlaying) {
    pausePlayback();
    pausedByHidden = true;
  } else if (!document.hidden && pausedByHidden) {
    pausedByHidden = false;
    startPlayback();
  }
});

onConfigChange(next => {
  config = next;
  if (!config.backgroundPlayback && document.hidden && isPlaying) {
    pausePlayback();
    pausedByHidden = true;
  }
  refreshSettings();
  void refreshLibrary();
});

async function refreshLibrary() {
  const entries = config.saveToLibrary && await library.restore() ? await library.list() : [];
  libraryList.replaceChildren(...entries.map(entry => {
    const item = document.createElement("div");
    item.className = "library-item";
    const name = document.createElement("span");
    name.textContent = entry.name.replace(/\.(mid|midi)$/i, "");
    const actions = document.createElement("div");
    actions.className = "library-actions";
    const openButton = document.createElement("button");
    openButton.className = "quiet-button";
    openButton.type = "button";
    openButton.textContent = "打开";
    openButton.addEventListener("click", async () => {
      try {
        void loadMidi(await library.open(entry.name), name.textContent ?? undefined);
      } catch {
        trackInfo.textContent = "曲库文件不可用";
      }
    });
    const removeButton = document.createElement("button");
    removeButton.className = "quiet-button";
    removeButton.type = "button";
    removeButton.textContent = "移出";
    removeButton.addEventListener("click", async () => {
      try {
        await library.remove(entry.name);
        void refreshLibrary();
      } catch {
        trackInfo.textContent = "曲库文件夹不可用";
      }
    });
    actions.append(openButton, removeButton);
    item.append(name, actions);
    return item;
  }));
  libraryList.hidden = !entries.length;
  if (!notes.length) libraryEmpty.hidden = entries.length > 0;
}

function refreshSettings() {
  toggleBackgroundPlayback.setAttribute("aria-checked", String(config.backgroundPlayback));
  if (!library.isSupported()) {
    toggleSaveToLibrary.disabled = true;
    toggleSaveToLibrary.setAttribute("aria-checked", "false");
    libraryDirStatus.textContent = "当前浏览器不支持（需 Chrome/Edge）";
    return;
  }
  toggleSaveToLibrary.disabled = false;
  toggleSaveToLibrary.setAttribute("aria-checked", String(config.saveToLibrary));
  if (!config.saveToLibrary) {
    libraryDirStatus.textContent = "未选择文件夹";
  } else {
    const name = library.directoryName();
    libraryDirStatus.textContent = name ? `曲库文件夹：${name}` : "未选择文件夹";
  }
}

function setTranspose(next: number) {
  transpose = Math.max(-6, Math.min(6, next));
  transposeValue.textContent = transpose > 0 ? `+${transpose}` : String(transpose);
  transposeDownButton.disabled = transpose <= -6;
  transposeUpButton.disabled = transpose >= 6;
  updateTransposeTag();
  if (!notes.length) return;
  const wasPlaying = isPlaying;
  if (wasPlaying) pausePlayback();
  scheduleSong();
  transport.ticks = currentTime * TICKS_PER_SECOND;
  if (wasPlaying) startPlayback();
}

const transposeTag = document.createElement("span");
transposeTag.className = "meta-tag meta-tag-amber";
function updateTransposeTag() {
  transposeTag.textContent = transpose > 0 ? `+${transpose} 调` : `${transpose} 调`;
  if (transpose !== 0 && notes.length && !transposeTag.isConnected) songMeta.append(transposeTag);
  if (transpose === 0 && transposeTag.isConnected) transposeTag.remove();
}

async function loadMidi(file: File, displayName?: string) {
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
    particles.length = 0;
    nextVisualNoteIndex = 0;
    lastVisualTime = 0;
    scheduleSong();
    const musicalTracks = midi.tracks.filter(track => track.notes.length > 0).length;
    const bpm = Math.round(midi.header.tempos[0]?.bpm || 120);
    songTitle.textContent = displayName || midi.name?.trim() || file.name.replace(/\.(mid|midi)$/i, "");
    const metaTags = [
      { text: `${musicalTracks} 条音轨`, tone: "blue" },
      { text: `${notes.length.toLocaleString()} 个音符`, tone: "cyan" },
      { text: `${bpm} BPM`, tone: "amber" },
    ];
    songMeta.replaceChildren(...metaTags.map(({ text, tone }) => {
      const tag = document.createElement("span");
      tag.className = `meta-tag meta-tag-${tone}`;
      tag.textContent = text;
      return tag;
    }));
    updateTransposeTag();
    librarySongTitle.textContent = songTitle.textContent;
    librarySongMeta.textContent = metaTags.map(tag => tag.text).join(" · ");
    libraryEmpty.hidden = true;
    libraryCurrent.hidden = false;
    if (config.saveToLibrary && library.isSupported()) {
      void library.ensureReady().then(async ok => {
        if (!ok) return;
        try {
          const written = await library.save(file);
          refreshSettings();
          void refreshLibrary();
          if (!written) trackInfo.textContent = "曲库中已有相同的曲目";
        } catch {
          trackInfo.textContent = "保存到曲库失败";
        }
      });
    }
    trackInfo.textContent = `${file.name} · ${formatTime(duration)}`;
    durationLabel.textContent = formatTime(duration);
    emptyState.classList.add("hidden");
    velocityLegend.hidden = false;
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
    const normalizedVelocity = Math.max(.05, velocity / 127);
    void Tone.start();
    synth.triggerAttack(midiName(note), Tone.now(), normalizedVelocity);
    activeNotes.set(note, normalizedVelocity);
    emptyState.classList.add("hidden");
    velocityLegend.hidden = false;
    emitParticles(note, normalizedVelocity);
  } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    synth.triggerRelease(midiName(note));
    activeNotes.delete(note);
  }
}

function bindMidiInputs() {
  if (!midiAccess) return;
  const inputs = Array.from(midiAccess.inputs.values());
  midiDeviceSelect.replaceChildren(...inputs.map(input => {
    const option = document.createElement("option");
    option.value = input.id;
    option.textContent = input.name || "MIDI 键盘";
    return option;
  }));
  midiDeviceSelect.hidden = inputs.length < 2;
  if (!inputs.some(input => input.id === activeMidiInputId)) activeMidiInputId = inputs[0]?.id ?? null;
  if (activeMidiInputId) midiDeviceSelect.value = activeMidiInputId;
  inputs.forEach(input => { input.onmidimessage = input.id === activeMidiInputId ? handleMidiMessage : null; });
  const activeInput = inputs.find(input => input.id === activeMidiInputId);
  if (inputs.length) {
    midiStatus.classList.add("connected");
    midiStatus.innerHTML = `<span></span>${inputs.length === 1 ? inputs[0].name || "MIDI 键盘" : `${activeInput?.name || "MIDI 键盘"} 已连接`}`;
    connectMidiButton.textContent = "重新扫描";
    settingsMidiStatus.textContent = inputs.length === 1 ? inputs[0].name || "MIDI 键盘已连接" : `${inputs.length} 个 MIDI 输入已连接`;
    settingsMidiButton.textContent = "重新扫描";
  } else {
    midiStatus.classList.remove("connected");
    midiStatus.innerHTML = "<span></span>未发现 MIDI 输入";
    settingsMidiStatus.textContent = "未发现 MIDI 输入";
  }
}

midiDeviceSelect.addEventListener("change", () => {
  activeMidiInputId = midiDeviceSelect.value;
  bindMidiInputs();
});

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
  const velocity = event.pressure > 0 ? Math.max(.25, event.pressure) : .65;
  synth.triggerAttack(midiName(midi), Tone.now(), velocity);
  activeNotes.set(midi, velocity);
  emptyState.classList.add("hidden");
  velocityLegend.hidden = false;
  emitParticles(midi, velocity);
});
canvas.addEventListener("pointermove", event => {
  if (pointerNote === null) return;
  const midi = pointerToMidi(event);
  if (midi === pointerNote) return;
  synth.triggerRelease(midiName(pointerNote));
  activeNotes.delete(pointerNote);
  pointerNote = midi;
  if (midi !== null) {
    const velocity = event.pressure > 0 ? Math.max(.25, event.pressure) : .65;
    synth.triggerAttack(midiName(midi), Tone.now(), velocity);
    activeNotes.set(midi, velocity);
    emitParticles(midi, velocity);
  }
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
emptyStateConnect.addEventListener("click", connectMidi);
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
volumeSlider.addEventListener("input", () => { masterVolume.volume.value = Number(volumeSlider.value); });
transposeDownButton.addEventListener("click", () => setTranspose(transpose - 1));
transposeUpButton.addEventListener("click", () => setTranspose(transpose + 1));
instrumentSelect.addEventListener("change", () => {
  applyInstrument(instrumentSelect.value as InstrumentId);
});
toggleBackgroundPlayback.addEventListener("click", () => {
  updateConfig({ backgroundPlayback: !config.backgroundPlayback });
});
toggleSaveToLibrary.addEventListener("click", async () => {
  if (config.saveToLibrary) {
    updateConfig({ saveToLibrary: false });
    return;
  }
  if (!library.directoryName() && !await library.pickDirectory()) return;
  updateConfig({ saveToLibrary: true });
  void refreshLibrary();
});
timeline.addEventListener("input", () => {
  const wasPlaying = isPlaying;
  if (wasPlaying) pausePlayback();
  currentTime = duration * Number(timeline.value) / 1000;
  particles.length = 0;
  lastVisualTime = currentTime;
  nextVisualNoteIndex = findNextNoteIndex(currentTime);
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
refreshSettings();
void library.restore().then(() => {
  refreshSettings();
  void refreshLibrary();
});
requestAnimationFrame(draw);
