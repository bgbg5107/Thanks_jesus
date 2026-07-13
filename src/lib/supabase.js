import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key && !url.includes('YOUR-PROJECT'));
export const supabase = configured ? createClient(url, key) : null;

export function photoUrl(path) {
  if (!path) return '';
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
