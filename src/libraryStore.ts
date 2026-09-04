// 曲库存储：基于 File System Access API，把 MIDI 存进用户选择的本地文件夹。
// 目录句柄持久化在 IndexedDB，下次打开免重选（权限需用户手势恢复）。
// 仅 Chromium（Chrome/Edge）支持。

interface PermissionCapableHandle {
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export interface LibraryEntry {
  name: string;
}

const DB_NAME = "sumine";
const DB_STORE = "handles";
const HANDLE_KEY = "libraryDir";

let dirHandle: FileSystemDirectoryHandle | null = null;

export function isSupported(): boolean {
  return typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function persistHandle(handle: FileSystemDirectoryHandle) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadPersistedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function verifyPermission(handle: FileSystemDirectoryHandle, request: boolean): Promise<boolean> {
  const capable = handle as FileSystemDirectoryHandle & PermissionCapableHandle;
  if (!capable.queryPermission || !capable.requestPermission) return true;
  if (await capable.queryPermission({ mode: "readwrite" }) === "granted") return true;
  if (!request) return false;
  return await capable.requestPermission({ mode: "readwrite" }) === "granted";
}

/** 恢复已保存的目录句柄（不主动请求权限）。返回是否已有可用目录。 */
export async function restore(): Promise<boolean> {
  if (!isSupported()) return false;
  dirHandle ??= await loadPersistedHandle();
  return dirHandle !== null && await verifyPermission(dirHandle, false);
}

/** 已选目录的显示名，未选返回 null。 */
export function directoryName(): string | null {
  return dirHandle?.name ?? null;
}

/** 弹出目录选择器。成功（含权限）返回 true，用户取消返回 false。 */
export async function pickDirectory(): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    const handle = await (window as unknown as {
      showDirectoryPicker(options?: { mode?: string }): Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker({ mode: "readwrite" });
    if (!await verifyPermission(handle, true)) return false;
    dirHandle = handle;
    await persistHandle(handle);
    return true;
  } catch {
    return false; // 用户取消
  }
}

/** 确保目录可用：已有句柄则请求权限，没有则弹选择器。 */
export async function ensureReady(): Promise<boolean> {
  if (!isSupported()) return false;
  if (dirHandle) return verifyPermission(dirHandle, true);
  return pickDirectory();
}

function midiFileName(name: string): string {
  return /\.(mid|midi)$/i.test(name) ? name : `${name}.mid`;
}

async function uniqueFileName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const base = name.replace(/\.(mid|midi)$/i, "");
  const ext = name.match(/\.(mid|midi)$/i)?.[0] ?? ".mid";
  let candidate = name;
  for (let count = 2; ; count++) {
    try {
      await dir.getFileHandle(candidate);
      candidate = `${base} (${count})${ext}`;
    } catch {
      return candidate;
    }
  }
}

/** 目录内是否已有内容完全相同的 MIDI 文件 */
async function hasDuplicate(file: File): Promise<boolean> {
  if (!dirHandle) return false;
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  for await (const [name, handle] of dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind !== "file" || !/\.(mid|midi)$/i.test(name)) continue;
    const existing = await (handle as FileSystemFileHandle).getFile();
    if (existing.size !== file.size) continue;
    const existingBytes = new Uint8Array(await existing.arrayBuffer());
    let same = true;
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== existingBytes[index]) { same = false; break; }
    }
    if (same) return true;
  }
  return false;
}

/** 写入曲库。返回是否真正写入；已有相同内容的文件时跳过并返回 false。 */
export async function save(file: File): Promise<boolean> {
  if (!dirHandle || !await verifyPermission(dirHandle, false)) throw new Error("曲库文件夹不可用");
  if (await hasDuplicate(file)) return false;
  const name = await uniqueFileName(dirHandle, midiFileName(file.name));
  const handle = await dirHandle.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();
  return true;
}

export async function list(): Promise<LibraryEntry[]> {
  if (!dirHandle || !await verifyPermission(dirHandle, false)) return [];
  const entries: LibraryEntry[] = [];
  for await (const [name, handle] of dirHandle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (handle.kind === "file" && /\.(mid|midi)$/i.test(name)) entries.push({ name });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

export async function open(name: string): Promise<File> {
  if (!dirHandle) throw new Error("曲库文件夹不可用");
  const handle = await dirHandle.getFileHandle(name);
  return handle.getFile();
}

export async function remove(name: string): Promise<void> {
  if (!dirHandle || !await verifyPermission(dirHandle, false)) throw new Error("曲库文件夹不可用");
  await dirHandle.removeEntry(name);
}
