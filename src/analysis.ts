// 和声分析：对解析后的 MIDI 音符做离线逐拍和弦分析，再由和弦进行推调（统一大调）
// 纯函数模块，不依赖 DOM 与 Tone.js，方便测试与复用

export type AnalysisNote = {
  midi: number;
  velocity: number;
  ticks: number;
  durationTicks: number;
  channel?: number;
};

export type KeySegment = {
  start: number; // 秒
  end: number;
  key: string; // 如 "G 大调" / "E 小调"
  root: number; // 音级 0-11，0 = C
  mode: "major" | "minor";
  confidence: number; // 0-1
};

export type ChordEvent = {
  start: number;
  end: number;
  label: string; // 如 "Cmaj7" / "G/B"
  bass: string; // 低音音名
  root: number; // 根音音级 0-11
  suffix: string; // 和弦性质后缀（"" / "m" / "maj7" / "7" ...）
  add9: boolean;
  bassPc: number; // 低音音级 0-11
  confidence: number; // 0-1
};

export type AnalysisResult = {
  keySegments: KeySegment[];
  chordEvents: ChordEvent[];
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// 和弦模板：后缀 -> 相对根音的音级集合（含根音）
const CHORD_TEMPLATES: [suffix: string, intervals: number[]][] = [
  ["maj7", [0, 4, 7, 11]],
  ["7", [0, 4, 7, 10]],
  ["m7", [0, 3, 7, 10]],
  ["mMaj7", [0, 3, 7, 11]],
  ["m7♭5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
  ["aug", [0, 4, 8]],
  ["dim", [0, 3, 6]],
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
];

const ADD9 = 2; // 附加九音（相对根音的音级）

// 平滑常数
const CHORD_HOLD_BEATS = 2; // 无匹配时沿用上一和弦的最大拍数
const CHORD_MERGE_GAP = 0.6; // 秒：相同和弦间隔小于该值时合并
// 和弦 Viterbi 平滑：在逐拍候选之间做全局动态规划，用和弦进行先验抑制闪动与孤立错和弦
const CHORD_CANDIDATE_COUNT = 8; // 每拍保留的候选和弦数上限
const CHORD_CANDIDATE_FLOOR = 0.5; // 候选得分绝对下限
const CHORD_CANDIDATE_MARGIN = 0.25; // 相对最优得分的保留带宽（用于转移抢救次优候选）
const VITERBI_EMISSION_SCALE = 1; // 发射项 log(score) 放大系数
const VITERBI_TRANSITION_WEIGHT = 0.4; // 转移先验的相对权重
const VITERBI_BREAK_GAP = 1.5; // 秒：超过该间隔视为乐句断开，不施加转移先验
const VITERBI_SELF_TRANS = 0.95; // 同和弦延续的先验概率
const VITERBI_PARALLEL_TRANS = 0.55; // 同根不同性质（如 C -> Cm）的先验概率
const VITERBI_FIFTH_WEIGHTS = [0.9, 0.8, 0.5, 0.35, 0.25, 0.2, 0.08]; // 五度圈距离 0..6 的转移概率

type ChordCandidate = { root: number; suffix: string; add9: boolean; score: number };

/**
 * 和弦候选提取：低音三音（最低音 + 上方最近的大/小三度与纯五度）定框架，
 * 其余音（多为旋律经过音）不参与否决，只轻微扣分。
 * 返回全部命中的候选（含次优），按得分降序，供 Viterbi 转移抢救。
 */
function matchChordCandidates(windowNotes: { midi: number }[]): ChordCandidate[] {
  if (windowNotes.length < 2) return [];
  const bassMidi = Math.min(...windowNotes.map(n => n.midi));
  const bassPc = bassMidi % 12;
  const pcSet = new Set(windowNotes.map(n => n.midi % 12));

  // 低音三音框架：最低音 + 各音级中离低音最近的一个音，取前 3 个音级
  const nearest = new Map<number, number>();
  for (const n of windowNotes) {
    const pc = n.midi % 12;
    if (!nearest.has(pc) || n.midi < nearest.get(pc)!) nearest.set(pc, n.midi);
  }
  const sorted = [...nearest.values()].sort((a, b) => a - b);
  const frame = new Set<number>([bassPc]);
  for (const midi of sorted) {
    if (frame.size >= 3) break;
    frame.add(midi % 12);
  }

  // 低音声部（最低八度内）的音级集合
  const lowerPcs = new Set(
    windowNotes.filter(n => n.midi <= bassMidi + 12).map(n => n.midi % 12),
  );
  const frameOrLower = new Set([...frame, ...lowerPcs]);

  const extraCount = pcSet.size - frame.size; // 框架外音级（旋律音）
  const matches: ChordCandidate[] = [];

  for (const [suffix, intervals] of CHORD_TEMPLATES) {
    const triad = intervals.length === 3;
    const seventh = intervals.length === 4 ? intervals[3] : null;
    const sus = suffix === "sus2" || suffix === "sus4";
    for (const rootCandidate of pcSet) {
      const thirdPc = (rootCandidate + intervals[1]) % 12;
      const fifthPc = (rootCandidate + intervals[2]) % 12;

      // 框架匹配：低音三音须包含根、三、五
      const frameHit = frame.has(rootCandidate) && frame.has(thirdPc) && frame.has(fifthPc);
      // 低音声部匹配：最低八度内包含根、三、五（左手柱式和弦）
      const lowerHit = lowerPcs.size >= 3 &&
        lowerPcs.has(rootCandidate) && lowerPcs.has(thirdPc) && lowerPcs.has(fifthPc);
      // 宽匹配：根音与五音在低音框架内、三度在窗口任意处（三度常由右手旋律担任）
      const pcHit = !sus && !frameHit && !lowerHit &&
        pcSet.has(rootCandidate) && pcSet.has(thirdPc) && pcSet.has(fifthPc) &&
        frameOrLower.has(rootCandidate) && frameOrLower.has(fifthPc);
      if (!frameHit && !lowerHit && !pcHit) continue;

      let covered = 3;
      if (seventh !== null) {
        if (pcSet.has((rootCandidate + seventh) % 12)) covered = 4;
        else continue; // 七和弦缺七音，交给三和弦模板
      }
      // add9 只在九音真正落在低音/框架内时标记（旋律中的九音不算色彩音）
      const add9 = triad && frameOrLower.has((rootCandidate + ADD9) % 12);
      // 同根大/小三度已在窗口中 → 不是挂留（三度被旋律音占用而已）
      if (sus && (pcSet.has((rootCandidate + 3) % 12) || pcSet.has((rootCandidate + 4) % 12))) continue;
      // 低音是根音 → 原位更可信；三度/五度在低音 → 转位次之
      const bassBonus = bassPc === rootCandidate ? 0.4 : bassPc === thirdPc || bassPc === fifthPc ? 0.15 : 0;
      const lowerBonus = lowerHit ? 0.25 : 0;
      const score = Math.min(1, (covered + bassBonus + lowerBonus + (add9 ? 0.3 : 0)) / (covered + extraCount * 0.25));
      matches.push({ root: rootCandidate, suffix, add9, score: pcHit ? score - 0.05 : score });
    }
  }

  // 去重：同一 (root, suffix, add9) 保留最高分，再按得分降序
  const bestByKey = new Map<string, ChordCandidate>();
  for (const m of matches) {
    const key = `${m.root}|${m.suffix}|${m.add9}`;
    const existing = bestByKey.get(key);
    if (!existing || m.score > existing.score) bestByKey.set(key, m);
  }
  return [...bestByKey.values()].sort((a, b) => b.score - a.score);
}

// 五度圈距离：两音根音在五度圈上的最短步数（根音按五度/四度移动视为“近”）
function fifthDistance(a: number, b: number): number {
  const d = ((a * 7 - b * 7) % 12 + 12) % 12;
  return d > 6 ? 12 - d : d;
}

// 和弦转移先验：同和弦延续最高，同根不同性质次之，其余按五度圈距离衰减
function chordTransitionWeight(a: ChordCandidate, b: ChordCandidate): number {
  if (a.root === b.root && a.suffix === b.suffix && a.add9 === b.add9) return VITERBI_SELF_TRANS;
  if (a.root === b.root) return VITERBI_PARALLEL_TRANS;
  return VITERBI_FIFTH_WEIGHTS[fifthDistance(a.root, b.root)];
}

// Viterbi 平滑：把逐拍候选当隐藏状态，发射 = 匹配得分，转移 = 和弦进行先验，
// 按乐句切段后各自做全局回溯，替代原来的硬性“短运行回填”。
function viterbiSmooth(
  columns: (ChordCandidate[] | null)[],
  colStart: number[],
): (ChordCandidate | null)[] {
  const n = columns.length;
  const chosen: (ChordCandidate | null)[] = new Array(n).fill(null);

  const segments: number[][] = [];
  let seg: number[] = [];
  for (let k = 0; k < n; k++) {
    if (!columns[k]) {
      if (seg.length) { segments.push(seg); seg = []; }
      continue;
    }
    if (seg.length && colStart[k] - colStart[seg[seg.length - 1]] > VITERBI_BREAK_GAP) {
      segments.push(seg);
      seg = [];
    }
    seg.push(k);
  }
  if (seg.length) segments.push(seg);

  for (const segment of segments) {
    const T = segment.length;
    const pointers: Int32Array[] = [];
    let prevScores: number[] | null = null;
    for (let t = 0; t < T; t++) {
      const col = columns[segment[t]]!;
      const K = col.length;
      const scores = new Array<number>(K);
      const ptr = new Int32Array(K);
      for (let k = 0; k < K; k++) {
        const emit = VITERBI_EMISSION_SCALE * Math.log(Math.max(col[k].score, 1e-4));
        if (t === 0) {
          scores[k] = emit;
          ptr[k] = -1;
        } else {
          let bestVal = -Infinity;
          let bestPrev = 0;
          const prevCol = columns[segment[t - 1]]!;
          for (let p = 0; p < prevCol.length; p++) {
            const trans = VITERBI_TRANSITION_WEIGHT * Math.log(chordTransitionWeight(prevCol[p], col[k]));
            const val = prevScores![p] + trans + emit;
            if (val > bestVal) { bestVal = val; bestPrev = p; }
          }
          scores[k] = bestVal;
          ptr[k] = bestPrev;
        }
      }
      prevScores = scores;
      pointers.push(ptr);
    }
    let bestLast = 0;
    for (let k = 1; k < prevScores!.length; k++) if (prevScores![k] > prevScores![bestLast]) bestLast = k;
    let cur = bestLast;
    for (let t = T - 1; t >= 0; t--) {
      chosen[segment[t]] = columns[segment[t]]![cur];
      if (t > 0) cur = pointers[t][cur];
    }
  }
  return chosen;
}

/**
 * 和弦分析：按拍切窗，模板匹配 + 最低音定转位
 */
export function analyzeChords(
  notes: AnalysisNote[],
  ppq: number,
  ticksToSeconds: (ticks: number) => number,
): ChordEvent[] {
  const tonal = notes.filter(note => note.channel !== 9 && note.durationTicks > 0);
  if (!tonal.length || ppq <= 0) return [];

  const endTicks = Math.max(...tonal.map(note => note.ticks + note.durationTicks));
  const windowTicks = ppq; // 每拍一个窗口
  const windowCount = Math.ceil(endTicks / windowTicks);

  // 逐拍收集候选和弦，供 Viterbi 做全局平滑
  const columns: (ChordCandidate[] | null)[] = new Array(windowCount).fill(null);
  const colBass = new Array<number>(windowCount).fill(0);
  const colStart = new Array<number>(windowCount);

  let hold: { root: number; suffix: string; add9: boolean; score: number; bass: number } | null = null;
  let holdBeats = 0;

  for (let w = 0; w < windowCount; w++) {
    const start = w * windowTicks;
    const end = start + windowTicks;
    colStart[w] = ticksToSeconds(start);
    const windowNotes: { midi: number }[] = [];
    let bass = Infinity;
    for (const note of tonal) {
      if (note.ticks < end && note.ticks + note.durationTicks > start) {
        windowNotes.push(note);
        bass = Math.min(bass, note.midi);
      }
    }
    colBass[w] = bass === Infinity ? 0 : bass % 12;

    const candidates = matchChordCandidates(windowNotes);
    // 保留最优及一定带宽内的次优候选（供转移抢救），其余丢弃
    const best = candidates.length ? candidates[0].score : 0;
    const kept = candidates
      .filter(c => c.score >= Math.max(best - CHORD_CANDIDATE_MARGIN, CHORD_CANDIDATE_FLOOR))
      .slice(0, CHORD_CANDIDATE_COUNT);

    if (kept.length) {
      columns[w] = kept;
      hold = { ...kept[0], bass: colBass[w] };
      holdBeats = 0;
    } else if (hold && holdBeats < CHORD_HOLD_BEATS && windowNotes.length <= 3) {
      // 音太少的窗口沿用上一和弦（稀疏分解和弦），注入为唯一候选
      holdBeats++;
      columns[w] = [{ root: hold.root, suffix: hold.suffix, add9: hold.add9, score: hold.score }];
      colBass[w] = hold.bass;
    }
    // 其余窗口保持 null（过门/空拍）
  }

  const chosen = viterbiSmooth(columns, colStart);

  // 组装和弦记录
  const raw: { start: number; end: number; root: number; suffix: string; add9: boolean; score: number; bass: number }[] = [];
  for (let w = 0; w < windowCount; w++) {
    const cand = chosen[w];
    if (!cand) continue;
    raw.push({
      start: colStart[w],
      end: ticksToSeconds((w + 1) * windowTicks),
      root: cand.root,
      suffix: cand.suffix,
      add9: cand.add9,
      score: cand.score,
      bass: colBass[w],
    });
  }

  // 合并：相同和弦且间隔小于 CHORD_MERGE_GAP 时视为同一和弦的延续
  // （原“短运行回填”由 Viterbi 的延续先验替代）
  const events: ChordEvent[] = [];
  for (const chord of raw) {
    const slash = chord.bass !== chord.root;
    const label = `${NOTE_NAMES[chord.root]}${chord.suffix}${chord.add9 ? "add9" : ""}${slash ? `/${NOTE_NAMES[chord.bass]}` : ""}`;
    const last = events[events.length - 1];
    if (last && last.label === label && chord.start - last.end <= CHORD_MERGE_GAP) {
      last.end = chord.end;
      last.confidence = Math.max(last.confidence, chord.score);
    } else {
      events.push({
        start: chord.start,
        end: chord.end,
        label,
        bass: NOTE_NAMES[chord.bass],
        root: chord.root,
        suffix: chord.suffix,
        add9: chord.add9,
        bassPc: chord.bass,
        confidence: chord.score,
      });
    }
  }
  return events;
}

// 大调自然音阶的三和弦度数（相对根音的半音间隔）：I ii iii IV V vi vii°
const MAJOR_TRIAD_DEGREES = [0, 2, 4, 5, 7, 9, 11];

// 和弦后缀归并为 大 / 小 / 减 三类，用于与调内三和弦性质对齐
function suffixQuality(suffix: string): "major" | "minor" | "dim" {
  if (suffix === "dim" || suffix === "dim7") return "dim";
  if (suffix === "m" || suffix === "m7" || suffix === "mMaj7" || suffix === "m7♭5") return "minor";
  return "major";
}

// 单个和弦对某大调主音的匹配度（正=符合，负=偏离）
function chordKeyFit(root: number, suffix: string, keyRoot: number): number {
  const interval = (root - keyRoot + 12) % 12;
  const degree = MAJOR_TRIAD_DEGREES.indexOf(interval);
  if (degree < 0) return -0.8; // 非调内根音
  const expected: "major" | "minor" | "dim" =
    degree === 6 ? "dim" : [1, 2, 5].includes(degree) ? "minor" : "major";
  return suffixQuality(suffix) === expected ? 1 : 0.35; // 性质偏离按借用和弦弱加分
}

/**
 * 从和弦进行推调（只输出大调，小调统一归入其关系大调）。
 * 以和弦根音+性质对 12 个大调打分（按时长加权），比音符直方图更抗旋律干扰，
 * 并能稳定捕捉转调。窗口按秒滑动，输出 KeySegment（mode 恒为 major）。
 */
export function analyzeKeyFromChords(
  chords: ChordEvent[],
  changePenalty = 4,
): KeySegment[] {
  if (!chords.length) return [];
  const sorted = [...chords].sort((a, b) => a.start - b.start);
  const n = sorted.length;
  const K = 12;

  // Viterbi 分段：状态 = 12 个大调，发射 = 和弦匹配度 × 时长，转移 = 换调罚分。
  // 相比滑动窗，换调罚分在全局上抑制转调交界处短暂出现的"折中调"（如 E♭→F 之间冒出的 B♭），
  // 只保留真正意义上的转调（匹配度差距足够大、值得付罚分）。
  let prev = new Array<number>(K).fill(0);
  const backptr: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const c = sorted[i];
    const dur = Math.max(c.end - c.start, 0.1);
    const emit = new Array<number>(K);
    for (let k = 0; k < K; k++) emit[k] = chordKeyFit(c.root, c.suffix, k) * dur;
    const cur = new Array<number>(K);
    const ptr = new Int32Array(K);
    for (let k = 0; k < K; k++) {
      let best = -Infinity;
      let bestPrev = 0;
      for (let j = 0; j < K; j++) {
        const val = prev[j] + emit[k] + (j === k ? 0 : -changePenalty);
        if (val > best) { best = val; bestPrev = j; }
      }
      cur[k] = best;
      ptr[k] = bestPrev;
    }
    prev = cur;
    backptr.push(ptr);
  }

  let key = 0;
  for (let k = 1; k < K; k++) if (prev[k] > prev[key]) key = k;
  const path = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    path[i] = key;
    key = backptr[i][key];
  }

  // 合并相邻同主音和弦为时间段
  const segments: KeySegment[] = [];
  for (let i = 0; i < n; i++) {
    const k = path[i];
    const last = segments[segments.length - 1];
    if (last && last.root === k) {
      last.end = sorted[i].end;
    } else {
      segments.push({
        start: sorted[i].start,
        end: sorted[i].end,
        key: `${NOTE_NAMES[k]} 大调`,
        root: k,
        mode: "major",
        confidence: 0.9,
      });
    }
  }
  return segments;
}

/**
 * 按升降调半音数平移调性标签（如 C 大调 +2 → D 大调）
 */
export function transposedKeyLabel(key: KeySegment, semitones: number): string {
  const root = ((key.root + semitones) % 12 + 12) % 12;
  return `${NOTE_NAMES[root]} ${key.mode === "major" ? "大调" : "小调"}`;
}

/**
 * 二分查找：定位 seconds 所处的时间段（数组需按 start 排序且互不重叠）
 */
export function findSegmentAt<T extends { start: number; end: number }>(segments: T[], seconds: number): T | null {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const segment = segments[middle];
    if (seconds < segment.start) high = middle - 1;
    else if (seconds >= segment.end) low = middle + 1;
    else return segment;
  }
  return null;
}

/**
 * 无速度事件时的节拍估算（仅用于展示，播放仍按 SMF 规范默认 120 BPM）。
 *
 * 说明：没有速度事件的 MIDI 本身不含绝对时间基准——@tonejs/midi 的 ticksToSeconds
 * 也会按 120 BPM 处理。所以这里的"测量"是对相对节奏的归纳 + 自然速度先验的估计，
 * 不等于作曲者原意，只是比硬编码 120 更有依据。
 *
 * 方法：对音符 onset 做复合起音间隔（IOI）直方图（只用在 ticks 域，不受速度影响，
 * 避免落入"无速度 → 默认 120 → 估算结果永远是 120"的循环），找最显著周期并换算成
 * 主导音值（相对四分音符的倍数），再做八度校正到 70–160 BPM。
 */
export function estimateTempo(notes: AnalysisNote[], ppq: number): number | null {
  if (ppq <= 0) return null;

  const onsets = [...new Set(
    notes.filter(n => n.channel !== 9 && n.ticks >= 0).map(n => n.ticks),
  )].sort((a, b) => a - b);
  if (onsets.length < 8) return null; // onset 太少，估不出稳定节拍

  // 复合起音间隔直方图：统计每个 onset 与其后若干 onset 的间隔（ticks）。
  // 复合间隔（隔几个音）能抵抗切分/连音，让主周期更突出。
  const LOOKAHEAD = 16;
  const counts = new Map<number, number>();
  for (let i = 0; i < onsets.length; i++) {
    const cap = Math.min(onsets.length, i + LOOKAHEAD);
    for (let j = i + 1; j < cap; j++) {
      const dt = onsets[j] - onsets[i];
      if (dt > ppq * 8) break; // 只看 8 拍内的间隔
      counts.set(dt, (counts.get(dt) ?? 0) + 1);
    }
  }
  if (!counts.size) return null;

  // 5% 容差邻域聚簇，抑制量化抖动，取计数最高的间隔作为主导音值
  const entries = [...counts.entries()].sort((a, b) => a[0] - b[0]);
  let dominantTicks = entries[0][0];
  let best = -1;
  for (const [dt] of entries) {
    const tol = Math.max(1, Math.round(dt * 0.05));
    let sum = 0;
    for (const [d, c] of entries) {
      if (Math.abs(d - dt) <= tol) sum += c;
    }
    if (sum > best) { best = sum; dominantTicks = dt; }
  }
  if (best <= 0) return null;

  // 主导间隔换算成 BPM：以自然速度先验（约 120）为锚，BPM ≈ 120 / 主导间隔拍数。
  // 对二分节奏（主导音值为四分/八分/二分音符）会八度校正回 120；附点/三连音等
  // 非二分节奏则会得到偏离的估计值。
  const beats = dominantTicks / ppq; // 主导间隔 = 几个四分音符
  let bpm = 120 / beats;
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return Math.round(bpm);
}
