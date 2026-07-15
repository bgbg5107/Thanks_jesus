import { useEffect, useState } from 'react';
import { BOOKS, bookName, loadBible, parseRef, getPassage, recentVerses, refLabel } from '../lib/bible.js';
import Overlay from './Overlay.jsx';

// 말씀 찾기 — 참조를 적어도 되고(예: 요 3:16), 책→장→절을 차례로 짚어 골라도 된다.
// 최근에 담았던 구절은 바로 다시 담을 수 있다. 전권은 처음 한 번 내려받아 오프라인 보관.

export default function VersePicker({ onInsert, onClose }) {
  const [q, setQ] = useState('');
  const [bible, setBible] = useState(null);
  const [failed, setFailed] = useState(false);
  const [sel, setSel] = useState({ b: null, c: null, v1: null, v2: null });
  const [passage, setPassage] = useState(null);
  const [recents] = useState(recentVerses);

  useEffect(() => {
    loadBible().then(setBible).catch(() => setFailed(true));
  }, []);

  // 타이핑한 참조가 우선, 없으면 짚어 고른 범위
  const typedRef = q.trim() ? parseRef(q) : null;
  const selRef = !q.trim() && sel.b && sel.c && sel.v1
    ? { b: sel.b, c: sel.c, v1: sel.v1, v2: sel.v2 || sel.v1 } : null;
  const eref = typedRef || selRef;
  const erefKey = eref ? `${eref.b}:${eref.c}:${eref.v1}:${eref.v2}` : '';

  useEffect(() => {
    if (!eref || !bible) { setPassage(null); return undefined; }
    let on = true;
    getPassage(eref).then((p) => { if (on) setPassage(p); }).catch(() => { if (on) setPassage(null); });
    return () => { on = false; };
  }, [erefKey, bible]);  // eslint-disable-line react-hooks/exhaustive-deps

  function tapVerse(n) {
    setSel((s) => {
      if (!s.v1 || s.v2 || n < s.v1) return { ...s, v1: n, v2: null }; // 새 시작 절
      if (n === s.v1) return s;                                        // 같은 절 — 그대로
      return { ...s, v2: n };                                          // 끝 절까지 함께
    });
  }

  const chapters = bible && sel.b ? bible[sel.b - 1].length : 0;
  const verses = bible && sel.b && sel.c ? bible[sel.b - 1][sel.c - 1].length : 0;
  const inRange = (n) => sel.v1 && n >= sel.v1 && n <= (sel.v2 || sel.v1);

  let guide = '';
  if (failed) guide = '말씀을 불러오지 못했습니다.\n연결이 닿을 때 다시 열어 주세요.';
  else if (!bible) guide = '말씀을 준비하고 있어요. 처음 한 번만 잠시 걸립니다…';
  else if (q.trim() && !typedRef) guide = '아직 알아듣지 못했어요. 예) 요 3:16';
  else if (eref && !passage) guide = '구절을 찾지 못했어요. 장·절 번호를 한 번 확인해 주세요.';

  return (
    <Overlay label="말씀 찾기" onClose={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontWeight: 600, marginTop: 0 }}>말씀 찾기</h3>
        <input
          type="text" value={q} spellCheck={false} aria-label="말씀 참조 입력"
          className="vp-input" placeholder="예) 요 3:16"
          onChange={(e) => setQ(e.target.value)}
        />

        {guide && <p className="muted" style={{ marginTop: 14, whiteSpace: 'pre-line' }}>{guide}</p>}

        {/* 책 → 장 → 절 짚어 고르기 (타이핑하지 않을 때) */}
        {bible && !q.trim() && (
          <>
            {recents.length > 0 && !sel.b && (
              <>
                <p className="vp-label">최근 담은 말씀</p>
                <div className="vp-recent">
                  {recents.map((r) => (
                    <button key={refLabel(r)} type="button" className="vp-chip"
                      onClick={() => setSel({ b: r.b, c: r.c, v1: r.v1, v2: r.v2 })}>
                      {refLabel(r)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {sel.b && (
              <div className="vp-crumb">
                <button type="button" onClick={() => setSel({ b: null, c: null, v1: null, v2: null })}>
                  {bookName(sel.b)}
                </button>
                {sel.c && (
                  <>
                    <span aria-hidden="true">›</span>
                    <button type="button" onClick={() => setSel((s) => ({ ...s, c: null, v1: null, v2: null }))}>
                      {sel.c}장
                    </button>
                  </>
                )}
              </div>
            )}

            {!sel.b && (
              <div className="vp-scroll">
                <p className="vp-label">구약</p>
                <div className="vp-grid">
                  {BOOKS.slice(0, 39).map((names, i) => (
                    <button key={names[0]} type="button" onClick={() => setSel({ b: i + 1, c: null, v1: null, v2: null })}>
                      {names[0]}
                    </button>
                  ))}
                </div>
                <p className="vp-label">신약</p>
                <div className="vp-grid">
                  {BOOKS.slice(39).map((names, i) => (
                    <button key={names[0]} type="button" onClick={() => setSel({ b: i + 40, c: null, v1: null, v2: null })}>
                      {names[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sel.b && !sel.c && (
              <div className="vp-scroll">
                <div className="vp-grid nums">
                  {Array.from({ length: chapters }, (_, i) => (
                    <button key={i} type="button" onClick={() => setSel((s) => ({ ...s, c: i + 1, v1: null, v2: null }))}>
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sel.b && sel.c && (
              <>
                <p className="vp-label">시작 절을 짚고, 이어서 끝 절을 짚으면 함께 담겨요.</p>
                <div className="vp-scroll">
                  <div className="vp-grid nums">
                    {Array.from({ length: verses }, (_, i) => (
                      <button key={i} type="button" className={inRange(i + 1) ? 'on' : ''} onClick={() => tapVerse(i + 1)}>
                        {i + 1}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {passage && (
          <blockquote className="vq" style={{ marginTop: 14 }}>
            <span className="vq-t">
              {passage.items.length > 1
                ? passage.items.map((i) => `${i.n} ${i.text}`).join(' ')
                : passage.items[0].text}
            </span>
            <span className="vq-r">{passage.label} (개역한글)</span>
          </blockquote>
        )}

        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn subtle small" onClick={onClose}>닫기</button>
          <button className="btn small" disabled={!passage} onClick={() => passage && onInsert(passage, eref)}>
            본문에 담기
          </button>
        </div>
      </div>
    </Overlay>
  );
}
