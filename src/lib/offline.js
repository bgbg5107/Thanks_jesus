import { get, set } from 'idb-keyval';
import { supabase } from './supabase.js';

// 오프라인 작성분: { [tempId]: entryDraft } 형태로 로컬(IndexedDB)에 보관 후
// 네트워크 복구 시 자동 동기화한다.

const PENDING = 'pending-entries';
const CACHE = 'entries-cache';

export async function getPending() {
  return (await get(PENDING)) || {};
}

export async function getPendingForDate(date) {
  const all = await getPending();
  return Object.values(all).filter((d) => d.date === date);
}

export async function savePending(draft) {
  if (!draft._tempId) draft._tempId = crypto.randomUUID();
  const all = await getPending();
  all[draft._tempId] = draft;
  await set(PENDING, all);
}

export async function removePending(tempId) {
  const all = await getPending();
  delete all[tempId];
  await set(PENDING, all);
}

export async function cacheEntries(entries) {
  await set(CACHE, entries);
}

export async function getCachedEntries() {
  return (await get(CACHE)) || [];
}

// File[] → 업로드/보관용 { name, type, blob }[] 변환
export async function filesToData(files) {
  return Promise.all(
    (files || []).map(async (f) => ({ name: f.name, type: f.type, blob: new Blob([await f.arrayBuffer()], { type: f.type }) }))
  );
}

async function uploadPhotos(userId, photosData) {
  const paths = [];
  for (const p of photosData || []) {
    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { error } = await supabase.storage.from('photos').upload(path, p.blob, { contentType: p.type });
    if (error) throw error;
    paths.push(path);
  }
  return paths;
}

// 대기 중인 기록을 서버로 전송. 성공한 건은 큐에서 제거.
export async function flushPending(userId) {
  const all = await getPending();
  let synced = 0;
  for (const tempId of Object.keys(all)) {
    const d = all[tempId];
    try {
      const newPaths = await uploadPhotos(userId, d.photosData);
      // 항목별 사진 (itemPhotosData: [{ i, name, type, blob }]) — 올린 뒤 해당 항목에 붙인다
      const contents = (d.contents || []).map((c) =>
        typeof c === 'string' ? { text: c, photos: [] } : { ...c, photos: [...(c.photos || [])] }
      );
      for (const ph of d.itemPhotosData || []) {
        const [path] = await uploadPhotos(userId, [ph]);
        if (contents[ph.i]) contents[ph.i].photos.push(path);
      }
      const row = {
        user_id: userId,
        date: d.date,
        contents,
        emotion: d.emotion,
        photos: [...(d.photos || []), ...newPaths],
        visibility: d.visibility || 'private',
        shared_team_ids: d.shared_team_ids || [],
        shared_user_ids: d.shared_user_ids || [],
        updated_at: new Date().toISOString(),
      };
      let error;
      if (d.id) {
        // 기존 서버 기록 수정
        ({ error } = await supabase.from('entries').update(row).eq('id', d.id));
      } else {
        // 신규 기록 삽입
        ({ error } = await supabase.from('entries').insert(row));
      }
      if (error) throw error;
      await removePending(tempId);
      synced += 1;
    } catch {
      // 여전히 오프라인이거나 실패 — 다음 기회에 재시도
    }
  }
  return synced;
}

export { uploadPhotos };
