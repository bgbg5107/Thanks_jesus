// 공용 라인 아이콘 — 홈 벨·하단 탭과 같은 스트로크 톤 (1.8, currentColor).
// 이모지 대신 기능 아이콘으로 사용해 기기·테마와 무관하게 같은 모양을 유지한다.
const PATHS = {
  camera: (
    <>
      <path d="M14.5 4h-5L7.7 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.7L14.5 4Z" />
      <circle cx="12" cy="13" r="3.4" />
    </>
  ),
  x: <path d="M18 6 6 18M6 6l12 12" />,
  plus: <path d="M12 5v14M5 12h14" />,
  heart: <path d="M19.8 4.6a5.5 5.5 0 0 0-7.8 0L12 4.7l-.1-.1a5.5 5.5 0 1 0-7.7 7.8l7.8 7.8 7.8-7.8a5.5 5.5 0 0 0 0-7.8Z" />,
  check: <path d="M20 6 9 17l-5-5" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m18 15-6-6-6 6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  fontSizeUp: (
    <>
      <text x="3" y="17" fontSize="14" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">A</text>
      <line x1="18" y1="7" x2="18" y2="17" />
      <line x1="13" y1="12" x2="23" y2="12" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </>
  ),
  fontSizeDown: (
    <>
      <text x="3" y="17" fontSize="14" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">A</text>
      <line x1="13" y1="12" x2="23" y2="12" />
    </>
  ),
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />,
  users: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <circle cx="19" cy="9" r="2.5" />
      <path d="M22 21v-1.5a3 3 0 0 0-2.5-2.96" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="m22 2-11 13" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18" />
      <path d="M10.7 5.9c.4-.1.9-.1 1.3-.1 6 0 9.5 6.2 9.5 6.2a17.6 17.6 0 0 1-3 3.7M6.3 6.5A17 17 0 0 0 2.5 12S6 18.2 12 18.2c1.4 0 2.7-.3 3.9-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </>
  ),
  edit: (
    <>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
    </>
  ),
};

export default function Icon({ name, size = 16, filled = false, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0, ...style }}>
      {PATHS[name]}
    </svg>
  );
}
