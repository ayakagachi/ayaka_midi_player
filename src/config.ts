import { SAMPLED_INSTRUMENTS, type SampledInstrumentId } from "./sampledInstruments";

export type EngineCategory = "synth" | "sampled";
export type SynthInstrumentId = "piano" | "bright" | "electric" | "organ";
export type ParticleEffectId = "spark" | "starlight" | "ripple" | "note" | "none";

export interface AppConfig {
  /** 切走标签页时是否继续播放 */
  backgroundPlayback: boolean;
  /** 导入 MIDI 时是否保存到曲库文件夹 */
  saveToLibrary: boolean;
  /** 声音引擎大类：合成器或采样乐器（具体音色在演奏页切换） */
  engine: EngineCategory;
  /** 合成器音色（engine 为 synth 时生效） */
  synthInstrument: SynthInstrumentId;
  /** 采样乐器（engine 为 sampled 时生效） */
  sampledInstrument: SampledInstrumentId;
  /** 落键/播放音符时的粒子特效 */
  particleEffect: ParticleEffectId;
  /** 粒子特效运动速度倍率（0.5–2） */
  particleSpeed: number;
  /** 粒子特效扩散范围倍率（0.5–2） */
  particleSpread: number;
  /** 粒子特效数量倍率（0.5–2） */
  particleAmount: number;
}

export const defaultConfig: AppConfig = {
  backgroundPlayback: true,
  saveToLibrary: false,
  engine: "synth",
  synthInstrument: "piano",
  sampledInstrument: "piano",
  particleEffect: "spark",
  particleSpeed: 1,
  particleSpread: 1,
  particleAmount: 1,
};

const STORAGE_KEY = "sumine:config";

const SYNTH_INSTRUMENTS: readonly SynthInstrumentId[] = ["piano", "bright", "electric", "organ"];
const PARTICLE_EFFECTS: readonly ParticleEffectId[] = ["spark", "starlight", "ripple", "note", "none"];

function isSynthInstrument(value: unknown): value is SynthInstrumentId {
  return typeof value === "string" && (SYNTH_INSTRUMENTS as readonly string[]).includes(value);
}

function isSampledInstrument(value: unknown): value is SampledInstrumentId {
  return typeof value === "string" && value in SAMPLED_INSTRUMENTS;
}

function isParticleEffect(value: unknown): value is ParticleEffectId {
  return typeof value === "string" && (PARTICLE_EFFECTS as readonly string[]).includes(value);
}

// 粒子参数倍率：非法/越界值回落到 1
function clampParticleMultiplier(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(2, Math.max(.5, value)) : 1;
}

function resolveConfig(parsed: Record<string, unknown>): AppConfig {
  const backgroundPlayback = typeof parsed.backgroundPlayback === "boolean" ? parsed.backgroundPlayback : defaultConfig.backgroundPlayback;
  const saveToLibrary = typeof parsed.saveToLibrary === "boolean" ? parsed.saveToLibrary : defaultConfig.saveToLibrary;
  const particleEffect = isParticleEffect(parsed.particleEffect) ? parsed.particleEffect : defaultConfig.particleEffect;
  const particleSpeed = clampParticleMultiplier(parsed.particleSpeed);
  const particleSpread = clampParticleMultiplier(parsed.particleSpread);
  const particleAmount = clampParticleMultiplier(parsed.particleAmount);

  // 旧版只存 soundEngine（"synth" | "sampler" | 采样乐器id），迁移为「大类 + 具体乐器」
  if (typeof parsed.engine !== "string" && typeof parsed.soundEngine === "string") {
    const se = parsed.soundEngine;
    const base = {
      backgroundPlayback,
      saveToLibrary,
      particleEffect,
      particleSpeed,
      particleSpread,
      particleAmount,
      synthInstrument: "piano" as SynthInstrumentId,
      sampledInstrument: "piano" as SampledInstrumentId,
    };
    if (se === "synth") return { ...base, engine: "synth" };
    if (se === "sampler") return { ...base, engine: "sampled" };
    if (isSampledInstrument(se)) return { ...base, engine: "sampled", sampledInstrument: se };
    return { ...defaultConfig, backgroundPlayback, saveToLibrary };
  }

  return {
    backgroundPlayback,
    saveToLibrary,
    particleEffect,
    particleSpeed,
    particleSpread,
    particleAmount,
    engine: parsed.engine === "synth" || parsed.engine === "sampled" ? parsed.engine : defaultConfig.engine,
    synthInstrument: isSynthInstrument(parsed.synthInstrument) ? parsed.synthInstrument : defaultConfig.synthInstrument,
    sampledInstrument: isSampledInstrument(parsed.sampledInstrument) ? parsed.sampledInstrument : defaultConfig.sampledInstrument,
  };
}

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultConfig };
    return resolveConfig(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return { ...defaultConfig };
  }
}

function saveConfig(config: AppConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

type ConfigListener = (config: AppConfig) => void;
const listeners: ConfigListener[] = [];

export function onConfigChange(listener: ConfigListener) {
  listeners.push(listener);
}

let current: AppConfig | null = null;

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  current = { ...(current ?? loadConfig()), ...patch };
  saveConfig(current);
  for (const listener of listeners) listener({ ...current });
  return current;
}
