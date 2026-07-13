import { photoUrl } from '../lib/supabase.js';

const FACE_EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉',
  '😇','🥰','😍','🤩','😎','🤓','😋','😜','😝','🤗',
  '🤭','🥳','😺','🐱','🐶','🐰','🐻','🦊','🐼','🐨',
  '🦁','🐯','🐸','🐵','🙈','🙉','🙊','🌸','🌻','🌈',
];

// user_id 기반 고정 이모지 — 사람마다 다르지만 항상 같은 이모지
function emojiFor(id) {
  if (!id) return '😀';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return FACE_EMOJIS[Math.abs(h) % FACE_EMOJIS.length];
}

// 프로필 사진 — 사진이 없으면 user_id 기반 이모지를 오렌지 원으로
export default function Avatar({ profile, size = 44, onClick, plain = false }) {
  const style = { width: size, height: size, fontSize: size * 0.48 };
  const inner = profile?.avatar_url
    ? <img src={photoUrl(profile.avatar_url)} alt="" />
    : emojiFor(profile?.id);
  if (onClick) {
    return <button type="button" className={`avatar${plain ? ' plain' : ''}`} style={style} onClick={onClick}>{inner}</button>;
  }
  return <span className={`avatar${plain ? ' plain' : ''}`} style={{ ...style, cursor: 'default' }}>{inner}</span>;
}
