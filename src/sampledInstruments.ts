// 采样乐器数据：tonejs-instruments（https://github.com/nbrosowsky/tonejs-instruments）
// 采样授权 CC-BY 3.0（署名），代码 MIT；采样来自公有领域音源，已统一修剪/校音。
// 采样点以仓库 samples/<instrument>/ 目录实际文件为准。

export interface SampledInstrument {
  label: string;
  /** 采样点 note 名，作为 Tone.Sampler 的 urls 键 */
  notes: readonly string[];
  /** 文件名偏离 note.replace("#", "s") 规则时的显式覆盖（源库的个别笔误） */
  fileOverrides?: Readonly<Record<string, string>>;
}

export const SAMPLED_INSTRUMENTS = {
  "bass-electric": { label: "电贝司", notes: ["C#1","E1","G1","A#1","C#2","E2","G2","A#2","C#3","E3","G3","A#3","C#4","E4","G4","A#4"] },
  "bassoon": { label: "巴松", notes: ["G2","A2","C3","G3","A3","C4","E4","G4","A4","C5"] },
  "cello": { label: "大提琴", notes: ["C2","D2","D#2","E2","F2","G2","G#2","A2","A#2","B2","C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3","C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","B4","C5"] },
  "clarinet": { label: "单簧管", notes: ["D3","F3","A#3","D4","F4","A#4","D5","F5","A#5","D6","F#6"] },
  "contrabass": { label: "低音提琴", notes: ["F#1","G1","A#1","C2","D2","E2","F#2","G#2","A2","C#3","E3","G#3","B3"] },
  "flute": { label: "长笛", notes: ["C4","E4","A4","C5","E5","A5","C6","E6","A6","C7"] },
  "french-horn": { label: "圆号", notes: ["A1","C2","D#2","G2","D3","F3","A3","C4","D5","F5"] },
  "guitar-acoustic": { label: "原声吉他", notes: ["D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","B2","C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3","C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4","C5","C#5","D5"], fileOverrides: {"D#4":"Ds3"} },
  "guitar-electric": { label: "电吉他", notes: ["C#2","E2","F#2","A2","C3","D#3","F#3","A3","C4","D#4","F#4","A4","C5","D#5","F#5","A5","C6"] },
  "guitar-nylon": { label: "尼龙弦吉他", notes: ["B1","D2","E2","F#2","G#2","A2","B2","C#3","D3","E3","F#3","G3","A3","B3","C#4","D#4","E4","F#4","G#4","A4","B4","C#5","D5","E5","F#5","G5","G#5","A5","A#5"], fileOverrides: {"G5":"G3"} },
  "harmonium": { label: "簧风琴", notes: ["C2","C#2","D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","C4","C#4","D4","D#4","E4","F4","G4","G#4","A4","A#4","C5","C#5","D5"] },
  "harp": { label: "竖琴", notes: ["E1","G1","B1","D2","F2","A2","C3","E3","G3","B3","D4","F4","A4","C5","E5","G5","B5","D6","F6","A6","B6","D7","F7"] },
  "organ": { label: "管风琴", notes: ["C1","D#1","F#1","A1","C2","D#2","F#2","A2","C3","D#3","F#3","A3","C4","D#4","F#4","A4","C5","D#5","F#5","A5","C6"] },
  "piano": { label: "钢琴", notes: ["C1","C#1","D1","D#1","E1","F1","F#1","G1","G#1","A1","A#1","B1","C2","C#2","D2","D#2","E2","F2","F#2","G2","G#2","A2","A#2","B2","C3","C#3","D3","D#3","E3","F3","F#3","G3","G#3","A3","A#3","B3","C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4","C5","C#5","D5","D#5","E5","F5","F#5","G5","G#5","A5","A#5","B5","C6","C#6","D6","D#6","E6","F6","F#6","G6","G#6","A6","A#6","B6","C7","C#7","D7","D#7","E7","F7","F#7","G7","G#7","A7","A#7","B7"] },
  "saxophone": { label: "萨克斯", notes: ["C#3","D3","D#3","E3","F3","F#3","G3","G#3","A#3","B3","C4","C#4","D4","D#4","E4","F4","F#4","G4","G#4","A4","A#4","B4","C5","C#5","D5","D#5","E5","F5","F#5","G5","G#5","A5"] },
  "trombone": { label: "长号", notes: ["A#1","C#2","D#2","F2","G#2","A#2","C3","D3","D#3","F3","G#3","A#3","C4","C#4","D4","D#4","F4"] },
  "trumpet": { label: "小号", notes: ["F3","A3","C4","D#4","F4","G4","A#4","D5","F5","A5","C6"] },
  "tuba": { label: "大号", notes: ["F1","A#1","D#2","F2","A#2","D3","F3","A#3","D4"] },
  "violin": { label: "小提琴", notes: ["A3","C4","E4","G4","A4","C5","E5","G5","A5","C6","E6","G6","A6","C7"] },
  "xylophone": { label: "木琴", notes: ["G4","C5","G5","C6","G6","C7","G7","C8"] },
} as const satisfies Record<string, SampledInstrument>;

export type SampledInstrumentId = keyof typeof SAMPLED_INSTRUMENTS;

export const SAMPLE_BASE_URL = "https://nbrosowsky.github.io/tonejs-instruments/samples/";

export function samplerUrls(id: SampledInstrumentId): Record<string, string> {
  const def = SAMPLED_INSTRUMENTS[id] as SampledInstrument;
  const urls: Record<string, string> = {};
  for (const note of def.notes) {
    const file = def.fileOverrides?.[note] ?? note.replace("#", "s");
    urls[note] = `${file}.mp3`;
  }
  return urls;
}
