/* 감정 캐릭터 아이콘 — 쨍한 파스텔 도형 + 단순한 표정 (팔다리 없음).
   몸통 색은 일러스트 고유색(테마 무관), 몸 밖의 기호(z·물음표·빗방울 등)는
   다크모드에서도 보이도록 var(--ink)를 쓴다. 얼굴은 몸통 위라 고정 색. */

const F = '#2f2b26'; // 얼굴 선 (몸통 위)
const face = { stroke: F, strokeWidth: 5.5, strokeLinecap: 'round', fill: 'none' };
const mark = { stroke: 'var(--ink)', strokeWidth: 4.5, strokeLinecap: 'round', fill: 'none' };
const dot = (x, y) => <circle cx={x} cy={y} r="3.2" fill={F} />;

const ART = {
  행복: ( // 노란 동그라미 — 스르르 감은 눈, 활짝 웃음
    <>
      <circle cx="50" cy="52" r="38" fill="#f2c243" />
      <path {...face} d="M30 48 q7 8 14 0" />
      <path {...face} d="M56 48 q7 8 14 0" />
      <path {...face} d="M36 62 q14 12 28 0" />
    </>
  ),
  기쁨: ( // 살구빛 언덕 — 윙크와 왕눈이
    <>
      <path d="M12 78 a38 38 0 0 1 76 0 z" fill="#eda23b" />
      <circle cx="38" cy="56" r="7.5" fill="#ffffff" />
      <circle cx="40" cy="57" r="3.4" fill={F} />
      <path {...face} d="M58 55 q6 6 12 0" />
      <path {...face} d="M38 68 q12 8 24 0" />
    </>
  ),
  뿌듯: ( // 초록 네잎이 — 의기양양 왕눈이
    <>
      <g fill="#5cb96e">
        <circle cx="33" cy="37" r="17" />
        <circle cx="67" cy="37" r="17" />
        <circle cx="33" cy="67" r="17" />
        <circle cx="67" cy="67" r="17" />
        <circle cx="50" cy="52" r="17" />
      </g>
      <circle cx="42" cy="50" r="8" fill="#ffffff" />
      <circle cx="60" cy="48" r="8" fill="#ffffff" />
      <circle cx="45" cy="52" r="3.6" fill={F} />
      <circle cx="63" cy="50" r="3.6" fill={F} />
      <path {...face} d="M42 66 q8 6 16 0" />
    </>
  ),
  감동: ( // 연두 둘이 꼭 붙어 + 하트
    <>
      <circle cx="34" cy="58" r="22" fill="#c3d63d" />
      <circle cx="66" cy="58" r="22" fill="#aec92f" />
      <path {...face} d="M24 55 q4 5 8 0" />
      <path {...face} d="M36 55 q4 5 8 0" />
      <path {...face} d="M28 66 q5 5 10 0" />
      <path {...face} d="M56 55 q4 5 8 0" />
      <path {...face} d="M68 55 q4 5 8 0" />
      <path {...face} d="M62 66 q5 5 10 0" />
      <path d="M50 16 c-4 -9 -16 -5 -13 4 c2 6 13 11 13 11 c0 0 11 -5 13 -11 c3 -9 -9 -13 -13 -4 z" fill="#ec5f6a" />
    </>
  ),
  평온: ( // 분홍 알약이 — 가장 고요한 얼굴
    <>
      <rect x="10" y="30" width="80" height="46" rx="23" fill="#f2a7d2" />
      <path {...face} d="M30 48 q6 7 12 0" />
      <path {...face} d="M58 48 q6 7 12 0" />
      <path {...face} d="M40 60 q10 8 20 0" />
    </>
  ),
  그냥그래: ( // 파란 네모 — 무덤덤
    <>
      <rect x="16" y="20" width="68" height="64" rx="16" fill="#4d8ef0" />
      <path {...face} d="M32 48 h12" />
      <path {...face} d="M56 48 h12" />
      <path {...face} d="M40 66 h20" />
    </>
  ),
  피곤: ( // 주황 아치 — 꾸벅 잠든 얼굴
    <>
      <path {...mark} d="M76 12 h10 l-10 10 h10" />
      <path d="M16 84 V48 a34 34 0 0 1 68 0 V84 H62 V52 a12 12 0 0 0 -24 0 V84 Z" fill="#ef7d3b" />
      <path {...face} d="M32 30 q4 5 8 0" />
      <path {...face} d="M60 30 q4 5 8 0" />
      <path {...face} d="M46 38 q4 3 8 0" />
    </>
  ),
  불안: ( // 보라 몽글이 — 파르르
    <>
      <path {...mark} d="M8 40 q-5 6 0 12" />
      <path {...mark} d="M92 40 q5 6 0 12" />
      <ellipse cx="50" cy="54" rx="34" ry="30" fill="#a78bdb" />
      <path {...face} d="M32 42 l10 -4" />
      <path {...face} d="M68 42 l-10 -4" />
      {dot(36, 52)}{dot(64, 52)}
      <path {...face} d="M38 66 q6 -6 12 0 q6 6 12 0" />
    </>
  ),
  슬픔: ( // 하늘색 물방울 — 또르르 눈물
    <>
      <path d="M50 6 C36 28 20 42 20 62 a30 30 0 0 0 60 0 C80 42 64 28 50 6 Z" fill="#6aaede" />
      {dot(38, 60)}{dot(62, 60)}
      <path {...face} d="M42 74 q8 -7 16 0" />
      <path d="M68 56 q5 8 0 12 q-5 -4 0 -12 z" fill="#d6eaf8" />
    </>
  ),
  우울: ( // 초록 동그라미 — 머리 위 비구름
    <>
      <ellipse cx="50" cy="60" rx="32" ry="28" fill="#4ba05f" />
      <path {...face} d="M32 56 q5 6 10 0" />
      <path {...face} d="M58 56 q5 6 10 0" />
      <path {...face} d="M44 72 q6 -5 12 0" />
      <g fill="#b9c3cc">
        <circle cx="64" cy="14" r="7" />
        <circle cx="75" cy="10" r="8" />
        <circle cx="85" cy="15" r="6" />
        <rect x="62" y="13" width="28" height="8" rx="4" />
      </g>
      <path d="M70 28 l-3 8" stroke="#6aaede" strokeWidth="4.5" strokeLinecap="round" />
      <path d="M80 28 l-3 8" stroke="#6aaede" strokeWidth="4.5" strokeLinecap="round" />
    </>
  ),
  화남: ( // 주홍 가시돌이 — 잔뜩 찌푸림
    <>
      <polygon points="50,8 59.2,27.8 79.7,20.3 72.2,40.8 92,50 72.2,59.2 79.7,79.7 59.2,72.2 50,92 40.8,72.2 20.3,79.7 27.8,59.2 8,50 27.8,40.8 20.3,20.3 40.8,27.8"
        fill="#ec6a2f" stroke="#ec6a2f" strokeWidth="5" strokeLinejoin="round" />
      <path {...face} d="M34 44 l8 5 l-8 5" />
      <path {...face} d="M66 44 l-8 5 l8 5" />
      <path {...face} d="M43 62 h14" />
    </>
  ),
  모르겠음: ( // 청록 알약이 — 갸웃, 물음표
    <>
      <path d="M76 10 q1 -8 9 -8 q9 0 9 8 q0 6 -7 8 l0 5" stroke="var(--ink)" strokeWidth="4.5" strokeLinecap="round" fill="none" />
      <circle cx="87" cy="30" r="3" fill="var(--ink)" />
      <rect x="18" y="28" width="64" height="58" rx="28" fill="#38b2a3" />
      <path {...face} d="M56 42 q6 -5 12 0" />
      {dot(38, 54)}{dot(64, 51)}
      <path {...face} d="M42 68 q6 5 12 -2" />
    </>
  ),
};

export default function Emo({ name, size = '1.25em', style }) {
  const art = ART[name] || ART['모르겠음'];
  return (
    <svg viewBox="0 0 100 100" width={size} height={size}
      style={{ verticalAlign: '-0.28em', ...style }} aria-hidden="true">
      {art}
    </svg>
  );
}
