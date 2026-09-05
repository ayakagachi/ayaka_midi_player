export interface AppConfig {
  /** 切走标签页时是否继续播放 */
  backgroundPlayback: boolean;
  /** 导入 MIDI 时是否保存到曲库文件夹 */
  saveToLibrary: boolean;
  /** 声音引擎：synth 合成器（即时）或 sampler 采样钢琴（更真实、延迟更低，需加载） */
  soundEngine: "synth" | "sampler";
}

export const defaultConfig: AppConfig = {
  backgroundPlayback: true,
  saveToLibrary: false,
  soundEngine: "synth",
};

const STORAGE_KEY = "sumine:config";

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaultConfig };
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      backgroundPlayback: typeof parsed.backgroundPlayback === "boolean" ? parsed.backgroundPlayback : defaultConfig.backgroundPlayback,
      saveToLibrary: typeof parsed.saveToLibrary === "boolean" ? parsed.saveToLibrary : defaultConfig.saveToLibrary,
      soundEngine: parsed.soundEngine === "sampler" || parsed.soundEngine === "synth" ? parsed.soundEngine : defaultConfig.soundEngine,
    };
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
