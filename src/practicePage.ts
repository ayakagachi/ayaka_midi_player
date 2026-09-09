// 练习页：等待模式 UI 与渲染
// 依赖 practice.ts（纯逻辑状态机）、keyboard.ts（琴键几何）、noteInput.ts（用户输入事件）
// DOM 全部构建到 #practiceShell，仿 theoryPage 的注入初始化模式

import { NOTE_MIN, NOTE_MAX, isBlack, midiName, noteGeometry, whiteKeyMetrics } from "./keyboard";
import { PracticeSession, groupNotes, type NoteGroup, type PracticeNoteInput } from "./practice";
import { onNoteInput, emitNoteInput } from "./noteInput";

export interface PracticeHost {
  /** 当前已加载曲目（复用演奏页数据），无曲目时返回 null */
  getSong(): { notes: PracticeNoteInput[]; duration: number; title: string } | null;
  getTranspose(): number;
  /** 开始练习前暂停演奏页的 Transport，避免抢声 */
  ensureStudioPaused(): void;
  /** 屏幕琴键发声（走演奏页的 activeEngine） */
  previewNote(midi: number, velocity: number, on: boolean): void;
}

export interface PracticePageHandle {
  /** 进入/离开练习页：启停渲染循环，离开时停止会话 */
  setActive(active: boolean): void;
  /** 演奏页换曲/卸载后调用：停止会话并刷新曲目信息 */
  notifySongChanged(): void;
}

const KEYBOARD_HEIGHT = 96;
const LEFT_COLOR = "#55a7ff";
const RIGHT_COLOR = "#4ee1d0";
const TARGET_COLOR = "#ffbd66";
const WRONG_COLOR = "#ff6d6d";
const WRONG_FLASH_SEC = 0.35;
const POINTER_VELOCITY = 0.75;

// —— 模块级状态（initPracticePage 仅调用一次）——
let host: PracticeHost;
let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let titleLabel: HTMLElement;
let progressLabel: HTMLElement;
let hintBar: HTMLElement;
let startButton: HTMLButtonElement;
let speedSelect: HTMLSelectElement;
let controlsRow: HTMLElement;
let stage: HTMLElement;
let emptyCard: HTMLElement;

let isActive = false;
let rafId = 0;
let lastFrameTime = 0;

let practiceNotes: PracticeNoteInput[] = [];
let groups: NoteGroup[] = [];
let songDuration = 0;
let session: PracticeSession | null = null;
let speed = 1;

const pressed = new Map<number, number>();
const wrongFlashes = new Map<number, number>(); // midi -> 剩余秒
const pointerNotes = new Map<number, number>(); // pointerId -> midi

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function initPracticePage(practiceHost: PracticeHost): PracticePageHandle {
  host = practiceHost;
  const root = document.querySelector<HTMLElement>("#page-practice")!;
  const shell = root.querySelector<HTMLElement>("#practiceShell")!;
  buildDom(shell);
  bindSubNav(root);
  bindPointerInput();
  onNoteInput(event => {
    if (!isActive) return;
    if (event.type === "on") {
      pressed.set(event.midi, event.velocity);
      if (session) {
        const wasWaiting = session.state === "waiting";
        const result = session.noteOn(event.midi);
        if (wasWaiting && !result.hit) wrongFlashes.set(event.midi, WRONG_FLASH_SEC);
      }
    } else {
      pressed.delete(event.midi);
    }
  });
  new ResizeObserver(resizeCanvas).observe(canvas);
  return {
    setActive(active: boolean) {
      if (active === isActive) return;
      isActive = active;
      if (active) {
        rebuildSong();
        requestAnimationFrame(resizeCanvas);
        lastFrameTime = performance.now();
        rafId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(rafId);
        stopSession();
        pressed.clear();
        wrongFlashes.clear();
        pointerNotes.forEach(midi => host.previewNote(midi, 0, false));
        pointerNotes.clear();
      }
    },
    notifySongChanged() {
      rebuildSong();
    },
  };
}

// —— 子页切换（与乐理页同款胶囊子导航）——
function bindSubNav(root: HTMLElement) {
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>("[data-practice-page]"));
  const panels = Array.from(root.querySelectorAll<HTMLElement>("[data-practice-panel]"));
  for (const chip of chips) {
    chip.addEventListener("click", () => {
      const id = chip.dataset.practicePage!;
      for (const panel of panels) panel.hidden = panel.dataset.practicePanel !== id;
      for (const other of chips) {
        const active = other === chip;
        other.classList.toggle("active", active);
        other.setAttribute("aria-selected", String(active));
      }
    });
  }
}

// —— DOM 构建 ——
function buildDom(shell: HTMLElement) {
  controlsRow = el("div", "practice-controls");
  titleLabel = el("span", "practice-title", "—");
  speedSelect = document.createElement("select");
  for (const value of [0.5, 0.75, 1, 1.25, 1.5]) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value}×`;
    speedSelect.append(option);
  }
  speedSelect.value = "1";
  speedSelect.addEventListener("change", () => {
    speed = Number(speedSelect.value) || 1;
    session?.setSpeed(speed);
  });
  const speedField = el("label", "control-field");
  speedField.append("速度", speedSelect);
  startButton = el("button", "quiet-button practice-start", "开始练习");
  startButton.addEventListener("click", toggleSession);
  progressLabel = el("span", "practice-progress", "");
  controlsRow.append(titleLabel, progressLabel, speedField, startButton);

  hintBar = el("div", "practice-hint", "");

  stage = el("div", "practice-stage");
  canvas = document.createElement("canvas");
  ctx = canvas.getContext("2d")!;
  stage.append(canvas);

  emptyCard = el("div", "practice-empty");
  const emptyText = el("p", undefined, "还没有曲目。先去演奏页导入一个 MIDI，再回来练习。");
  const goButton = el("button", "quiet-button", "去演奏页导入");
  goButton.addEventListener("click", () => { window.location.hash = "studio"; });
  emptyCard.append(emptyText, goButton);

  shell.append(controlsRow, hintBar, stage, emptyCard);
}

// —— 曲目与会话 ——
// 重建练习数据：应用当前移调、过滤键范围、预分组；随后停掉旧会话
function rebuildSong() {
  stopSession();
  const song = host.getSong();
  const transpose = song ? host.getTranspose() : 0;
  practiceNotes = (song?.notes ?? [])
    .map(note => ({ ...note, midi: note.midi + transpose }))
    .filter(note => note.midi >= NOTE_MIN && note.midi <= NOTE_MAX);
  groups = groupNotes(practiceNotes);
  songDuration = song?.duration ?? 0;
  const hasSong = practiceNotes.length > 0;
  controlsRow.hidden = !hasSong;
  hintBar.hidden = !hasSong;
  stage.hidden = !hasSong;
  emptyCard.hidden = hasSong;
  if (hasSong) {
    titleLabel.textContent = song!.title;
    updateStatus();
    requestAnimationFrame(resizeCanvas);
  }
}

function toggleSession() {
  if (session && session.state !== "idle" && session.state !== "finished") {
    stopSession();
    updateStatus();
    return;
  }
  if (!groups.length) return;
  host.ensureStudioPaused();
  session = new PracticeSession(groups, songDuration, { speed });
  session.onChange = updateStatus;
  session.start();
}

function stopSession() {
  if (!session) return;
  session.onChange = undefined;
  session.stop();
  session = null;
  wrongFlashes.clear();
}

function updateStatus() {
  const state = session?.state ?? "idle";
  hintBar.classList.toggle("waiting", state === "waiting");
  hintBar.classList.toggle("done", state === "finished");
  startButton.textContent = state === "advancing" || state === "waiting" ? "停止练习" : "开始练习";
  if (state === "waiting" && session) {
    const names = [...session.remainingMidis].sort((a, b) => a - b).map(midiName);
    hintBar.textContent = `等待中，请弹：${names.join(" · ")}`;
  } else if (state === "advancing") {
    hintBar.textContent = "行进中——瀑布流到达音符时会停下等你";
  } else if (state === "finished") {
    hintBar.textContent = `练习完成 🎉 共 ${groups.length} 组，点「开始练习」再来一遍`;
  } else {
    hintBar.textContent = "点「开始练习」，瀑布流会在每个音符处等你弹对再继续";
  }
}

// —— 渲染 ——
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function render() {
  rafId = requestAnimationFrame(render);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;

  const frameTime = performance.now();
  const deltaTime = Math.min(0.05, (frameTime - lastFrameTime) / 1000);
  lastFrameTime = frameTime;

  session?.tick(deltaTime);
  wrongFlashes.forEach((left, midi) => {
    const next = left - deltaTime;
    if (next <= 0) wrongFlashes.delete(midi);
    else wrongFlashes.set(midi, next);
  });

  const time = session && session.state !== "idle" ? session.time : 0;
  const waiting = session?.state === "waiting";
  const currentGroupNotes = waiting ? new Set(session!.currentGroup?.notes) : null;
  const remaining = session?.remainingMidis ?? new Set<number>();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#08131d";
  ctx.fillRect(0, 0, width, height);

  const fallHeight = height - KEYBOARD_HEIGHT;
  const pxPerSecond = Math.max(100, Math.min(185, fallHeight / 3.2));
  const { whiteWidth, starts } = whiteKeyMetrics(width);

  // 八度参考线
  ctx.strokeStyle = "rgba(104, 145, 158, .10)";
  ctx.lineWidth = 1;
  starts.forEach((x, midi) => {
    if (midi % 12 === 0) {
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, fallHeight);
      ctx.stroke();
    }
  });

  // 瀑布流：等待中的目标组用琥珀色高亮
  const startWindow = time - 0.2;
  const endWindow = time + fallHeight / pxPerSecond;
  for (const note of practiceNotes) {
    if (note.time + note.duration < startWindow || note.time > endWindow) continue;
    const velocity = Math.min(1, Math.max(0.05, note.velocity));
    const key = noteGeometry(note.midi, width);
    const noteEndY = fallHeight - (note.time - time) * pxPerSecond;
    const noteHeight = Math.max(5, note.duration * pxPerSecond);
    const xPad = Math.max(0.7, key.width * (0.18 - velocity * 0.12));
    const isTarget = currentGroupNotes?.has(note) ?? false;
    const color = isTarget ? TARGET_COLOR : note.midi < 60 ? LEFT_COLOR : RIGHT_COLOR;
    ctx.globalAlpha = isTarget ? 0.95 : 0.32 + velocity * 0.55;
    ctx.shadowBlur = isTarget ? 16 : 2 + velocity * 10;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(key.x + xPad, noteEndY - noteHeight, key.width - xPad * 2, noteHeight, Math.min(4, key.width / 4));
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;

  // 击键线
  ctx.strokeStyle = waiting ? "rgba(255, 189, 102, .55)" : "rgba(233, 242, 244, .22)";
  ctx.lineWidth = waiting ? 2 : 1;
  ctx.beginPath();
  ctx.moveTo(0, fallHeight - 0.5);
  ctx.lineTo(width, fallHeight - 0.5);
  ctx.stroke();

  // 键盘：白键
  ctx.fillStyle = "#dfe8e9";
  ctx.fillRect(0, fallHeight, width, KEYBOARD_HEIGHT);
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (isBlack(midi)) continue;
    const x = starts.get(midi)!;
    ctx.fillStyle = "#e9eeee";
    ctx.fillRect(x + 0.5, fallHeight + 1, whiteWidth - 1, KEYBOARD_HEIGHT - 2);
    const overlay = keyOverlay(midi, remaining);
    if (overlay) {
      ctx.globalAlpha = overlay.alpha;
      ctx.fillStyle = overlay.color;
      ctx.fillRect(x + 0.5, fallHeight + 1, whiteWidth - 1, KEYBOARD_HEIGHT - 2);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#83939a";
    ctx.strokeRect(x + 0.5, fallHeight + 0.5, whiteWidth, KEYBOARD_HEIGHT);
    if (midi % 12 === 0 && whiteWidth > 12) {
      ctx.fillStyle = "#62737a";
      ctx.font = "10px Manrope";
      ctx.textAlign = "center";
      ctx.fillText(midiName(midi), x + whiteWidth / 2, height - 8);
    }
  }
  // 键盘：黑键
  for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
    if (!isBlack(midi)) continue;
    const key = noteGeometry(midi, width);
    ctx.fillStyle = "#0b151b";
    ctx.beginPath();
    ctx.roundRect(key.x, fallHeight, key.width, KEYBOARD_HEIGHT * 0.61, [0, 0, 3, 3]);
    ctx.fill();
    const overlay = keyOverlay(midi, remaining, true);
    if (overlay) {
      ctx.globalAlpha = overlay.alpha;
      ctx.fillStyle = overlay.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  if (session && session.state !== "idle") {
    progressLabel.textContent = `第 ${Math.min(session.groupIndex + 1, groups.length)}/${groups.length} 组 · ${formatTime(time)} / ${formatTime(songDuration)}`;
  } else {
    progressLabel.textContent = `${groups.length} 组 · ${formatTime(songDuration)}`;
  }
}

// 琴键覆盖色优先级：错音闪红 > 按下 > 目标琥珀
function keyOverlay(midi: number, remaining: Set<number>, black = false): { color: string; alpha: number } | null {
  const flash = wrongFlashes.get(midi);
  if (flash != null) return { color: WRONG_COLOR, alpha: 0.35 + (flash / WRONG_FLASH_SEC) * 0.5 };
  const velocity = pressed.get(midi);
  if (velocity != null) {
    const color = black ? (midi < 60 ? "#2f83d5" : "#20aa9b") : midi < 60 ? LEFT_COLOR : RIGHT_COLOR;
    return { color, alpha: (black ? 0.38 : 0.28) + velocity * 0.62 };
  }
  if (remaining.has(midi)) return { color: TARGET_COLOR, alpha: black ? 0.85 : 0.6 };
  return null;
}

// —— 屏幕琴键输入：与硬件 MIDI 走同一 emitNoteInput 判定路径 ——
function pointerToMidi(x: number, y: number): number | null {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const fallHeight = height - KEYBOARD_HEIGHT;
  if (y < fallHeight || y > height) return null;
  if (y < fallHeight + KEYBOARD_HEIGHT * 0.61) {
    for (let midi = NOTE_MIN; midi <= NOTE_MAX; midi++) {
      if (!isBlack(midi)) continue;
      const key = noteGeometry(midi, width);
      if (x >= key.x && x <= key.x + key.width) return midi;
    }
  }
  const { whiteWidth, starts } = whiteKeyMetrics(width);
  for (const [midi, startX] of starts) {
    if (x >= startX && x < startX + whiteWidth) return midi;
  }
  return null;
}

function pressPointerNote(midi: number) {
  host.previewNote(midi, POINTER_VELOCITY, true);
  emitNoteInput({ type: "on", midi, velocity: POINTER_VELOCITY });
}

function releasePointerNote(midi: number) {
  host.previewNote(midi, 0, false);
  emitNoteInput({ type: "off", midi, velocity: 0 });
}

function bindPointerInput() {
  canvas.addEventListener("pointerdown", event => {
    const rect = canvas.getBoundingClientRect();
    const midi = pointerToMidi(event.clientX - rect.left, event.clientY - rect.top);
    if (midi == null) return;
    canvas.setPointerCapture(event.pointerId);
    pointerNotes.set(event.pointerId, midi);
    pressPointerNote(midi);
  });
  canvas.addEventListener("pointermove", event => {
    const previous = pointerNotes.get(event.pointerId);
    if (previous == null) return;
    const rect = canvas.getBoundingClientRect();
    const midi = pointerToMidi(event.clientX - rect.left, event.clientY - rect.top);
    if (midi == null || midi === previous) return;
    releasePointerNote(previous);
    pointerNotes.set(event.pointerId, midi);
    pressPointerNote(midi);
  });
  const endPointer = (event: PointerEvent) => {
    const midi = pointerNotes.get(event.pointerId);
    if (midi == null) return;
    pointerNotes.delete(event.pointerId);
    releasePointerNote(midi);
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
}
