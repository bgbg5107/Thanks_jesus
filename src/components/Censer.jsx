/* 금향로 — 감사가 향처럼 담기는 그릇 (계 5:8).
   저장 완료 팝업에서 하트가 떨어져 쌓이는 연출. count = 전체 누적 기록 수.
   금색·하트는 일러스트 고유색(테마 무관), 향 연기만 은은한 고정 회색. */

// 그릇 위로 소복이 쌓이는 자리 (아래 줄부터 채움, 최대 22개 표시)
const SLOTS = [];
[[72, 7], [62, 6], [52, 5], [43, 3], [35, 1]].forEach(([y, n]) => {
  for (let i = 0; i < n; i++) SLOTS.push({ x: 100 - (n - 1) * 6.7 + i * 13.4, y });
});

const ROSE = ['#ec5f6a', '#e8836f', '#d96b8a', '#e26060'];
const HEART = 'M0 -3 C -3 -9 -12 -6 -10 1 C -8.5 5.5 0 9 0 9 C 0 9 8.5 5.5 10 1 C 12 -6 3 -9 0 -3 Z';

const jitter = (i) => {
  const h = (i * 2654435761) >>> 0;
  return { dx: ((h >> 2) % 5) - 2, rot: ((h >> 4) % 36) - 18 };
};

export default function Censer({ count }) {
  const n = Math.max(1, count || 1);
  const filled = Math.min(n, SLOTS.length);

  return (
    <svg className="censer" viewBox="0 0 200 150" width="200" height="150" aria-hidden="true">
      <defs>
        <linearGradient id="censerGold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9ae52" />
          <stop offset="1" stopColor="#9c7226" />
        </linearGradient>
      </defs>

      {/* 향 연기 */}
      <path className="smoke" d="M64 56 q-6 -8 0 -14 q6 -6 2 -12" stroke="#b4ac9c" strokeWidth="3" strokeLinecap="round" fill="none" />
      <path className="smoke" style={{ animationDelay: '1.8s' }} d="M136 60 q6 -8 0 -14 q-6 -6 -2 -12" stroke="#b4ac9c" strokeWidth="3" strokeLinecap="round" fill="none" />

      {/* 그릇 몸통 */}
      <path d="M46 76 C 48 104, 70 120, 100 120 C 130 120, 152 104, 154 76 Z" fill="url(#censerGold)" />
      <path d="M56 96 Q 100 108 144 96" stroke="#8a6420" strokeWidth="3" fill="none" opacity="0.5" />
      <path d="M92 119 L108 119 L112 132 L88 132 Z" fill="#b8893a" />
      <ellipse cx="100" cy="136" rx="24" ry="6" fill="#9c7226" />
      <ellipse cx="100" cy="134" rx="24" ry="6" fill="#c99a3f" />

      {/* 그릇 속 */}
      <ellipse cx="100" cy="76" rx="46" ry="7.5" fill="#6e4f1c" />

      {/* 쌓인 하트들 — 마지막 하나는 위에서 떨어진다 */}
      {SLOTS.slice(0, filled).map((s, i) => {
        const { dx, rot } = jitter(n - filled + i);
        const isNew = i === filled - 1;
        const heart = (
          <path d={HEART} transform={`rotate(${rot}) scale(0.62)`} fill={ROSE[(n - filled + i) % ROSE.length]} />
        );
        return (
          <g key={i} transform={`translate(${s.x + dx} ${s.y})`}>
            {isNew ? <g className="drop">{heart}</g> : heart}
          </g>
        );
      })}

      {/* 그릇 앞테 — 아랫줄 하트가 그릇에 담겨 보이게 */}
      <path d="M46 76 a54 10 0 0 0 108 0 a54 10 0 0 1 -108 0 z" fill="#cf9d45" />
    </svg>
  );
}
