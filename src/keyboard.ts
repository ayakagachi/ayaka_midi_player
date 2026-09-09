// 琴键几何与音名工具：从 main.ts 抽出，键范围可参数化，供演奏页与乐理页共用
// 纯函数模块，不依赖 DOM 与 Tone.js

export const NOTE_MIN = 21;
export const NOTE_MAX = 108;

export function isBlack(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(midi % 12);
}

export function midiName(midi: number): string {
  return `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function whiteKeyMetrics(width: number, min = NOTE_MIN, max = NOTE_MAX) {
  const whiteNotes: number[] = [];
  for (let midi = min; midi <= max; midi++) if (!isBlack(midi)) whiteNotes.push(midi);
  const whiteWidth = width / whiteNotes.length;
  const starts = new Map<number, number>();
  whiteNotes.forEach((midi, index) => starts.set(midi, index * whiteWidth));
  return { whiteWidth, starts };
}

export function noteGeometry(midi: number, width: number, min = NOTE_MIN, max = NOTE_MAX) {
  const { whiteWidth, starts } = whiteKeyMetrics(width, min, max);
  if (!isBlack(midi)) return { x: starts.get(midi)!, width: whiteWidth, black: false };
  let previous = midi - 1;
  while (isBlack(previous)) previous--;
  // 左边界是黑键时，其左邻白键在范围外，按左边界外一格定位，避免 NaN
  const prevX = starts.get(previous) ?? -whiteWidth;
  const center = prevX + whiteWidth;
  return { x: center - whiteWidth * 0.32, width: whiteWidth * 0.64, black: true };
}
