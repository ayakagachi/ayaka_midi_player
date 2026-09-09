// 用户音符输入事件总线：main.ts（Web MIDI / 屏幕琴键）发出，练习页等模块订阅
// 零依赖纯模块，避免 main.ts 与页面模块互相引用

export type NoteInputEvent = { type: "on" | "off"; midi: number; velocity: number };

const listeners = new Set<(event: NoteInputEvent) => void>();

export function onNoteInput(listener: (event: NoteInputEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitNoteInput(event: NoteInputEvent): void {
  listeners.forEach(listener => listener(event));
}
