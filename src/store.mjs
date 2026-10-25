import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export const emptyStore = () => ({ version: 1, events: {}, files: {}, excluded: {} });
export async function loadJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error('저장 파일을 읽을 수 없습니다. 원본을 보존한 채 복구가 필요합니다.'); }
}
export async function saveJSON(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(value));
  await rename(temporary, file);
}
export function deleteHistory(store, provider) {
  for (const [key, event] of Object.entries(store.events)) {
    if (provider === 'all' || event.provider === provider) {
      store.excluded[key] = event.provider;
      delete store.events[key];
    }
  }
}
export function allowReimport(store, provider) {
  for (const [key, value] of Object.entries(store.excluded)) if (provider === 'all' || provider === value) delete store.excluded[key];
  for (const [key, value] of Object.entries(store.files)) if (provider === 'all' || provider === value.provider) delete store.files[key];
}
