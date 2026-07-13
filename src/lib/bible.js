import { get, set } from 'idb-keyval';

// 성경전서 개역한글판(1961) 전권 — 저작권 만료(2012)로 자유롭게 사용 가능한 본문.
// public/bible/krv.json: [책][장][절] 3중 배열 (번호는 인덱스+1, 1189장 31,102절).
// 첫 사용 시 내려받아 IndexedDB에 보관하므로 이후에는 오프라인에서도 찾을 수 있다.

const KEY = 'bible-krv-v1';
let cached = null;
let loading = null;

export function loadBible() {
  if (cached) return Promise.resolve(cached);
  if (loading) return loading;
  loading = (async () => {
    let data = null;
    try { data = await get(KEY); } catch { data = null; }
    if (!data) {
      const res = await fetch(`${import.meta.env.BASE_URL}bible/krv.json`);
      if (!res.ok) throw new Error('bible fetch failed');
      data = await res.json();
      try { await set(KEY, data); } catch { /* 보관 실패는 조용히 넘어간다 */ }
    }
    cached = data;
    return data;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// 66권 — [정식 이름, 표준 약칭, 그 밖의 별칭…]
export const BOOKS = [
  ['창세기', '창'], ['출애굽기', '출'], ['레위기', '레'], ['민수기', '민'], ['신명기', '신'],
  ['여호수아', '수'], ['사사기', '삿'], ['룻기', '룻'], ['사무엘상', '삼상'], ['사무엘하', '삼하'],
  ['열왕기상', '왕상'], ['열왕기하', '왕하'], ['역대상', '대상'], ['역대하', '대하'], ['에스라', '스'],
  ['느헤미야', '느'], ['에스더', '에'], ['욥기', '욥'], ['시편', '시'], ['잠언', '잠'],
  ['전도서', '전'], ['아가', '아'], ['이사야', '사'], ['예레미야', '렘'], ['예레미야애가', '애', '애가'],
  ['에스겔', '겔'], ['다니엘', '단'], ['호세아', '호'], ['요엘', '욜'], ['아모스', '암'],
  ['오바댜', '옵'], ['요나', '욘'], ['미가', '미'], ['나훔', '나'], ['하박국', '합'],
  ['스바냐', '습'], ['학개', '학'], ['스가랴', '슥'], ['말라기', '말'],
  ['마태복음', '마', '마태'], ['마가복음', '막', '마가'], ['누가복음', '눅', '누가'],
  ['요한복음', '요', '요한'], ['사도행전', '행', '행전'], ['로마서', '롬'],
  ['고린도전서', '고전'], ['고린도후서', '고후'], ['갈라디아서', '갈'], ['에베소서', '엡'],
  ['빌립보서', '빌'], ['골로새서', '골'], ['데살로니가전서', '살전', '데살전'], ['데살로니가후서', '살후', '데살후'],
  ['디모데전서', '딤전'], ['디모데후서', '딤후'], ['디도서', '딛'], ['빌레몬서', '몬', '빌레몬'],
  ['히브리서', '히'], ['야고보서', '약', '야고보'], ['베드로전서', '벧전'], ['베드로후서', '벧후'],
  ['요한일서', '요일'], ['요한이서', '요이'], ['요한삼서', '요삼'], ['유다서', '유', '유다'],
  ['요한계시록', '계', '계시록'],
];

// 별칭 → 책 번호(1~66). 긴 이름부터 맞춰 '요일'이 '요'보다 먼저 잡히게 한다.
const ALIASES = [];
BOOKS.forEach((names, i) => names.forEach((n) => ALIASES.push([n, i + 1])));
ALIASES.sort((a, b) => b[0].length - a[0].length);

export const bookName = (b) => BOOKS[b - 1][0];

// 개역한글에서 "(없음)"으로 표기되는 절들 (책:장:절)
const NONE = new Set([
  '40:18:11', '41:9:44', '41:9:46', '41:11:26', '41:15:28',
  '42:17:36', '42:23:17', '44:8:37', '44:15:34', '44:28:29', '45:16:24',
]);

// "요 3:16", "요한복음 3장 16절", "창 1:1-3" 형태를 해석.
// 반환: { b, c, v1, v2, text(매치된 원문) } 또는 null
const REF_RE = /([가-힣]{1,7})\s*(\d{1,3})\s*[:장]\s*(\d{1,3})\s*(?:[-~]\s*(\d{1,3})\s*)?절?/g;

export function parseRef(str) {
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(str || ''))) {
    const found = ALIASES.find(([n]) => m[1].endsWith(n));
    if (!found) continue;
    const v1 = Number(m[3]);
    const v2 = m[4] ? Number(m[4]) : v1;
    if (v2 < v1) continue;
    const start = m.index + m[1].length - found[0].length;
    return { b: found[1], c: Number(m[2]), v1, v2, text: str.slice(start, m.index + m[0].length) };
  }
  return null;
}

// 구절 본문 조회. 개역한글의 합쳐진 절(예: 롬 9:1-2)과 (없음) 절을 알아서 처리한다.
// 반환: { label, items: [{ n, text }] } 또는 null(범위가 없을 때)
export async function getPassage(ref) {
  const data = await loadBible();
  const book = data[ref.b - 1];
  const ch = book?.[ref.c - 1];
  if (!ch) return null;
  const v1 = ref.v1;
  const v2 = Math.min(ref.v2, ch.length);
  if (v1 > ch.length) return null;
  const items = [];
  for (let n = v1; n <= v2; n += 1) {
    const text = ch[n - 1];
    if (text) { items.push({ n: String(n), text }); continue; }
    if (NONE.has(`${ref.b}:${ref.c}:${n}`)) { items.push({ n: String(n), text: '(없음)' }); continue; }
    // 앞 절과 합쳐진 절 — 이미 담았다면 번호만 넓히고, 첫 절이면 앞 절 본문을 가져온다
    const prev = items[items.length - 1];
    if (prev && prev.text !== '(없음)') prev.n = `${prev.n.split('-')[0]}-${n}`;
    else if (n >= 2) items.push({ n: `${n - 1}-${n}`, text: ch[n - 2] });
  }
  if (!items.length) return null;
  const first = items[0].n.split('-')[0];
  const last = items[items.length - 1].n.split('-').pop();
  const range = first === last ? first : `${first}-${last}`;
  return { label: `${bookName(ref.b)} ${ref.c}:${range}`, items };
}
