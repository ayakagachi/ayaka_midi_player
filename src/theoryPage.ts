// 乐理页：二级子导航 + 4 个子页 + 共享键盘组件 + 独立合成器
// 依赖 theory.ts（纯数据）、keyboard.ts（琴键几何）、tone（发声）

import * as Tone from "tone";
import { isBlack, midiName, noteGeometry, whiteKeyMetrics } from "./keyboard";
import {
  CHORD_QUALITIES,
  CIRCLE_OF_FIFTHS,
  MODES,
  SCALES,
  chordMidiNotes,
  scaleChords,
  intervalBetween,
  intervalsToSteps,
  nameToMidi,
  pitchClassName,
  scaleNotes,
  type ChordQuality,
  type CircleKey,
} from "./theory";

export interface TheoryHost {
  output: Tone.ToneAudioNode;
  /** 返回钢琴采样器（惰性加载），乐理页优先用它发声；未提供或未就绪时回退到合成器 */
  pianoSampler?: () => Tone.Sampler;
  keyMin?: number;
  keyMax?: number;
}

const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10];
const NOTE_OPTIONS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// —— 模块级状态（initTheoryPage 仅调用一次）——
let synth: Tone.PolySynth<Tone.Synth>;
let pianoSampler: (() => Tone.Sampler) | null = null;
let piano: Tone.Sampler | null = null;
let keyMin = 48;
let keyMax = 84;

// 乐理键盘固定窗口：C4–C6（两个八度），底不随根音移动
const THEORY_KEYBOARD_MIN = 60;
const THEORY_KEYBOARD_MAX = 84;

// 调式/音阶播放按钮：1× 速度下相邻音间隔（秒），速度倍率越大间隔越小
const SCALE_BASE_STEP = 0.12;

// 共享音阶状态：根音 + 音程 + 名称 + 拼写
let scaleState = { root: 0, intervals: [...MAJOR_INTERVALS], kindLabel: "大调", flats: false };
// 五度圈高亮状态（仅大调/关系小调）
let tonic = 0;
let mode: "major" | "minor" = "major";

let withSevenths = true;
let scaleSpeed = 1; // 调式/音阶播放速度倍率（0.5× / 1× / 2× …）
let chordTeach: { rootPc: number; quality: ChordQuality } = { rootPc: 0, quality: CHORD_QUALITIES[0] };
let chordTypeRow: HTMLElement;
let diatonicHint: HTMLElement;

let subChips: HTMLButtonElement[] = [];
let subPanels: HTMLElement[] = [];
let scaleKeyboards: KeyboardHandle[] = [];
let chordKeyboard: KeyboardHandle | null = null;
let intervalKeyboard: KeyboardHandle | null = null;

let circleGroups: { key: CircleKey; major: SVGGElement; minor: SVGGElement }[] = [];
let circleCenterMajor: SVGTextElement;
let circleCenterMinor: SVGTextElement;
let circleCenterAcc: SVGTextElement;
let circleReadout: HTMLElement;

let scalesRootSelect: HTMLSelectElement;
let scalesLabel: HTMLElement;
let scalesDetail: HTMLElement;
let chordsScaleLabel: HTMLElement;
let chordsScaleDetail: HTMLElement;
let diatonicGrid: HTMLElement;
let chordTeachRootSelect: HTMLSelectElement;
let chordTeachQualitySelect: HTMLSelectElement;
let chordLabel: HTMLElement;
let intervalNoteA: HTMLSelectElement;
let intervalOctaveA: HTMLSelectElement;
let intervalNoteB: HTMLSelectElement;
let intervalOctaveB: HTMLSelectElement;
let intervalResult: HTMLElement;

// —— 通用 DOM 工具 ——
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function fillNoteSelect(select: HTMLSelectElement, selectedPc: number) {
  select.replaceChildren(...NOTE_OPTIONS.map((name, pc) => {
    const option = document.createElement("option");
    option.value = String(pc);
    option.textContent = name;
    return option;
  }));
  select.value = String(selectedPc);
}

function sameIntervals(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function accidentalMark(n: number): string {
  return n > 0 ? `${n}♯` : n < 0 ? `${-n}♭` : "";
}

function accidentalLabel(n: number): string {
  return n === 0 ? "无升降号" : accidentalMark(n);
}

// —— 发声 ——
// 乐理页优先用钢琴采样发声，采样尚未就绪时回退到合成器；时值缩短避免拖音
function ensurePiano(): Tone.Sampler | null {
  if (!pianoSampler) return null;
  if (!piano) piano = pianoSampler();
  return piano;
}

function trigger(midi: number, duration: number, time: number, velocity: number) {
  const note = midiName(midi);
  const p = ensurePiano();
  if (p && p.loaded) p.triggerAttackRelease(note, duration, time, velocity);
  else synth.triggerAttackRelease(note, duration, time, velocity);
}

function playNotes(midis: number[], velocity = 0.8) {
  const now = Tone.now();
  midis.forEach(midi => trigger(midi, 0.6, now, velocity));
}

function playArpeggio(midis: number[], step = 0.09, velocity = 0.8) {
  const now = Tone.now();
  midis.forEach((midi, index) => trigger(midi, 0.5, now + index * step, velocity));
}

async function playNotesAsync(midis: number[], velocity = 0.8) {
  await Tone.start();
  playNotes(midis, velocity);
}

async function playArpeggioAsync(midis: number[], step = 0.09) {
  await Tone.start();
  playArpeggio(midis, step);
}

async function playNote(midi: number) {
  await Tone.start();
  trigger(midi, 0.5, Tone.now(), 0.75);
}

// 根音 + 音程 → 升序 MIDI 音（供发声，锚在 baseOctave）
function scaleMidis(rootPc: number, intervals: number[], baseOctave = 4): number[] {
  const rootMidi = (baseOctave + 1) * 12 + rootPc;
  return intervals.map(i => rootMidi + i);
}

// —— 共享键盘组件 ——
interface KeyboardHandle {
  canvas: HTMLCanvasElement;
  setHighlight(notes: Set<number>, opts?: { rootPc?: number; rootMidis?: number[]; exact?: boolean }): void;
  setRange(lo: number, hi: number): void;
  render(): void;
}

function mountKeyboard(container: HTMLElement, opts: { keyMin: number; keyMax: number; onNote: (midi: number) => void }): KeyboardHandle {
  const canvas = document.createElement("canvas");
  canvas.className = "theory-keyboard";
  canvas.setAttribute("aria-label", "乐理键盘");
  container.appendChild(canvas);

  let lo = opts.keyMin;
  let hi = opts.keyMax;
  let highlightNotes: Set<number> = new Set();
  let highlightExact = false;
  let rootPc: number | null = null;
  let rootMidis: Set<number> = new Set();

  function render() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    g.clearRect(0, 0, width, height);
    g.fillStyle = "#08131d";
    g.fillRect(0, 0, width, height);

    const { whiteWidth, starts } = whiteKeyMetrics(width, lo, hi);

    for (let midi = lo; midi <= hi; midi++) {
      if (isBlack(midi)) continue;
      const x = starts.get(midi)!;
      const pc = midi % 12;
      const isRoot = highlightExact ? rootMidis.has(midi) : pc === rootPc;
      const isHi = highlightExact ? highlightNotes.has(midi) : highlightNotes.has(pc);
      g.fillStyle = isRoot ? "#ffbd66" : isHi ? "#4ee1d0" : "#e9eeee";
      g.fillRect(x + 0.5, 1, whiteWidth - 1, height - 2);
      g.strokeStyle = "#83939a";
      g.strokeRect(x + 0.5, 0.5, whiteWidth, height);
      if (pc === 0 && whiteWidth > 13) {
        g.fillStyle = isHi || isRoot ? "#06201d" : "#62737a";
        g.font = "10px Manrope, sans-serif";
        g.textAlign = "center";
        g.fillText(midiName(midi), x + whiteWidth / 2, height - 8);
      }
    }
    for (let midi = lo; midi <= hi; midi++) {
      if (!isBlack(midi)) continue;
      const key = noteGeometry(midi, width, lo, hi);
      const pc = midi % 12;
      const isRoot = highlightExact ? rootMidis.has(midi) : pc === rootPc;
      const isHi = highlightExact ? highlightNotes.has(midi) : highlightNotes.has(pc);
      g.fillStyle = isRoot ? "#ffbd66" : isHi ? "#2ecbb9" : "#0b151b";
      g.beginPath();
      g.roundRect(key.x, 0, key.width, height * 0.61, [0, 0, 3, 3]);
      g.fill();
    }
  }

  function midiAtPointer(x: number, y: number, width: number, height: number): number | null {
    if (y < height * 0.61) {
      for (let midi = lo; midi <= hi; midi++) {
        if (!isBlack(midi)) continue;
        const key = noteGeometry(midi, width, lo, hi);
        if (x >= key.x && x <= key.x + key.width) return midi;
      }
    }
    const { whiteWidth } = whiteKeyMetrics(width, lo, hi);
    const whites: number[] = [];
    for (let midi = lo; midi <= hi; midi++) if (!isBlack(midi)) whites.push(midi);
    const index = Math.min(whites.length - 1, Math.max(0, Math.floor(x / whiteWidth)));
    return whites[index] ?? null;
  }

  canvas.addEventListener("pointerdown", event => {
    const rect = canvas.getBoundingClientRect();
    const midi = midiAtPointer(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    if (midi != null) opts.onNote(midi);
  });

  new ResizeObserver(render).observe(canvas);
  render();

  return {
    canvas,
    setHighlight(notes, highlightOpts) {
      highlightNotes = notes;
      highlightExact = highlightOpts?.exact ?? false;
      rootPc = highlightOpts?.rootPc ?? null;
      rootMidis = new Set(highlightOpts?.rootMidis ?? []);
      render();
    },
    setRange(nextLo, nextHi) {
      lo = nextLo;
      hi = nextHi;
    },
    render,
  };
}

// —— 共享音阶状态 ——
function applyScale(root: number, intervals: number[], kindLabel: string, useFlats = scaleState.flats) {
  scaleState = { root, intervals, kindLabel, flats: useFlats };
  if (sameIntervals(intervals, MAJOR_INTERVALS)) { tonic = root; mode = "major"; }
  else if (sameIntervals(intervals, MINOR_INTERVALS)) { tonic = root; mode = "minor"; }
  syncScaleUI();
  renderDiatonicGrid();
}

function applyScaleRoot(root: number) {
  applyScale(root, scaleState.intervals, scaleState.kindLabel, scaleState.flats);
}

function scaleLabel(): string {
  return `${pitchClassName(scaleState.root, scaleState.flats)} ${scaleState.kindLabel}`;
}

function syncScaleUI() {
  const label = scaleLabel();
  const noteList = scaleNotes(scaleState.root, scaleState.intervals)
    .map(pc => pitchClassName(pc, scaleState.flats)).join(" ");
  if (scalesLabel) scalesLabel.textContent = label;
  if (scalesDetail) scalesDetail.textContent = `${noteList} · ${intervalsToSteps(scaleState.intervals)}`;
  if (chordsScaleLabel) chordsScaleLabel.textContent = label;
  if (chordsScaleDetail) chordsScaleDetail.textContent = `${noteList} · ${intervalsToSteps(scaleState.intervals)}`;
  if (scalesRootSelect) scalesRootSelect.value = String(scaleState.root);
  // 键盘底固定为 C4–C6（两个八度），不随根音移动；蓝色只循环一遍（2–7 级），根音标黄
  const rootMidi = 60 + scaleState.root;
  const blueMidis = scaleState.intervals.slice(1).map(i => rootMidi + i);
  for (const keyboard of scaleKeyboards) {
    keyboard.setRange(THEORY_KEYBOARD_MIN, THEORY_KEYBOARD_MAX);
    keyboard.setHighlight(new Set(blueMidis), { rootMidis: [rootMidi], exact: true });
  }
}

// —— 五度圈 ——
function selectCircleKey(key: CircleKey, isMinor: boolean) {
  const useFlats = key.accidental < 0;
  applyScale(isMinor ? key.minorPc : key.majorPc, isMinor ? MINOR_INTERVALS : MAJOR_INTERVALS, isMinor ? "小调" : "大调", useFlats);
  renderCircle();
  switchSubPage("scales");
}

function renderCircle() {
  for (const { key, major, minor } of circleGroups) {
    major.classList.toggle("active", mode === "major" && tonic === key.majorPc);
    minor.classList.toggle("active", mode === "minor" && tonic === key.minorPc);
  }
  const selected = CIRCLE_OF_FIFTHS.find(key => (mode === "major" ? key.majorPc : key.minorPc) === tonic);
  if (!selected) return;
  circleCenterMajor.textContent = mode === "major" ? selected.majorName : selected.minorName;
  circleCenterMinor.textContent = mode === "major" ? `关系小调 ${selected.minorName}` : `关系大调 ${selected.majorName}`;
  circleCenterAcc.textContent = accidentalLabel(selected.accidental);
  circleReadout.textContent = `${mode === "major" ? selected.majorName : selected.minorName} ${mode === "major" ? "大调" : "小调"} · ${accidentalLabel(selected.accidental)}`;
}

function buildCircle(container: HTMLElement) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 480 480");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "五度圈，顺时针五度上行加升号，逆时针五度下行加降号");
  svg.classList.add("circle-svg");
  const c = 240;
  const majorR = 166;   // 大调文字环
  const minorR = 116;   // 小调文字环
  const centerR = 84;   // 中心信息圆
  const arrowR = 216;   // 方向箭头弧

  const ring = (r: number, cls: string) => {
    const circ = document.createElementNS(NS, "circle");
    circ.setAttribute("cx", String(c));
    circ.setAttribute("cy", String(c));
    circ.setAttribute("r", String(r));
    circ.setAttribute("fill", "none");
    circ.setAttribute("class", cls);
    svg.appendChild(circ);
  };
  ring(196, "circle-ring");
  ring(140, "circle-ring circle-ring-soft");
  ring(centerR, "circle-center");

  // 每个五度位置在大小调分隔环上点一个刻度点
  CIRCLE_OF_FIFTHS.forEach(key => {
    const angle = (-90 + key.index * 30) * Math.PI / 180;
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", String(c + Math.cos(angle) * 140));
    dot.setAttribute("cy", String(c + Math.sin(angle) * 140));
    dot.setAttribute("r", "1.6");
    dot.setAttribute("class", "circle-tick");
    svg.appendChild(dot);
  });

  // 方向箭头：顺时针五度上行（加 ♯）、逆时针五度下行（加 ♭）
  const arcPoint = (deg: number, r: number) => {
    const rad = deg * Math.PI / 180;
    return `${(c + Math.cos(rad) * r).toFixed(2)} ${(c + Math.sin(rad) * r).toFixed(2)}`;
  };
  const defs = document.createElementNS(NS, "defs");
  const marker = document.createElementNS(NS, "marker");
  marker.setAttribute("id", "cfArrow");
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerWidth", "7");
  marker.setAttribute("markerHeight", "7");
  marker.setAttribute("orient", "auto");
  const markerPath = document.createElementNS(NS, "path");
  markerPath.setAttribute("d", "M1 1 L8 5 L1 9");
  markerPath.setAttribute("class", "circle-arrow-head");
  marker.appendChild(markerPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  const addArc = (id: string, d: string, withMarker: boolean) => {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("id", id);
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("class", withMarker ? "circle-arrow" : "circle-arrow-track");
    if (withMarker) path.setAttribute("marker-end", "url(#cfArrow)");
    svg.appendChild(path);
    return path;
  };
  const addArcLabel = (pathId: string, textContent: string) => {
    const text = document.createElementNS(NS, "text");
    text.setAttribute("class", "circle-arrow-label");
    const textPath = document.createElementNS(NS, "textPath");
    textPath.setAttribute("href", `#${pathId}`);
    textPath.setAttribute("startOffset", "50%");
    textPath.setAttribute("text-anchor", "middle");
    textPath.textContent = textContent;
    text.appendChild(textPath);
    svg.appendChild(text);
  };
  // 文字放在箭头弧外侧一点的隐形弧上，避免压线；两条都按顺时针书写保持正立
  const labelR = arrowR + 14;
  // 右上：顺时针（-70° → -20°）
  addArc("cfArcCw", `M ${arcPoint(-70, arrowR)} A ${arrowR} ${arrowR} 0 0 1 ${arcPoint(-20, arrowR)}`, true);
  addArc("cfArcCwLabel", `M ${arcPoint(-75, labelR)} A ${labelR} ${labelR} 0 0 1 ${arcPoint(-15, labelR)}`, false);
  addArcLabel("cfArcCwLabel", "五度上行 · 加 ♯");
  // 左上：逆时针（-110° → -160°）
  addArc("cfArcCcw", `M ${arcPoint(-110, arrowR)} A ${arrowR} ${arrowR} 0 0 0 ${arcPoint(-160, arrowR)}`, true);
  addArc("cfArcCcwLabel", `M ${arcPoint(-165, labelR)} A ${labelR} ${labelR} 0 0 1 ${arcPoint(-105, labelR)}`, false);
  addArcLabel("cfArcCcwLabel", "五度下行 · 加 ♭");

  CIRCLE_OF_FIFTHS.forEach(key => {
    const angle = (-90 + key.index * 30) * Math.PI / 180;
    const ox = c + Math.cos(angle) * majorR;
    const oy = c + Math.sin(angle) * majorR;
    const ix = c + Math.cos(angle) * minorR;
    const iy = c + Math.sin(angle) * minorR;

    const majorG = document.createElementNS(NS, "g");
    majorG.setAttribute("class", "circle-key circle-key-major");
    const majorGlow = document.createElementNS(NS, "circle");
    majorGlow.setAttribute("cx", String(ox));
    majorGlow.setAttribute("cy", String(oy));
    majorGlow.setAttribute("r", "25");
    majorGlow.setAttribute("class", "circle-glow");
    const majorHit = document.createElementNS(NS, "circle");
    majorHit.setAttribute("cx", String(ox));
    majorHit.setAttribute("cy", String(oy));
    majorHit.setAttribute("r", "28");
    majorHit.setAttribute("fill", "transparent");
    majorHit.setAttribute("class", "circle-hit");
    const majorText = document.createElementNS(NS, "text");
    majorText.setAttribute("x", String(ox));
    majorText.setAttribute("y", String(oy + 4));
    majorText.setAttribute("text-anchor", "middle");
    majorText.setAttribute("class", "circle-text circle-major");
    majorText.textContent = key.majorName;
    const accText = document.createElementNS(NS, "text");
    accText.setAttribute("x", String(ox));
    accText.setAttribute("y", String(oy + 19));
    accText.setAttribute("text-anchor", "middle");
    accText.setAttribute("class", "circle-acc");
    accText.textContent = accidentalMark(key.accidental);
    majorG.append(majorGlow, majorHit, majorText, accText);

    const minorG = document.createElementNS(NS, "g");
    minorG.setAttribute("class", "circle-key circle-key-minor");
    const minorGlow = document.createElementNS(NS, "circle");
    minorGlow.setAttribute("cx", String(ix));
    minorGlow.setAttribute("cy", String(iy));
    minorGlow.setAttribute("r", "19");
    minorGlow.setAttribute("class", "circle-glow");
    const minorHit = document.createElementNS(NS, "circle");
    minorHit.setAttribute("cx", String(ix));
    minorHit.setAttribute("cy", String(iy));
    minorHit.setAttribute("r", "24");
    minorHit.setAttribute("fill", "transparent");
    minorHit.setAttribute("class", "circle-hit");
    const minorText = document.createElementNS(NS, "text");
    minorText.setAttribute("x", String(ix));
    minorText.setAttribute("y", String(iy + 5));
    minorText.setAttribute("text-anchor", "middle");
    minorText.setAttribute("class", "circle-text circle-minor");
    minorText.textContent = key.minorName;
    minorG.append(minorGlow, minorHit, minorText);

    majorG.style.cursor = "pointer";
    minorG.style.cursor = "pointer";
    majorG.addEventListener("click", () => selectCircleKey(key, false));
    minorG.addEventListener("click", () => selectCircleKey(key, true));
    svg.append(majorG, minorG);
    circleGroups.push({ key, major: majorG, minor: minorG });
  });

  circleCenterMajor = document.createElementNS(NS, "text");
  circleCenterMajor.setAttribute("x", String(c));
  circleCenterMajor.setAttribute("y", String(c - 6));
  circleCenterMajor.setAttribute("text-anchor", "middle");
  circleCenterMajor.setAttribute("class", "circle-center-major");
  circleCenterMinor = document.createElementNS(NS, "text");
  circleCenterMinor.setAttribute("x", String(c));
  circleCenterMinor.setAttribute("y", String(c + 16));
  circleCenterMinor.setAttribute("text-anchor", "middle");
  circleCenterMinor.setAttribute("class", "circle-center-sub");
  circleCenterAcc = document.createElementNS(NS, "text");
  circleCenterAcc.setAttribute("x", String(c));
  circleCenterAcc.setAttribute("y", String(c + 36));
  circleCenterAcc.setAttribute("text-anchor", "middle");
  circleCenterAcc.setAttribute("class", "circle-center-acc");
  svg.append(circleCenterMajor, circleCenterMinor, circleCenterAcc);

  const readout = el("p", "circle-readout", "");
  container.append(svg, readout);
  circleReadout = readout;
  renderCircle();
}

// —— 调式与音阶 ——
function selectScale(root: number, intervals: number[], kindLabel: string) {
  applyScale(root, intervals, kindLabel);
  void playArpeggioAsync(scaleMidis(scaleState.root, scaleState.intervals));
}

// 播放按钮：按当前速度重播选中的调式/音阶
function playCurrentScale() {
  const step = SCALE_BASE_STEP / scaleSpeed;
  void playArpeggioAsync(scaleMidis(scaleState.root, scaleState.intervals), step);
}

function buildScales(container: HTMLElement) {
  // 顶部：当前选择的调式 + 根音，醒目显示（跳转后一眼看清）
  const banner = el("div", "theory-current-banner");
  scalesLabel = el("span", "theory-current-scale", "");
  scalesDetail = el("span", "theory-current-detail", "");
  banner.append(el("span", "theory-current-kicker", "当前音阶"), scalesLabel, scalesDetail);
  container.append(banner);

  const rootRow = el("div", "theory-control-row");
  scalesRootSelect = document.createElement("select");
  scalesRootSelect.setAttribute("aria-label", "根音");
  fillNoteSelect(scalesRootSelect, 0);
  rootRow.append(el("span", "theory-label", "根音"), scalesRootSelect);
  container.append(rootRow);

  // 播放当前调式/音阶 + 速度调节
  const playRow = el("div", "theory-control-row");
  const playButton = el("button", "quiet-button", "播放");
  playButton.type = "button";
  const speedSelect = document.createElement("select");
  speedSelect.setAttribute("aria-label", "播放速度");
  speedSelect.replaceChildren(...[["0.5", "0.5×"], ["0.75", "0.75×"], ["1", "1×"], ["1.5", "1.5×"], ["2", "2×"]].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  speedSelect.value = "1";
  playRow.append(playButton, el("span", "theory-label", "速度"), speedSelect);
  container.append(playRow);
  playButton.addEventListener("click", playCurrentScale);
  speedSelect.addEventListener("change", () => { scaleSpeed = Number(speedSelect.value); });

  const modeHead = el("h3", "theory-section-title", "中古调式");
  const modeList = el("div", "theory-chip-list");
  for (const m of MODES) {
    const button = el("button", "theory-item");
    button.type = "button";
    button.append(
      el("span", "theory-item-name", m.nameZh),
      el("span", "theory-item-sub", `${m.name} · ${intervalsToSteps(m.intervals)}`),
    );
    button.addEventListener("click", () => selectScale(Number(scalesRootSelect.value), m.intervals, m.nameZh));
    modeList.append(button);
  }

  const scaleHead = el("h3", "theory-section-title", "常用音阶");
  const scaleList = el("div", "theory-chip-list");
  for (const s of SCALES) {
    const button = el("button", "theory-item");
    button.type = "button";
    button.append(
      el("span", "theory-item-name", s.nameZh),
      el("span", "theory-item-sub", intervalsToSteps(s.intervals)),
    );
    button.addEventListener("click", () => selectScale(Number(scalesRootSelect.value), s.intervals, s.nameZh));
    scaleList.append(button);
  }

  const wrap = el("div", "theory-keyboard-wrap");
  container.append(modeHead, modeList, scaleHead, scaleList, wrap);
  scaleKeyboards.push(mountKeyboard(wrap, { keyMin, keyMax, onNote: playNote }));

  scalesRootSelect.addEventListener("change", () => applyScaleRoot(Number(scalesRootSelect.value)));
}

// —— 和弦 ——
function highlightChordKeyboard(midis: number[]) {
  if (!chordKeyboard || midis.length === 0) return;
  // 键盘底固定为 C4–C6（两个八度），不随根音移动；蓝色只标一个循环（和弦组成音），根音标黄
  chordKeyboard.setRange(THEORY_KEYBOARD_MIN, THEORY_KEYBOARD_MAX);
  chordKeyboard.setHighlight(new Set(midis), { rootMidis: [midis[0]], exact: true });
}

function renderDiatonicGrid() {
  if (!diatonicGrid) return;
  // 调内和弦只对七声音阶有标准定义；五声/蓝调隐藏格子并提示
  const heptatonic = scaleState.intervals.length === 7;
  chordTypeRow.hidden = !heptatonic;
  diatonicGrid.hidden = !heptatonic;
  diatonicHint.hidden = heptatonic;
  if (!heptatonic) return;
  const chords = scaleChords(scaleState.root, scaleState.intervals, withSevenths, scaleState.flats);
  diatonicGrid.replaceChildren(...chords.map(chord => {
    const card = el("button", "theory-chord-card");
    card.type = "button";
    card.append(
      el("span", "chord-roman", chord.roman),
      el("span", "chord-symbol", `${chord.rootName}${chord.suffix}`),
    );
    card.addEventListener("click", () => {
      const midis = chordMidiNotes(chord.rootPc, chord.intervals, 4);
      highlightChordKeyboard(midis);
      void playNotesAsync(midis);
    });
    return card;
  }));
}

function applyChordTeach(autoPlay: boolean) {
  const quality = chordTeach.quality;
  const midis = chordMidiNotes(chordTeach.rootPc, quality.intervals, 4);
  const notes = midis.map(midi => pitchClassName(midi)).join(" ");
  chordLabel.textContent = `${pitchClassName(chordTeach.rootPc)} ${quality.nameZh}：${notes}`;
  highlightChordKeyboard(midis);
  if (autoPlay) void playNotesAsync(midis);
}

function buildChords(container: HTMLElement) {
  // 顶部：当前音阶，让「调内和弦」一眼看出所属调
  const banner = el("div", "theory-current-banner");
  chordsScaleLabel = el("span", "theory-current-scale", "");
  chordsScaleDetail = el("span", "theory-current-detail", "");
  banner.append(el("span", "theory-current-kicker", "当前音阶"), chordsScaleLabel, chordsScaleDetail);
  container.append(banner);

  const head = el("h3", "theory-section-title", "调内和弦");
  const toggleRow = el("div", "theory-control-row");
  const chordTypeSelect = document.createElement("select");
  chordTypeSelect.setAttribute("aria-label", "和弦类型");
  chordTypeSelect.replaceChildren(...[["triad", "三和弦"], ["seventh", "七和弦"]].map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }));
  chordTypeSelect.value = withSevenths ? "seventh" : "triad";
  toggleRow.append(el("span", "theory-label", "和弦类型"), chordTypeSelect);
  chordTypeSelect.addEventListener("change", () => {
    withSevenths = chordTypeSelect.value === "seventh";
    renderDiatonicGrid();
  });
  chordTypeRow = toggleRow;
  diatonicGrid = el("div", "theory-chord-grid");
  diatonicHint = el("p", "theory-hint", "五声 / 蓝调音阶无标准七级调内和弦");
  container.append(head, toggleRow, diatonicGrid, diatonicHint);

  const teachHead = el("h3", "theory-section-title", "和弦教学");
  const teachRow = el("div", "theory-control-row");
  chordTeachRootSelect = document.createElement("select");
  chordTeachRootSelect.setAttribute("aria-label", "根音");
  fillNoteSelect(chordTeachRootSelect, 0);
  chordTeachQualitySelect = document.createElement("select");
  chordTeachQualitySelect.setAttribute("aria-label", "和弦性质");
  chordTeachQualitySelect.replaceChildren(...CHORD_QUALITIES.map(quality => {
    const option = document.createElement("option");
    option.value = quality.id;
    option.textContent = quality.nameZh;
    return option;
  }));
  const playButton = el("button", "quiet-button", "播放");
  playButton.type = "button";
  teachRow.append(
    el("span", "theory-label", "根音"), chordTeachRootSelect,
    el("span", "theory-label", "性质"), chordTeachQualitySelect,
    playButton,
  );
  chordLabel = el("p", "theory-current-label", "");
  const wrap = el("div", "theory-keyboard-wrap");
  container.append(teachHead, teachRow, chordLabel, wrap);
  chordKeyboard = mountKeyboard(wrap, { keyMin, keyMax, onNote: playNote });

  chordTeachRootSelect.addEventListener("change", () => {
    chordTeach.rootPc = Number(chordTeachRootSelect.value);
    applyChordTeach(false);
  });
  chordTeachQualitySelect.addEventListener("change", () => {
    chordTeach.quality = CHORD_QUALITIES.find(quality => quality.id === chordTeachQualitySelect.value)!;
    applyChordTeach(true);
  });
  playButton.addEventListener("click", () => applyChordTeach(true));

  renderDiatonicGrid();
  applyChordTeach(false);
}

// —— 音程 ——
// 音名与八度拆成两个短下拉，避免 17 拼写 × 3 八度的超长列表
const INTERVAL_SPELLINGS = ["C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B"];

function intervalNameA(): string {
  return `${intervalNoteA.value}${intervalOctaveA.value}`;
}

function intervalNameB(): string {
  return `${intervalNoteB.value}${intervalOctaveB.value}`;
}

function updateInterval() {
  const a = intervalNameA();
  const b = intervalNameB();
  const result = intervalBetween(a, b);
  const directionText = result.direction === 1 ? "上行" : result.direction === -1 ? "下行" : "同度";
  intervalResult.replaceChildren(
    el("div", "interval-big", result.nameZh),
    el("div", "interval-sub", `${result.nameEn} · ${Math.abs(result.semitones)} 半音 · ${directionText}`),
  );
  const midiA = nameToMidi(a);
  const midiB = nameToMidi(b);
  if (midiA >= 0 && midiB >= 0) {
    intervalKeyboard?.setHighlight(new Set([midiA, midiB]), { exact: true, rootMidis: [Math.min(midiA, midiB)] });
  }
}

function makeIntervalSelects(labelPrefix: string, note: string, octave: string): [HTMLSelectElement, HTMLSelectElement] {
  const noteSelect = document.createElement("select");
  noteSelect.setAttribute("aria-label", `${labelPrefix}音名`);
  noteSelect.replaceChildren(...INTERVAL_SPELLINGS.map(spelling => {
    const option = document.createElement("option");
    option.value = spelling;
    option.textContent = spelling.replace("#", "♯").replace("b", "♭");
    return option;
  }));
  noteSelect.value = note;
  const octaveSelect = document.createElement("select");
  octaveSelect.setAttribute("aria-label", `${labelPrefix}八度`);
  octaveSelect.replaceChildren(...["3", "4", "5"].map(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
  octaveSelect.value = octave;
  return [noteSelect, octaveSelect];
}

function buildInterval(container: HTMLElement) {
  const row = el("div", "theory-control-row");
  [intervalNoteA, intervalOctaveA] = makeIntervalSelects("起始音", "C", "4");
  [intervalNoteB, intervalOctaveB] = makeIntervalSelects("结束音", "G", "4");
  const playUpButton = el("button", "quiet-button", "上行");
  playUpButton.type = "button";
  const playDownButton = el("button", "quiet-button", "下行");
  playDownButton.type = "button";
  const playTogetherButton = el("button", "quiet-button", "同时");
  playTogetherButton.type = "button";
  row.append(
    el("span", "theory-label", "从"), intervalNoteA, intervalOctaveA,
    el("span", "theory-label", "到"), intervalNoteB, intervalOctaveB,
    playUpButton, playDownButton, playTogetherButton,
  );
  intervalResult = el("div", "theory-interval-result", "");
  const wrap = el("div", "theory-keyboard-wrap");
  container.append(row, intervalResult, wrap);
  intervalKeyboard = mountKeyboard(wrap, { keyMin, keyMax, onNote: playNote });

  // 旋律音程逐个发声，间隔放宽到 0.45s 便于分辨两个音
  const INTERVAL_STEP = 0.45;
  function intervalMidis(): [number, number] | null {
    const a = nameToMidi(intervalNameA());
    const b = nameToMidi(intervalNameB());
    return a >= 0 && b >= 0 ? [a, b] : null;
  }

  for (const select of [intervalNoteA, intervalOctaveA, intervalNoteB, intervalOctaveB]) {
    select.addEventListener("change", updateInterval);
  }
  playUpButton.addEventListener("click", () => {
    const midis = intervalMidis();
    if (midis) void playArpeggioAsync([Math.min(...midis), Math.max(...midis)], INTERVAL_STEP);
  });
  playDownButton.addEventListener("click", () => {
    const midis = intervalMidis();
    if (midis) void playArpeggioAsync([Math.max(...midis), Math.min(...midis)], INTERVAL_STEP);
  });
  playTogetherButton.addEventListener("click", () => {
    const midis = intervalMidis();
    if (midis) void playNotesAsync(midis);
  });
  updateInterval();
}

// —— 子页切换 ——
function switchSubPage(id: string) {
  for (const panel of subPanels) panel.hidden = panel.dataset.theoryPanel !== id;
  for (const chip of subChips) {
    const active = chip.dataset.theoryPage === id;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-selected", String(active));
  }
}

// —— 入口 ——
export function initTheoryPage(host: TheoryHost): void {
  const root = document.querySelector<HTMLElement>("#page-theory");
  if (!root) return;
  keyMin = host.keyMin ?? 48;
  keyMax = host.keyMax ?? 84;
  pianoSampler = host.pianoSampler ?? null;

  synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle8" },
    envelope: { attack: 0.006, decay: 0.45, sustain: 0.18, release: 0.7 },
  });
  synth.maxPolyphony = 16;
  synth.volume.value = -3;
  synth.connect(host.output);

  subChips = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-theory-page]"));
  subPanels = Array.from(root.querySelectorAll<HTMLElement>("[data-theory-panel]"));
  for (const chip of subChips) chip.addEventListener("click", () => switchSubPage(chip.dataset.theoryPage!));

  buildCircle(root.querySelector<HTMLElement>('[data-theory-panel="circle"]')!);
  buildScales(root.querySelector<HTMLElement>('[data-theory-panel="scales"]')!);
  buildChords(root.querySelector<HTMLElement>('[data-theory-panel="chords"]')!);
  buildInterval(root.querySelector<HTMLElement>('[data-theory-panel="interval"]')!);

  syncScaleUI();
}
