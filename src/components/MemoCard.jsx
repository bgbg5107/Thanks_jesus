import { useEffect, useRef, useState } from 'react';
import { photoUrl, supabase } from '../lib/supabase.js';
import { fmtKoDate, todayStr } from '../lib/util.js';
import { filesToData, uploadPhotos } from '../lib/offline.js';
import { bookName, getPassage, parseRef } from '../lib/bible.js';
import { toJpeg } from './ItemsEditor.jsx';
import Lightbox from './Lightbox.jsx';
import VersePicker from './VersePicker.jsx';
import { appAlert, appConfirm } from './Dialog.jsx';
import Icon from './Icon.jsx';
import Overlay from './Overlay.jsx';

// 오늘의 메모 — 하루 여러 장. 홈에는 제목 목록만, 열면 편집 화면(제목/부제목/본문).
// 본문: 굵게·형광펜·인용 + 말씀 담기(개역한글, 툴바 📖 또는 "요 3:16" 타이핑 인식) + 사진.
// 손을 멈추면 3초 후 자동 저장, 모두 비우면 조용히 삭제. 오프라인 초안은 localStorage 보관.

const HILITES = ['#ffe08a', '#c9f29b', '#ffc9dc', '#e3c8f8'];
const VQ_CLASSES = ['vq', 'vq-t', 'vq-r', 'vq-c2', 'vq-c3', 'vq-c4', 'vq-c5', 'vq-c6', 'vq-c7', 'vq-c8', 'vq-c9', 'vq-c10', 'vq-c11'];
const VQ_COLORS = ['', 'vq-c2', 'vq-c3', 'vq-c4', 'vq-c5', 'vq-c6', 'vq-c7', 'vq-c8', 'vq-c9', 'vq-c10', 'vq-c11'];

const stripHtml = (h) => (h || '').replace(/<[^>]*>/g, '');
const newMemo = (date) => ({ id: crypto.randomUUID(), date, title: '', subtitle: '', content: '', photos: [] });
const isEmptyMemo = (m) => !m.title.trim() && !m.subtitle.trim() && !stripHtml(m.content).trim() && !m.photos.length;

// 내가 쓴 서식만 남기고 정리 (굵게·기울임·형광펜·인용·말씀 블록)
function sanitize(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const ok = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'DIV', 'P', 'SPAN', 'BLOCKQUOTE', 'FONT', 'MARK', 'UL', 'OL', 'LI']);
  const walk = (node) => {
    [...node.children].forEach((el) => {
      walk(el);
      if (!ok.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      const bg = el.style?.backgroundColor;
      const fontSize = el.getAttribute('size');
      const cls = (el.getAttribute('class') || '').split(/\s+/)
        .filter((c) => VQ_CLASSES.includes(c)).join(' ');
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (bg) el.style.backgroundColor = bg;
      if (cls) el.setAttribute('class', cls);
      if (fontSize && el.tagName === 'FONT') el.setAttribute('size', fontSize);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export default function MemoCard({ uid }) {
  const date = todayStr();
  const draftKey = (id) => `memo-${uid}-${id}`;
  const [todays, setTodays] = useState([]);
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState(null);      // 타이핑 중 인식된 말씀 참조
  const [picker, setPicker] = useState(false); // 말씀 찾기 팝업
  const [history, setHistory] = useState(null);
  const [zoom, setZoom] = useState(null);
  const savedSnap = useRef('');
  const fromHistory = useRef(false);
  const openedId = useRef(null);
  const savedRange = useRef(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

  // 오늘 메모 로드 (서버 → 미전송 로컬 초안 병합)
  useEffect(() => {
    (async () => {
      let list = [];
      if (navigator.onLine) {
        const { data } = await supabase.from('memos')
          .select('id, date, title, subtitle, content, photos')
          .eq('user_id', uid).eq('date', date)
          .order('updated_at', { ascending: false });
        list = data || [];
      }
      for (let i = localStorage.length - 1; i >= 0; i -= 1) {
        const k = localStorage.key(i);
        if (!k?.startsWith(`memo-${uid}-`)) continue;
        try {
          const d = JSON.parse(localStorage.getItem(k));
          if (d?.id && d.date === date) {
            list = [d, ...list.filter((x) => x.id !== d.id)];
          } else if (d && !d.id && k === draftKey(date)) {
            // 하루 한 장이던 시절의 초안 — 새 형식으로 옮겨 담는다
            const m = { ...newMemo(date), title: d.title || '', subtitle: d.subtitle || '', content: d.content || '', photos: d.photos || [] };
            localStorage.setItem(draftKey(m.id), JSON.stringify(m));
            localStorage.removeItem(k);
            list = [m, ...list];
          }
        } catch { /* 조용히 넘어간다 */ }
      }
      setTodays(list);
    })();
  }, [uid, date]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 서버 저장 (모두 비어 있으면 조용히 삭제)
  async function persist(memo) {
    const snap = JSON.stringify(memo);
    const empty = isEmptyMemo(memo);
    if (memo.date === date) {
      setTodays((ts) => (empty ? ts.filter((t) => t.id !== memo.id) : [memo, ...ts.filter((t) => t.id !== memo.id)]));
    } else {
      setHistory((prev) => prev ? (empty ? prev.filter((h) => h.id !== memo.id) : prev.map((h) => h.id === memo.id ? memo : h)) : prev);
    }
    try {
      if (!navigator.onLine) throw new Error('offline');
      if (!empty) {
        const { error } = await supabase.from('memos').upsert({
          id: memo.id, user_id: uid, date: memo.date,
          title: memo.title, subtitle: memo.subtitle,
          content: sanitize(memo.content), photos: memo.photos,
          updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      } else {
        await supabase.from('memos').delete().eq('id', memo.id);
        localStorage.removeItem(draftKey(memo.id));
      }
      savedSnap.current = snap;
      localStorage.removeItem(draftKey(memo.id));
      setNote('자동으로 저장되었습니다.');
    } catch {
      setNote('연결이 닿는 대로 자동으로 저장해 드릴게요.');
    }
  }

  // 자동 저장 — 3초 호흡
  useEffect(() => {
    if (!editing) return undefined;
    const snap = JSON.stringify(editing);
    if (snap === savedSnap.current) return undefined;
    if (!isEmptyMemo(editing)) localStorage.setItem(draftKey(editing.id), snap);
    const t = setTimeout(() => persist(editing), 3000);
    return () => clearTimeout(t);
  }, [editing]);  // eslint-disable-line react-hooks/exhaustive-deps

  function openEditor(memo) {
    savedSnap.current = JSON.stringify(memo);
    setNote('');
    setHint(null);
    setEditing(memo);
  }

  // 첫 줄이 bare text/inline이면 <div>로 감싸기 (CSS :first-child 스타일 적용용)
  function wrapFirstLine(el) {
    if (!el || !el.childNodes.length) return;
    const first = el.childNodes[0];
    // 이미 블록 요소면 OK
    if (first.nodeType === 1 && /^(DIV|P|BLOCKQUOTE|UL|OL)$/i.test(first.tagName)) return;
    // 첫 번째 블록 태그 전까지의 노드들을 <div>로 감싼다
    const wrap = document.createElement('div');
    while (el.childNodes.length) {
      const n = el.childNodes[0];
      if (n.nodeType === 1 && /^(DIV|P|BLOCKQUOTE|UL|OL)$/i.test(n.tagName)) break;
      wrap.appendChild(n);
    }
    el.insertBefore(wrap, el.firstChild);
  }

  // 편집 화면이 열리면 본문을 채워 넣는다 (열 때 한 번만 — 커서 보호)
  useEffect(() => {
    if (!editing || openedId.current === editing.id) return;
    openedId.current = editing.id;
    if (bodyRef.current) {
      bodyRef.current.innerHTML = sanitize(editing.content);
      wrapFirstLine(bodyRef.current);
    }
  }, [editing]);

  function closeEditor() {
    const m = editing;
    setEditing(null);
    setPicker(false);
    setHint(null);
    openedId.current = null;
    fromHistory.current = false;
    if (m && JSON.stringify(m) !== savedSnap.current) persist(m); // 닫을 때 조용히 저장
  }

  async function deleteMemo() {
    const ok = await appConfirm('메모를 삭제하시겠습니까?');
    if (!ok) return;
    const id = editing.id;
    const wasHistory = fromHistory.current;
    setEditing(null);
    setPicker(false);
    setHint(null);
    openedId.current = null;
    fromHistory.current = false;
    if (wasHistory) {
      setHistory((prev) => prev ? prev.filter((h) => h.id !== id) : prev);
    } else {
      setTodays((ts) => ts.filter((t) => t.id !== id));
    }
    localStorage.removeItem(draftKey(id));
    try { await supabase.from('memos').delete().eq('id', id); } catch { /* 오프라인이면 조용히 */ }
  }

  async function deleteHistoryMemo(memo) {
    const ok = await appConfirm('메모를 삭제하시겠습니까?');
    if (!ok) return;
    setHistory((prev) => prev ? prev.filter((h) => h.id !== memo.id) : prev);
    localStorage.removeItem(draftKey(memo.id));
    try { await supabase.from('memos').delete().eq('id', memo.id); } catch { /* 오프라인이면 조용히 */ }
  }

  // ── 본문 편집 ──────────────────────────────────────────────
  function syncBody() {
    // 첫 줄이 bare text node면 <div>로 감싸서 :first-child 스타일 적용
    const el = bodyRef.current;
    if (el && el.childNodes.length) {
      const first = el.childNodes[0];
      if (!(first.nodeType === 1 && /^(DIV|P|BLOCKQUOTE|UL|OL)$/i.test(first.tagName)) && el.childNodes.length > 1) {
        const sel = window.getSelection();
        const savedRange = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        wrapFirstLine(el);
        if (savedRange) { try { sel.removeAllRanges(); sel.addRange(savedRange); } catch (_) { /* 커서 복원 실패 무시 */ } }
      }
    }
    setEditing((m) => (m ? { ...m, content: bodyRef.current?.innerHTML || '' } : m));
    detectHint();
  }

  function fmt(cmd, val) {
    bodyRef.current?.focus();
    document.execCommand(cmd, false, val);
    syncBody();
  }

  function clearFmt() {
    const el = bodyRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const node = sel.anchorNode;
      const block = node?.nodeType === 3 ? node.parentElement : node;
      // 말씀 블록(.vq) — 서식만 벗기고 텍스트는 유지
      const vq = block?.closest('.vq');
      if (vq && el.contains(vq)) {
        const text = vq.textContent || '';
        const div = document.createElement('div');
        div.textContent = text;
        vq.replaceWith(div);
        // 커서를 텍스트 끝으로
        const r = document.createRange();
        r.selectNodeContents(div);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        syncBody();
        return;
      }
      // 일반 blockquote·list 해제
      if (block?.closest('blockquote')) {
        document.execCommand('formatBlock', false, 'div');
      }
      if (block?.closest('ul')) document.execCommand('insertUnorderedList');
      else if (block?.closest('ol')) document.execCommand('insertOrderedList');
    }
    document.execCommand('removeFormat');
    syncBody();
  }

  // 백스페이스/Delete로 말씀 블록(.vq) 삭제 지원
  function handleBodyKeyDown(e) {
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    const block = node?.nodeType === 3 ? node.parentElement : node;
    // 커서가 .vq 안이면 블록 전체 삭제
    const vq = block?.closest('.vq');
    if (vq && bodyRef.current?.contains(vq)) {
      e.preventDefault();
      vq.remove();
      syncBody();
      return;
    }
    // 커서가 .vq 바로 뒤에 있을 때 Backspace
    if (e.key === 'Backspace' && r.collapsed && r.startOffset === 0) {
      const prev = block?.previousElementSibling;
      if (prev?.classList?.contains('vq')) {
        e.preventDefault();
        prev.remove();
        syncBody();
      }
    }
  }

  const FONT_SIZES = [2, 3, 4, 5, 6]; // execCommand fontSize 1-7, we use 2-6
  function changeFontSize(dir) {
    bodyRef.current?.focus();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    // 현재 fontSize 감지
    const node = sel.anchorNode;
    const el = node?.nodeType === 3 ? node.parentElement : node;
    const computed = el ? window.getComputedStyle(el).fontSize : '16px';
    const px = parseFloat(computed);
    // px → execCommand fontSize 매핑 (2=13px, 3=16px, 4=18px, 5=24px, 6=32px)
    const pxMap = [13, 16, 18, 24, 32];
    let idx = pxMap.findIndex((v) => px <= v + 1);
    if (idx < 0) idx = pxMap.length - 1;
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, idx + dir));
    document.execCommand('fontSize', false, String(FONT_SIZES[next]));
    syncBody();
  }

  // ── 말씀 담기 ──────────────────────────────────────────────
  // 커서 앞 글자에서 "요 3:16" 같은 참조를 알아본다 (탭해야만 삽입 — 조합 중 방해 없음)
  function detectHint() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) { setHint(null); return; }
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (!r.collapsed || node.nodeType !== 3 || !bodyRef.current?.contains(node)
      || node.parentElement?.closest('.vq')) { setHint(null); return; }
    const before = node.textContent.slice(0, r.startOffset).slice(-30);
    const ref = parseRef(before);
    if (ref && before.endsWith(ref.text)) {
      const refRange = document.createRange();
      refRange.setStart(node, r.startOffset - ref.text.length);
      refRange.setEnd(node, r.startOffset);
      const rect = refRange.getBoundingClientRect();
      const page = bodyRef.current?.closest('.memo-page');
      if (!page) { setHint(null); return; }
      const pageRect = page.getBoundingClientRect();
      const rawLeft = rect.left - pageRect.left;
      const pw = pageRect.width;
      setHint({
        ref, node, offset: r.startOffset,
        pos: {
          top: rect.bottom - pageRect.top + page.scrollTop + 6,
          left: Math.max(4, Math.min(rawLeft, pw - 200)),
        },
      });
    } else setHint(null);
  }

  // 말씀 블록을 range 위치에 삽입
  function insertPassage(range, passage) {
    const bq = document.createElement('blockquote');
    // 색은 무작위로 다양하게 — 단, 바로 앞 블록과는 겹치지 않게
    const last = [...(bodyRef.current?.querySelectorAll('.vq') || [])].pop();
    const lastColor = last ? (VQ_COLORS.find((c) => c && last.classList.contains(c)) || '') : null;
    const pool = VQ_COLORS.filter((c) => c !== lastColor);
    const color = pool[Math.floor(Math.random() * pool.length)];
    bq.className = color ? `vq ${color}` : 'vq';
    bq.setAttribute('contenteditable', 'false'); // 저장 시 sanitize가 속성을 걷어낸다
    const t = document.createElement('span');
    t.className = 'vq-t';
    t.textContent = passage.items.length > 1
      ? passage.items.map((i) => `${i.n} ${i.text}`).join(' ')
      : passage.items[0].text;
    const ref = document.createElement('span');
    ref.className = 'vq-r';
    ref.textContent = `${passage.label} (개역한글)`;
    bq.append(t, ref);
    range.deleteContents();
    range.insertNode(bq);
    const after = document.createElement('div');
    after.appendChild(document.createElement('br'));
    bq.after(after);
    const sel = window.getSelection();
    const nr = document.createRange();
    nr.setStart(after, 0);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
    bodyRef.current?.focus();
    syncBody();
  }

  async function applyHint() {
    const h = hint;
    setHint(null);
    let p = null;
    try { p = await getPassage(h.ref); } catch {
      appAlert('말씀을 아직 불러오지 못했어요.\n연결이 닿을 때 처음 한 번 내려받아 드릴게요.');
      return;
    }
    if (!p) { appAlert(`${bookName(h.ref.b)}에는 그 장·절이 없어요.\n번호를 한 번 확인해 주세요.`); return; }
    const range = document.createRange();
    range.setStart(h.node, h.offset - h.ref.text.length);
    range.setEnd(h.node, h.offset);
    insertPassage(range, p);
  }

  function openPicker() {
    const sel = window.getSelection();
    savedRange.current = sel?.rangeCount && bodyRef.current?.contains(sel.getRangeAt(0).startContainer)
      ? sel.getRangeAt(0).cloneRange() : null;
    setPicker(true);
  }

  function insertFromPicker(passage) {
    setPicker(false);
    let range = savedRange.current;
    if (!range || !bodyRef.current?.contains(range.startContainer)) {
      range = document.createRange();
      range.selectNodeContents(bodyRef.current);
      range.collapse(false);
    }
    insertPassage(range, passage);
  }

  // ── 사진 ──────────────────────────────────────────────────
  async function pickPhotos(e) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    if (!navigator.onLine) { appAlert('사진은 연결이 닿을 때 담을 수 있어요.\n잠시 후 다시 시도해 주세요.'); return; }
    try {
      const conv = [];
      for (const f of files) conv.push(await toJpeg(f));
      const paths = await uploadPhotos(uid, await filesToData(conv));
      setEditing((m) => ({ ...m, photos: [...m.photos, ...paths] }));
    } catch {
      appAlert('사진을 담지 못했습니다.\n잠시 후 다시 시도해 주세요.');
    }
  }

  // ── 지난 메모 ─────────────────────────────────────────────
  async function openHistory() {
    if (!navigator.onLine) { appAlert('지난 메모는 연결이 닿을 때 볼 수 있어요.'); return; }
    const { data } = await supabase.from('memos')
      .select('id, date, title, subtitle, content, photos')
      .eq('user_id', uid).neq('date', date)
      .order('date', { ascending: false }).order('updated_at', { ascending: false })
      .limit(90);
    setHistory(data || []);
  }

  const firstLine = (html) => {
    if (!html) return '';
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<(div|p|li|blockquote)[^>]*>/gi, '\n')
      .replace(/<\/(div|p|li|blockquote)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .trim();
    return text.split('\n').find((l) => l.trim())?.trim() || '';
  };
  const rowTitle = (m) => firstLine(m.content) || m.title.trim() || '(제목 없음)';

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
        <p className="home-title">📝 오늘의 메모</p>
        <button className="likebtn" onClick={openHistory}>지난 메모 <Icon name="chevronRight" size={14} /></button>
      </div>

      <section className="accent-card sky fade-in" style={{ padding: 20 }}>
        {todays.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <p style={{ margin: '0 0 14px', color: 'color-mix(in srgb, var(--accent-ink) 70%, transparent)' }}>
              <>말씀 노트, 마음에 남은 생각…<br/> 무엇이든 적어 두세요 😊</>
            </p>
            <button className="btn small soft" onClick={() => openEditor(newMemo(date))}>기록하기</button>
          </div>
        ) : (
          <>
            <div className="rows memo-list">
              {todays.map((m) => (
                <button className="row memo-row" key={m.id} onClick={() => openEditor(m)}>
                  <div className="main">
                    <div className="memo-row-title">{rowTitle(m)}</div>
                  </div>
                  <span className="tiny"><Icon name="chevronRight" size={14} /></span>
                </button>
              ))}
            </div>
            <button className="btn subtle small memo-add" onClick={() => openEditor(newMemo(date))}>+ 새 메모</button>
          </>
        )}
      </section>

      {/* 편집 화면 — 전체 화면 종이 한 장 (아이폰 메모장처럼, 첫 줄이 제목이 된다) */}
      {editing && (
        <Overlay className="sheet" label="메모 쓰기" onClose={closeEditor}>
          <div className="memo-sheet" onClick={(e) => e.stopPropagation()}>
            <header className="memo-top">
              <button type="button" className="memo-back" onClick={closeEditor}>
                <Icon name="chevronLeft" size={18} /> {fromHistory.current ? '목록으로' : '메모'}
              </button>
              {note && <span className="tiny fade-in">{note}</span>}
              <button type="button" className="memo-delete" aria-label="메모 삭제" onClick={deleteMemo}>
                <Icon name="trash" size={18} />
              </button>
            </header>
            <div className="memo-page" onClick={(e) => { if (e.target.classList.contains('memo-page')) bodyRef.current?.focus(); }}>
              <p className="memo-date">{fmtKoDate(editing.date)}</p>
              <div className="memo-body" contentEditable suppressContentEditableWarning spellCheck={false}
                ref={bodyRef} data-ph={'첫 줄은 목록에서 제목처럼 보여요.\n"요 3:16"처럼 적으면 말씀을 찾아 드려요.(개역한글)'}
                onInput={syncBody} onKeyDown={handleBodyKeyDown} onKeyUp={detectHint} onClick={detectHint} />

              {hint && (
                <button className="memo-hint" style={{ top: hint.pos.top, left: hint.pos.left }} onClick={applyHint}>
                  <Icon name="book" size={14} /> {bookName(hint.ref.b)} {hint.ref.c}:{hint.ref.v1}{hint.ref.v2 !== hint.ref.v1 ? `-${hint.ref.v2}` : ''} 말씀 담기
                </button>
              )}

              {editing.photos.length > 0 && (
                <div className="photos" style={{ marginTop: 12 }}>
                  {editing.photos.map((p) => (
                    <div className="ph" key={p}>
                      <img src={photoUrl(p)} alt="" onClick={() => setZoom(photoUrl(p))} />
                      <button aria-label="사진 지우기" onClick={() => setEditing((m) => ({ ...m, photos: m.photos.filter((x) => x !== p) }))}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="memo-tools">
              <button type="button" className="tb" title="굵게" aria-label="굵게"
                onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('bold')}><b>가</b></button>
              <button type="button" className="tb" title="글자 작게" aria-label="글자 작게"
                onMouseDown={(e) => e.preventDefault()} onClick={() => changeFontSize(-1)}><Icon name="fontSizeDown" size={17} /></button>
              <button type="button" className="tb" title="글자 크게" aria-label="글자 크게"
                onMouseDown={(e) => e.preventDefault()} onClick={() => changeFontSize(1)}><Icon name="fontSizeUp" size={17} /></button>
              <button type="button" className="tb" title="글머리 기호" aria-label="글머리 기호"
                onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('insertUnorderedList')}><Icon name="list" size={17} /></button>
              <button type="button" className="tb" title="인용" aria-label="인용"
                onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('formatBlock', 'blockquote')}>❝</button>
              <button type="button" className="tb" title="말씀 담기" aria-label="말씀 담기"
                onMouseDown={(e) => e.preventDefault()} onClick={openPicker}><Icon name="book" size={17} /></button>
              <button type="button" className="tb small-label" title="서식 지우기" aria-label="서식 지우기"
                onMouseDown={(e) => e.preventDefault()} onClick={clearFmt}>지움</button>
              <span className="sp" />
              {HILITES.map((c) => (
                <button key={c} type="button" className="hl" title="형광펜" aria-label="형광펜"
                  style={{ background: c }}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => fmt('hiliteColor', c)} />
              ))}
              <span className="sp" />
              <button type="button" className="tb" title="사진 담기" aria-label="사진 담기" onClick={() => fileRef.current?.click()}><Icon name="camera" size={17} /></button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickPhotos} />
          </div>
        </Overlay>
      )}

      {picker && <VersePicker onInsert={insertFromPicker} onClose={() => setPicker(false)} />}

      {/* 지난 메모 목록 */}
      {history && !editing && (
        <Overlay label="지난 메모" onClose={() => setHistory(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 600, marginTop: 0 }}>지난 메모</h3>
            {history.length === 0 && <p className="muted">아직 지난 메모가 없습니다.</p>}
            <div className="rows">
              {history.map((h) => (
                <div className="row memo-row" key={h.id}>
                  <div className="memo-row-main" role="button" tabIndex={0}
                    onClick={() => { fromHistory.current = true; openEditor(h); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { fromHistory.current = true; openEditor(h); } }}>
                    <span className="pill pill-date">{fmtKoDate(h.date)}</span>
                    <span className="memo-row-title">{rowTitle(h)}</span>
                  </div>
                  <button className="memo-hist-del" aria-label="메모 삭제"
                    onClick={() => deleteHistoryMemo(h)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              ))}
            </div>
            <div className="spacer" />
            <button className="btn subtle small" onClick={() => setHistory(null)}>닫기</button>
          </div>
        </Overlay>
      )}

      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
