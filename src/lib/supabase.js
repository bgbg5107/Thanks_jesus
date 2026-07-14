import { createClient } from '@supabase/supabase-js';
import { get, set, del } from 'idb-keyval';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

const idbStorage = {
  getItem: (key) => get(key),
  setItem: (key, value) => set(key, value),
  removeItem: (key) => del(key),
};

export const configured = Boolean(url && key && !url.includes('YOUR-PROJECT'));
export const supabase = configured
  ? createClient(url, key, { auth: { storage: idbStorage } })
  : null;

export function photoUrl(path) {
  if (!path) return '';
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
