// 乐理数据与算法：五度圈、中古调式、音阶、和弦、音程
// 纯函数模块，不依赖 DOM 与 Tone.js，方便复用与测试（仿 analysis.ts）

export const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

// —— 音符名 ——

export function pitchClassName(pc: number, flats = false): string {
  const n = ((pc % 12) + 12) % 12;
  return (flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[n];
}

/** 展示用双拼写：黑键音级同时标「升/降」两种（升号在前），如 "G♯/A♭"；白键原样 */
export function pitchClassDisplay(pc: number): string {
  const n = ((pc % 12) + 12) % 12;
  const sharp = NOTE_NAMES_SHARP[n];
  const flat = NOTE_NAMES_FLAT[n];
  if (sharp === flat) return sharp;
  return `${sharp.replace("#", "♯")}/${flat.replace("b", "♭")}`;
}

export function midiToName(midi: number, flats = false): string {
  return `${pitchClassName(midi, flats)}${Math.floor(midi / 12) - 1}`;
}

interface ParsedNote { letter: number; accidental: number; octave: number; }

const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11]; // C..B 的自然半音

function parseNote(name: string): ParsedNote | null {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!match) return null;
  const letter = ["C", "D", "E", "F", "G", "A", "B"].indexOf(match[1].toUpperCase());
  if (letter < 0) return null;
  const accidental = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  return { letter, accidental, octave: Number(match[3]) };
}

export function nameToMidi(name: string): number {
  const parsed = parseNote(name);
  if (!parsed) return -1;
  return (parsed.octave + 1) * 12 + NATURAL_PC[parsed.letter] + parsed.accidental;
}

// —— 中古调式（7 种）——

export interface Mode {
  id: string;
  name: string;
  nameZh: string;
  /** 相对根音的半音偏移（升序） */
  intervals: number[];
}

export const MODES: Mode[] = [
  { id: "ionian", name: "Ionian", nameZh: "伊奥尼亚调式", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "dorian", name: "Dorian", nameZh: "多利亚调式", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "phrygian", name: "Phrygian", nameZh: "弗里几亚调式", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "lydian", name: "Lydian", nameZh: "利底亚调式", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "mixolydian", name: "Mixolydian", nameZh: "混合利底亚调式", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "aeolian", name: "Aeolian", nameZh: "爱奥利亚调式", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "locrian", name: "Locrian", nameZh: "洛克里亚调式", intervals: [0, 1, 3, 5, 6, 8, 10] },
];

/** 音程结构串，如大调 → "全 · 全 · 半 · 全 · 全 · 全 · 半" */
export function intervalsToSteps(intervals: number[]): string {
  const parts: string[] = [];
  for (let i = 1; i < intervals.length; i++) {
    const gap = intervals[i] - intervals[i - 1];
    parts.push(gap === 2 ? "全" : gap === 1 ? "半" : `${gap}半音`);
  }
  return parts.join(" · ");
}

// —— 五度圈 ——

export interface CircleKey {
  index: number;      // 0-11，从 C 起顺时针按五度
  majorPc: number;    // 大调主音音级
  minorPc: number;    // 关系小调音级 = (majorPc + 9) % 12
  majorName: string;  // "C" / "F#" / "Db"
  minorName: string;  // "Am" / "D#m" / "Bbm"
  accidental: number; // 有符号升降号数：+N 升号，-N 降号
}

export const CIRCLE_OF_FIFTHS: CircleKey[] = [
  { index: 0, majorPc: 0, minorPc: 9, majorName: "C", minorName: "Am", accidental: 0 },
  { index: 1, majorPc: 7, minorPc: 4, majorName: "G", minorName: "Em", accidental: 1 },
  { index: 2, majorPc: 2, minorPc: 11, majorName: "D", minorName: "Bm", accidental: 2 },
  { index: 3, majorPc: 9, minorPc: 6, majorName: "A", minorName: "F#m", accidental: 3 },
  { index: 4, majorPc: 4, minorPc: 1, majorName: "E", minorName: "C#m", accidental: 4 },
  { index: 5, majorPc: 11, minorPc: 8, majorName: "B", minorName: "G#m", accidental: 5 },
  { index: 6, majorPc: 6, minorPc: 3, majorName: "F#", minorName: "D#m", accidental: 6 },
  { index: 7, majorPc: 1, minorPc: 10, majorName: "Db", minorName: "Bbm", accidental: -5 },
  { index: 8, majorPc: 8, minorPc: 5, majorName: "Ab", minorName: "Fm", accidental: -4 },
  { index: 9, majorPc: 3, minorPc: 0, majorName: "Eb", minorName: "Cm", accidental: -3 },
  { index: 10, majorPc: 10, minorPc: 7, majorName: "Bb", minorName: "Gm", accidental: -2 },
  { index: 11, majorPc: 5, minorPc: 2, majorName: "F", minorName: "Dm", accidental: -1 },
];

// —— 音阶库 ——

export interface Scale {
  id: string;
  nameZh: string;
  intervals: number[];
}

export const SCALES: Scale[] = [
  { id: "major", nameZh: "大调", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", nameZh: "自然小调", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "harmonic-minor", nameZh: "和声小调", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", nameZh: "旋律小调", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "major-pentatonic", nameZh: "大调五声", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", nameZh: "小调五声", intervals: [0, 3, 5, 7, 10] },
  { id: "blues", nameZh: "蓝调音阶", intervals: [0, 3, 5, 6, 7, 10] },
];

/** 给定主音与音程偏移，返回音级集合（0-11） */
export function scaleNotes(tonic: number, intervals: number[]): number[] {
  return intervals.map(i => (tonic + i) % 12);
}

// —— 调内和弦 ——

export interface DiatonicChord {
  degree: number;      // 1..n
  roman: string;       // "I" / "ii" / "V" / "vii°"
  suffix: string;      // "" / "m" / "°" / "maj7" / "7" / "m7" / "m7♭5" ...
  rootPc: number;      // 根音音级 0-11
  rootName: string;    // 拼写后的根音名
  intervals: number[]; // 相对根音半音，如 [0,4,7] / [0,4,7,10]
}

function triadSuffix(intervals: number[]): string {
  const [third, fifth] = [intervals[1], intervals[2]];
  if (fifth === 7) return third === 4 ? "" : "m";
  if (fifth === 6) return "°";
  if (fifth === 8) return "aug";
  return "";
}

function seventhSuffix(intervals: number[]): string {
  const [third, fifth, seventh] = [intervals[1], intervals[2], intervals[3]];
  if (fifth === 7 && seventh === 11) return third === 4 ? "maj7" : "mMaj7";
  if (fifth === 7 && seventh === 10) return third === 4 ? "7" : "m7";
  if (fifth === 6 && seventh === 10) return "m7♭5";
  if (fifth === 6 && seventh === 9) return "°7";
  return "";
}

// 罗马数字按和弦性质现算：大三/增三→大写，小三→小写，减三→小写加 °
function romanForDegree(degree: number, chordIntervals: number[]): string {
  const fifth = chordIntervals[2];
  const base = ["I", "II", "III", "IV", "V", "VI", "VII"][degree];
  if (fifth === 6) return base.toLowerCase() + "°";
  return fifth === 7 || fifth === 8 ? base : base.toLowerCase();
}

// 任意音阶（各中古调式、大/自然/和声/旋律小调）的调内和弦：从每一级三度叠置
export function scaleChords(rootPc: number, intervals: number[], withSevenths = true, flats = false): DiatonicChord[] {
  const n = intervals.length;
  // 音阶第 deg 级的音（可 ≥n 跨八度）相对主音的半音距离
  const off = (deg: number) => intervals[deg % n] + Math.floor(deg / n) * 12;
  const result: DiatonicChord[] = [];
  for (let degree = 0; degree < n; degree++) {
    const root = off(degree);
    const third = off(degree + 2);
    const fifth = off(degree + 4);
    const chordIntervals = withSevenths
      ? [0, third - root, fifth - root, off(degree + 6) - root]
      : [0, third - root, fifth - root];
    const pc = ((rootPc + root) % 12 + 12) % 12;
    result.push({
      degree: degree + 1,
      roman: romanForDegree(degree, chordIntervals),
      suffix: withSevenths ? seventhSuffix(chordIntervals) : triadSuffix(chordIntervals),
      rootPc: pc,
      rootName: pitchClassName(pc, flats),
      intervals: chordIntervals,
    });
  }
  return result;
}

// —— 和弦教学（根音 + 性质）——

export interface ChordQuality {
  id: string;
  nameZh: string;
  nameEn: string;
  intervals: number[];
}

export const CHORD_QUALITIES: ChordQuality[] = [
  { id: "maj", nameZh: "大三和弦", nameEn: "Major", intervals: [0, 4, 7] },
  { id: "min", nameZh: "小三和弦", nameEn: "Minor", intervals: [0, 3, 7] },
  { id: "dim", nameZh: "减三和弦", nameEn: "Diminished", intervals: [0, 3, 6] },
  { id: "aug", nameZh: "增三和弦", nameEn: "Augmented", intervals: [0, 4, 8] },
  { id: "sus2", nameZh: "挂二和弦", nameEn: "Sus2", intervals: [0, 2, 7] },
  { id: "sus4", nameZh: "挂四和弦", nameEn: "Sus4", intervals: [0, 5, 7] },
  { id: "7", nameZh: "属七和弦", nameEn: "Dominant 7th", intervals: [0, 4, 7, 10] },
  { id: "maj7", nameZh: "大七和弦", nameEn: "Major 7th", intervals: [0, 4, 7, 11] },
  { id: "m7", nameZh: "小七和弦", nameEn: "Minor 7th", intervals: [0, 3, 7, 10] },
  { id: "mMaj7", nameZh: "小大七和弦", nameEn: "Minor-major 7th", intervals: [0, 3, 7, 11] },
  { id: "m7b5", nameZh: "半减七和弦", nameEn: "Half-diminished", intervals: [0, 3, 6, 10] },
  { id: "dim7", nameZh: "减七和弦", nameEn: "Diminished 7th", intervals: [0, 3, 6, 9] },
  { id: "6", nameZh: "大六和弦", nameEn: "Major 6th", intervals: [0, 4, 7, 9] },
  { id: "add9", nameZh: "加九和弦", nameEn: "Add9", intervals: [0, 4, 7, 14] },
];

/** 根音音级 + 和弦音程 → 具体 MIDI 音（根音锚在 baseOctave） */
export function chordMidiNotes(rootPc: number, intervals: number[], baseOctave = 4): number[] {
  const rootMidi = (baseOctave + 1) * 12 + rootPc;
  return intervals.map(i => rootMidi + i);
}

// —— 音程计算 ——

export interface IntervalResult {
  semitones: number;   // 带符号半音距（正=上行）
  direction: -1 | 0 | 1;
  number: number;      // 度数（复音程 >8）
  quality: string;     // "纯" / "大" / "小" / "增" / "减"
  nameZh: string;      // "纯五度"
  nameEn: string;      // "Perfect 5th"
  compound: boolean;   // 是否复音程
}

const PERFECT_REF = [0, 5, 7];             // 简单 1/4/5 的纯音程基准
const IMPERFECT_MINOR_REF = [1, 3, 8, 10]; // 简单 2/3/6/7 的小音程基准
const DEGREE_ZH = ["一度", "二度", "三度", "四度", "五度", "六度", "七度", "八度", "九度", "十度", "十一度", "十二度", "十三度", "十四度", "十五度"];
const EN_DEGREE = ["Unison", "2nd", "3rd", "4th", "5th", "6th", "7th", "Octave", "9th", "10th", "11th", "12th", "13th", "14th", "15th"];
const EN_QUALITY: Record<string, string> = { "纯": "Perfect", "大": "Major", "小": "Minor", "增": "Augmented", "减": "Diminished" };

/** 两个音名之间的音程（字母拼写决定度数，C→D# 报增二度、C→E♭ 报小三度） */
export function intervalBetween(nameA: string, nameB: string): IntervalResult {
  const a = parseNote(nameA);
  const b = parseNote(nameB);
  if (!a || !b) return { semitones: 0, direction: 0, number: 1, quality: "纯", nameZh: "同度", nameEn: "Unison", compound: false };

  const midiA = nameToMidi(nameA);
  const midiB = nameToMidi(nameB);
  const semitones = midiB - midiA;
  const direction = semitones > 0 ? 1 : semitones < 0 ? -1 : 0;

  const diatonicSteps = (b.octave * 7 + b.letter) - (a.octave * 7 + a.letter);
  const number = Math.abs(diatonicSteps) + 1;
  const simpleDegree = ((number - 1) % 7) + 1;
  const octaves = Math.floor((number - 1) / 7);
  const absSemis = Math.abs(semitones);

  let quality: string;
  if (simpleDegree === 1 || simpleDegree === 4 || simpleDegree === 5) {
    const perfect = PERFECT_REF[simpleDegree === 1 ? 0 : simpleDegree === 4 ? 1 : 2] + octaves * 12;
    quality = absSemis === perfect ? "纯" : absSemis > perfect ? "增" : "减";
  } else {
    const minorRef = IMPERFECT_MINOR_REF[[2, 3, 6, 7].indexOf(simpleDegree)] + octaves * 12;
    const majorRef = minorRef + 1;
    quality = absSemis === majorRef ? "大" : absSemis === minorRef ? "小" : absSemis > majorRef ? "增" : "减";
  }

  return {
    semitones,
    direction,
    number,
    quality,
    nameZh: `${quality}${DEGREE_ZH[number - 1] ?? `${number}度`}`,
    nameEn: `${EN_QUALITY[quality]} ${EN_DEGREE[number - 1] ?? `${number}th`}`,
    compound: number > 8,
  };
}
