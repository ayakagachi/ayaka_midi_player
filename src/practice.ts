// 练习模式纯逻辑：音符分组 + 等待模式状态机
// 不依赖 DOM 与 Tone.js，游标时间由外部（rAF 循环）通过 tick 驱动

export type PracticeNoteInput = {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
  track: number;
};

export type PracticeState = "idle" | "advancing" | "waiting" | "finished";

export interface NoteGroup {
  /** 组首音起始秒 */
  time: number;
  /** 组内最晚结束秒 */
  endTime: number;
  /** 去重后的目标键（多轨齐奏同音只算一个） */
  midis: Set<number>;
  notes: PracticeNoteInput[];
}

/**
 * 把按 time 升序的音符贪心分组：与组首音起始时间差在容差内的归入同组。
 * 锚定组首音而非前一个音，避免密集琶音被链式吞并成一大组。
 */
export function groupNotes(notes: PracticeNoteInput[], toleranceSec = 0.05): NoteGroup[] {
  const groups: NoteGroup[] = [];
  let current: NoteGroup | null = null;
  for (const note of notes) {
    if (!current || note.time - current.time > toleranceSec) {
      current = { time: note.time, endTime: note.time + note.duration, midis: new Set(), notes: [] };
      groups.push(current);
    }
    current.midis.add(note.midi);
    current.notes.push(note);
    current.endTime = Math.max(current.endTime, note.time + note.duration);
  }
  return groups;
}

/**
 * 等待模式会话：idle → start() → advancing ⇄ waiting → finished，任意状态 stop() → idle。
 * advancing 时游标随 tick 前进；到达下一组起点即冻结进入 waiting，
 * 等待期间累计"新按下"的正确键，覆盖整组后放行。
 */
export class PracticeSession {
  private groups: NoteGroup[];
  private durationSec: number;
  private speedValue: number;
  private earlyWindowSec: number;
  private stateValue: PracticeState = "idle";
  private timeValue = 0;
  private index = 0;
  /** waiting 中已弹对的目标键 */
  private satisfied = new Set<number>();
  /** advancing 末段提前弹对的键，进入 waiting 时并入 satisfied（容忍抢拍） */
  private early = new Set<number>();
  /** 状态或判定进展变化时回调（每帧的游标推进不回调，UI 直接读 time） */
  onChange?: (session: PracticeSession) => void;

  constructor(groups: NoteGroup[], durationSec: number, opts?: { speed?: number; earlyWindowSec?: number }) {
    this.groups = groups;
    this.durationSec = durationSec;
    this.speedValue = opts?.speed ?? 1;
    this.earlyWindowSec = opts?.earlyWindowSec ?? 0.12;
  }

  get state(): PracticeState { return this.stateValue; }
  get time(): number { return this.timeValue; }
  get groupIndex(): number { return this.index; }
  get groupCount(): number { return this.groups.length; }
  get currentGroup(): NoteGroup | null { return this.groups[this.index] ?? null; }

  /** 当前等待组里还没弹的目标键（非 waiting 时为空集） */
  get remainingMidis(): Set<number> {
    const remaining = new Set<number>();
    if (this.stateValue !== "waiting") return remaining;
    const group = this.groups[this.index]!;
    group.midis.forEach(midi => { if (!this.satisfied.has(midi)) remaining.add(midi); });
    return remaining;
  }

  start(): void {
    this.timeValue = 0;
    this.index = 0;
    this.satisfied.clear();
    this.early.clear();
    this.stateValue = this.groups.length ? "advancing" : "finished";
    this.notify();
  }

  stop(): void {
    this.stateValue = "idle";
    this.notify();
  }

  setSpeed(value: number): void {
    this.speedValue = value;
  }

  /** 跳到指定时间并对齐到下一组（A-B 循环预留） */
  seekToTime(sec: number): void {
    this.timeValue = Math.max(0, Math.min(sec, this.durationSec));
    let low = 0;
    let high = this.groups.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.groups[mid].time < this.timeValue) low = mid + 1;
      else high = mid;
    }
    this.index = low;
    this.satisfied.clear();
    this.early.clear();
    if (this.stateValue === "waiting") this.stateValue = "advancing";
    this.notify();
  }

  tick(deltaSec: number): void {
    if (this.stateValue !== "advancing") return;
    this.timeValue += deltaSec * this.speedValue;
    const next = this.groups[this.index];
    if (!next) {
      // 末组已过，让尾音滚完再收尾
      if (this.timeValue >= this.durationSec) {
        this.timeValue = this.durationSec;
        this.stateValue = "finished";
        this.notify();
      }
      return;
    }
    if (this.timeValue >= next.time) {
      this.timeValue = next.time;
      this.satisfied = new Set([...this.early].filter(midi => next.midis.has(midi)));
      this.early.clear();
      if (this.covered(next)) this.pass();
      else {
        this.stateValue = "waiting";
        this.notify();
      }
    }
  }

  noteOn(midi: number): { hit: boolean; advanced: boolean } {
    if (this.stateValue === "waiting") {
      const group = this.groups[this.index]!;
      if (!group.midis.has(midi)) return { hit: false, advanced: false };
      this.satisfied.add(midi);
      if (this.covered(group)) {
        this.pass();
        return { hit: true, advanced: true };
      }
      this.notify();
      return { hit: true, advanced: false };
    }
    if (this.stateValue === "advancing") {
      const next = this.groups[this.index];
      if (next && next.time - this.timeValue <= this.earlyWindowSec && next.midis.has(midi)) {
        this.early.add(midi);
        return { hit: true, advanced: false };
      }
    }
    return { hit: false, advanced: false };
  }

  // 判定只看新按下，松键暂无逻辑；保留接口给未来的"按住时值"类需求
  noteOff(_midi: number): void {}

  private covered(group: NoteGroup): boolean {
    for (const midi of group.midis) if (!this.satisfied.has(midi)) return false;
    return true;
  }

  private pass(): void {
    this.index++;
    this.satisfied.clear();
    this.stateValue = "advancing";
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this);
  }
}
