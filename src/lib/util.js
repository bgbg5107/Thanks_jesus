export const EMOTIONS = [
  { name: '행복', emoji: '😊' },
  { name: '기쁨', emoji: '😄' },
  { name: '뿌듯', emoji: '🥰' },
  { name: '감동', emoji: '🥹' },
  { name: '평온', emoji: '😌' },
  { name: '그냥그래', emoji: '😐' },
  { name: '피곤', emoji: '😪' },
  { name: '불안', emoji: '😟' },
  { name: '슬픔', emoji: '😢' },
  { name: '우울', emoji: '😞' },
  { name: '화남', emoji: '😠' },
  { name: '모르겠음', emoji: '🤔' },
];

export const emojiOf = (name) => EMOTIONS.find((e) => e.name === name)?.emoji || '🤔';

// 감사 항목은 옛 형식(문자열)과 새 형식({ text, photos }) 둘 다 존재할 수 있다
export const itemText = (c) => (typeof c === 'string' ? c : c?.text || '');
export const itemPhotos = (c) => (typeof c === 'string' ? [] : c?.photos || []);

export function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtKoDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

// 매일 자정 기준으로 말씀 1개 선정 (날짜 기반 결정적 인덱스)
export function verseOfDay(verses, dateStr = todayStr()) {
  if (!verses?.length) return null;
  let h = 0;
  for (const c of dateStr) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return verses[h % verses.length];
}

export function randomVerse(verses) {
  if (!verses?.length) return null;
  return verses[Math.floor(Math.random() * verses.length)];
}

// 연속 기록일수(스트릭): 오늘 또는 어제부터 거꾸로 연속된 날짜 수
export function streakOf(dateSet) {
  let d = new Date();
  if (!dateSet.has(todayStr(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (dateSet.has(todayStr(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}
