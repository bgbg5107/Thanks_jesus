import { useEffect, useRef, useState } from 'react';
import { loadBible, parseRef, getPassage } from '../lib/bible.js';
import Overlay from './Overlay.jsx';

// 말씀 찾기 — 참조(예: 요 3:16)를 입력하면 개역한글 구절을 미리 보여주고,
// '본문에 담기'로 메모에 삽입한다. 전권은 처음 한 번 내려받아 오프라인 보관.

export default function VersePicker({ onInsert, onClose }) {
  const [q, setQ] = useState('');
  const [passage, setPassage] = useState(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    loadBible().then(() => setReady(true)).catch(() => setFailed(true));
    inputRef.current?.focus();
  }, []);

  const ref = parseRef(q);
  useEffect(() => {
    if (!ref || !ready) { setPassage(null); return; }
    let on = true;
    getPassage(ref).then((p) => { if (on) setPassage(p); }).catch(() => { if (on) setPassage(null); });
    return () => { on = false; };
  }, [q, ready]);  // eslint-disable-line react-hooks/exhaustive-deps

  let guide = '';
  if (failed) guide = '말씀을 불러오지 못했습니다. 연결이 닿을 때 다시 열어 주세요.';
  else if (!ready) guide = '말씀을 준비하고 있어요. 처음 한 번만 잠시 걸립니다…';
  else if (!q.trim()) guide = '책 이름과 장·절을 함께 적어 주세요.';
  else if (!ref) guide = '아직 알아듣지 못했어요. 예) 요 3:16';
  else if (!passage) guide = '구절을 찾지 못했어요. 장·절 번호를 한 번 확인해 주세요.';

  return (
    <Overlay label="말씀 찾기" onClose={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontWeight: 600, marginTop: 0 }}>말씀 찾기</h3>
        <input
          ref={inputRef} type="text" value={q} spellCheck={false} aria-label="말씀 참조 입력"
          placeholder="예) 요 3:16 · 시 23:1-3 · 요한복음 3장 16절"
          onChange={(e) => setQ(e.target.value)}
        />
        {passage ? (
          <blockquote className="vq" style={{ marginTop: 14 }}>
            <span className="vq-t">
              {passage.items.length > 1
                ? passage.items.map((i) => `${i.n} ${i.text}`).join(' ')
                : passage.items[0].text}
            </span>
            <span className="vq-r">{passage.label} (개역한글)</span>
          </blockquote>
        ) : (
          <p className="muted" style={{ marginTop: 14 }}>{guide}</p>
        )}
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn subtle small" onClick={onClose}>닫기</button>
          <button className="btn small" disabled={!passage} onClick={() => passage && onInsert(passage)}>
            본문에 담기
          </button>
        </div>
      </div>
    </Overlay>
  );
}
