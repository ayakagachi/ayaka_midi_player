export interface AppConfig {
  /** 切走标签页时是否继续播放 */
  backgroundPlayback: boolean;
  /** 导入 MIDI 时是否保存到曲库文件夹 */
  saveToLibrary: boolean;
}

export const defaultConfig: AppConfig = {
  backgroundPlayback: true,
  saveToLibrary: false,
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
