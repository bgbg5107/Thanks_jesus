import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { photoUrl, supabase } from '../lib/supabase.js';
import { EMOTIONS, randomVerse, todayStr, verseOfDay } from '../lib/util.js';
import Emo from '../components/Emo.jsx';
import Avatar from '../components/Avatar.jsx';
import { filesToData, getPendingForDate, removePending, savePending, uploadPhotos } from '../lib/offline.js';
import ItemsEditor, { emptyItem, snapItems, toEditItems, toJpeg } from '../components/ItemsEditor.jsx';
import Lightbox from '../components/Lightbox.jsx';
import Censer from '../components/Censer.jsx';
import MemoCard from '../components/MemoCard.jsx';
import { appAlert, appConfirm } from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import Overlay from '../components/Overlay.jsx';

const WD_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

// 빈 기록 하나 생성
function blankEntry() {
  return {
    _tempId: crypto.randomUUID(),
    id: null,
    items: [emptyItem()],
    emotion: '',
    photos: [],
    visibility: 'private',
    teamIds: [],
    sharedUsers: [],
    saved: false,         // 서버에 한 번이라도 저장된 적 있는지
  };
}

// 기록 데이터에서 스냅샷 문자열 생성
function makeSnap(e) {
  return JSON.stringify({
    items: snapItems(e.items), emotion: e.emotion, visibility: e.visibility,
    teamIds: e.teamIds, su: (e.sharedUsers || []).map((u) => u.id), photos: e.photos,
  });
}

export default function Home() {
  const { session, profile, online, teams, unread } = useApp();
  const uid = session.user.id;
  const date = todayStr();
  const navigate = useNavigate();

  const [verses, setVerses] = useState(() => JSON.parse(localStorage.getItem('verses') || '[]'));
  // 다중 기록 상태
  const [entries, setEntries] = useState([]);      // 오늘의 기록 배열
  const [activeIdx, setActiveIdx] = useState(0);    // 현재 활성(편집 중) 기록 인덱스
  const [popupVerse, setPopupVerse] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [savedNoteFading, setSavedNoteFading] = useState(false);
  const [composing, setComposing] = useState(false);
  const [weekDone, setWeekDone] = useState(new Set());
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [emoOpen, setEmoOpen] = useState(false);
  const focusRef = useRef(null);
  const scrollRef = useRef(null);
  const lastSaved = useRef(new Map());   // tempId → 스냅샷 문자열

  // 활성 기록에 대한 편의 접근자
  const active = entries[activeIdx] || null;

  // entries 배열의 특정 인덱스 업데이트 헬퍼
  const updateEntry = useCallback((idx, patch) => {
    setEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...patch } : e));
  }, []);
  const updateActive = useCallback((patch) => {
    setEntries((prev) => prev.map((e, i) => i === activeIdx ? { ...e, ...patch } : e));
  }, [activeIdx]);

  // 이번 주(월~일) 날짜들
  const week = (() => {
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  })();

  // 말씀 로드 (오프라인 대비 로컬 캐시)
  useEffect(() => {
    if (!online) return;
    supabase.from('verses').select('*').then(({ data }) => {
      if (data?.length) {
        setVerses(data);
        localStorage.setItem('verses', JSON.stringify(data));
      }
    });
  }, [online]);

  // 오늘 기록 로드 (서버 → 로컬 대기분 병합)
  const load = useCallback(async () => {
    let serverEntries = [];
    if (online) {
      const { data } = await supabase.from('entries').select('*')
        .eq('user_id', uid).eq('date', date).order('created_at');
      serverEntries = data || [];
    }
    const pendingEntries = await getPendingForDate(date);

    // 서버 기록을 편집용으로 변환
    const loaded = [];
    for (const src of serverEntries) {
      const its = toEditItems(src.contents);
      let su = [];
      if (src.shared_user_ids?.length) {
        const { data: us } = await supabase.from('profiles').select('id, display_id').in('id', src.shared_user_ids);
        su = us || [];
      }
      let uiVis = src.visibility || 'private';
      if (uiVis === 'team') {
        const hasCell = (src.shared_team_ids || []).some((id) => teams.find((t) => t.id === id)?.kind === 'cell');
        uiVis = hasCell ? 'cell' : 'group';
      }
      loaded.push({
        _tempId: src.id,  // 서버 기록은 id를 tempId로도 사용
        id: src.id,
        items: its,
        emotion: src.emotion || '',
        photos: src.photos || [],
        visibility: uiVis,
        teamIds: src.shared_team_ids || [],
        sharedUsers: su,
        saved: true,
      });
    }

    // pending 기록 병합 (서버에 없는 것만 추가)
    for (const p of pendingEntries) {
      const exists = loaded.find((e) => e.id && e.id === p.id);
      if (!exists) {
        loaded.push({
          _tempId: p._tempId,
          id: p.id || null,
          items: toEditItems(p.contents),
          emotion: p.emotion || '',
          photos: p.photos || [],
          visibility: p.visibility || 'private',
          teamIds: p.shared_team_ids || [],
          sharedUsers: [],
          saved: !!p.id,
        });
      }
    }

    if (loaded.length) {
      setEntries(loaded);
      setComposing(true);
      // 스냅샷 초기화
      const snaps = new Map();
      loaded.forEach((e) => snaps.set(e._tempId, makeSnap(e)));
      lastSaved.current = snaps;
    } else {
      setEntries([]);
      setComposing(false);
    }
  }, [uid, date, online, teams]);

  useEffect(() => {
    load();
    const onSync = () => load();
    window.addEventListener('synced', onSync);
    return () => window.removeEventListener('synced', onSync);
  }, [load]);

  // 이번 주 기록 현황 (주간 스트립 표시용 — 서버 + 오프라인 대기분)
  useEffect(() => {
    (async () => {
      const from = todayStr(week[0]);
      const to = todayStr(week[6]);
      const done = new Set();
      if (online) {
        const { data } = await supabase.from('entries').select('date')
          .eq('user_id', uid).gte('date', from).lte('date', to);
        (data || []).forEach((r) => done.add(r.date));
      }
      const allPending = await getPendingForDate(date);
      allPending.forEach((d) => { if (d.date >= from && d.date <= to) done.add(d.date); });
      // 현재 편집 중인 기록 중 저장된 것도 반영
      entries.forEach((e) => { if (e.saved) done.add(date); });
      setWeekDone(done);
    })();
  }, [online, uid, entries.length, entries.filter(e => e.saved).length]);  // eslint-disable-line react-hooks/exhaustive-deps

  // 이름으로 공유 대상 검색
  useEffect(() => {
    if (!userQuery.trim() || !online) { setUserResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, display_id')
        .ilike('display_id', `%${userQuery.trim()}%`).neq('id', uid).limit(8);
      setUserResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery, uid, online]);

  // 특정 기록을 저장
  async function doSave(idx, silent) {
    const entry = entries[idx];
    if (!entry) return false;
    const cleaned = entry.items.filter((x) => x.text.trim() || x.photos.length || x.newFiles.length);
    if (!cleaned.length) { if (!silent) appAlert('감사한 일을 한 가지라도 적어 주세요.'); return false; }
    if (!entry.emotion) { if (!silent) { setEmoOpen(true); appAlert('오늘의 마음을 하나 골라 주세요.'); } return false; }
    const isTeamMode = entry.visibility === 'cell' || entry.visibility === 'group';
    const kindIds = isTeamMode
      ? entry.teamIds.filter((id) => teams.find((t) => t.id === id)?.kind === entry.visibility)
      : [];
    if (isTeamMode && !kindIds.length) {
      if (!silent) appAlert(entry.visibility === 'cell' ? '셀을 하나 이상 골라 주세요.' : '나눔 공동체를 하나 이상 골라 주세요.');
      return false;
    }
    setSaving(true);
    const base = {
      date, emotion: entry.emotion, photos: entry.photos,
      visibility: isTeamMode ? 'team' : entry.visibility,
      shared_team_ids: kindIds,
      shared_user_ids: entry.visibility === 'users' ? entry.sharedUsers.map((u) => u.id) : [],
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      const newItems = [];
      for (const x of cleaned) {
        const paths = x.newFiles.length ? await uploadPhotos(uid, await filesToData(x.newFiles)) : [];
        newItems.push({ text: x.text.trim(), photos: [...x.photos, ...paths], newFiles: [] });
      }
      const contents = newItems.map((x) => ({ text: x.text, photos: x.photos }));
      const row = {
        user_id: uid, ...base, contents,
        updated_at: new Date().toISOString(),
      };
      let resultId = entry.id;
      if (entry.id) {
        // 기존 기록 수정
        const { error } = await supabase.from('entries').update(row).eq('id', entry.id);
        if (error) throw error;
      } else {
        // 신규 기록 삽입
        const { data: inserted, error } = await supabase.from('entries').insert(row).select('id').single();
        if (error) throw error;
        resultId = inserted.id;
      }
      await removePending(entry._tempId);
      updateEntry(idx, { items: newItems, saved: true, id: resultId, _tempId: resultId });
      setSavedNote(silent ? '자동으로 저장되었습니다.' : '오늘의 감사가 담겼습니다.');
      lastSaved.current.set(resultId, makeSnap({ ...entry, items: newItems }));
    } catch {
      const contents = cleaned.map((x) => ({ text: x.text.trim(), photos: x.photos }));
      const itemPhotosData = [];
      for (let i = 0; i < cleaned.length; i++) {
        for (const d of await filesToData(cleaned[i].newFiles)) itemPhotosData.push({ i, ...d });
      }
      await savePending({ _tempId: entry._tempId, id: entry.id, ...base, contents, itemPhotosData });
      setSavedNote('연결이 닿는 대로 자동으로 저장해 드릴게요.');
      updateEntry(idx, { saved: true });
      lastSaved.current.set(entry._tempId, makeSnap(entry));
    }
    setSaving(false);
    return true;
  }

  async function save() {
    const first = entries.length === 0 || (entries.length === 1 && !entries[0].saved);
    const ok = await doSave(activeIdx, false);
    if (ok) { setComposing(false); }
    if (ok && first) {
      let total = null;
      try {
        if (navigator.onLine) {
          const { count } = await supabase.from('entries')
            .select('*', { count: 'exact', head: true }).eq('user_id', uid);
          total = count;
        }
      } catch { /* 조용히 넘어간다 */ }
      const v = randomVerse(verses);
      setPopupVerse({ ...(v || {}), total });
    }
  }

  // 특정 기록이 비었는지 확인
  function isEntryEmpty(entry) {
    return entry.items.every((x) => !x.text.trim() && !x.photos.length && !x.newFiles.length) && !entry.photos.length;
  }

  // 특정 기록 삭제
  async function removeEntry(idx) {
    const entry = entries[idx];
    if (!entry) return;
    if (entry.id && navigator.onLine) {
      try {
        const { error } = await supabase.from('entries').delete().eq('id', entry.id);
        if (error) throw error;
      } catch { return; }
    }
    await removePending(entry._tempId);
    lastSaved.current.delete(entry._tempId);
    const next = entries.filter((_, i) => i !== idx);
    setEntries(next);
    if (next.length === 0) {
      setComposing(false);
      setSavedNoteFading(false);
      setSavedNote('오늘의 기록을 비웠습니다.\n마음이 닿는 순간, 언제든 다시 담아 주세요.');
      setTimeout(() => setSavedNoteFading(true), 2400);
      setTimeout(() => { setSavedNote(''); setSavedNoteFading(false); }, 3000);
    } else {
      setActiveIdx(Math.min(idx, next.length - 1));
    }
  }

  // 자동 저장 (3초 후)
  useEffect(() => {
    if (!active || !active.saved || saving) return;
    const snap = makeSnap(active);
    if (snap === (lastSaved.current.get(active._tempId) || '')) return;
    const t = setTimeout(() => {
      if (isEntryEmpty(active)) removeEntry(activeIdx);
      else doSave(activeIdx, true);
    }, 3000);
    return () => clearTimeout(t);
  }); // 매 렌더마다

  // 초안(draft) 관리 — 첫 담기 전
  const DRAFT_KEY = `draft-${uid}-${date}`;
  const saveDraft = useCallback(() => {
    if (!composing || entries.length === 0) return;
    // 저장되지 않은 기록만 초안으로 보관
    const unsaved = entries.filter((e) => !e.saved);
    if (unsaved.length === 0) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify(
      unsaved.map((e) => ({
        _tempId: e._tempId,
        items: e.items.map((x) => ({ text: x.text, photos: x.photos })),
        emotion: e.emotion, visibility: e.visibility, teamIds: e.teamIds,
        sharedUsers: e.sharedUsers.map((u) => ({ id: u.id, display_id: u.display_id })),
      }))
    ));
  }, [entries, composing, DRAFT_KEY]);

  // 모든 기록이 저장되면 초안 삭제
  useEffect(() => {
    if (entries.length > 0 && entries.every((e) => e.saved)) localStorage.removeItem(DRAFT_KEY);
  }, [entries, DRAFT_KEY]);

  // 초안 복원 — 서버 기록이 없을 때만
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current || entries.some((e) => e.saved)) return;
    draftLoaded.current = true;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const drafts = JSON.parse(raw);
      if (!Array.isArray(drafts) || !drafts.length) return;
      const restored = drafts.map((d) => ({
        _tempId: d._tempId || crypto.randomUUID(),
        id: null,
        items: toEditItems(d.items),
        emotion: d.emotion || '',
        photos: [],
        visibility: d.visibility || 'private',
        teamIds: d.teamIds || [],
        sharedUsers: d.sharedUsers || [],
        saved: false,
      }));
      setEntries(restored);
      setComposing(true);
    } catch { localStorage.removeItem(DRAFT_KEY); }
  }, [DRAFT_KEY]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집 중이면 변경마다 초안 저장
  useEffect(() => {
    if (entries.every((e) => e.saved)) return;
    const t = setTimeout(saveDraft, 500);
    return () => clearTimeout(t);
  }); // 매 렌더마다

  // 언마운트 시 초안 저장
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  useEffect(() => {
    if (entries.every((e) => e.saved)) return;
    return () => saveDraftRef.current();
  }, [entries.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const daily = verseOfDay(verses);

  // 기록 화면 접기 — 남은 변경분은 조용히 저장하고 닫는다
  async function collapse() {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.saved) {
        const snap = makeSnap(e);
        if (snap !== (lastSaved.current.get(e._tempId) || '')) {
          if (isEntryEmpty(e)) await removeEntry(i);
          else await doSave(i, true);
        }
      }
    }
    setComposing(false);
  }

  // 새 기록 추가
  function addEntry() {
    const ne = blankEntry();
    const newIdx = entries.length; // 새 카드의 인덱스
    setEntries((prev) => [...prev, ne]);
    setActiveIdx(newIdx);
    // 새로 추가된 카드로 이동 (scroll-snap이 정확한 위치로 보정)
    setTimeout(() => {
      if (scrollRef.current) {
        const el = scrollRef.current;
        el.scrollTo({ left: newIdx * el.offsetWidth, behavior: 'smooth' });
      }
    }, 80);
  }

  // 스크롤 snap 변경 시 활성 인덱스 업데이트
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.offsetWidth;
    const idx = Math.round(el.scrollLeft / cardWidth);
    if (idx !== activeIdx && idx < entries.length) {
      setActiveIdx(idx);
      setEmoOpen(false);
      setUserQuery('');
      setUserResults([]);
    }
  }

  // 특정 인덱스로 스크롤
  function scrollToIdx(idx) {
    setActiveIdx(idx);
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTo({ left: idx * scrollRef.current.offsetWidth, behavior: 'smooth' });
      }
    }, 30);
  }

  const hasSaved = entries.some((e) => e.saved);

  return (
    <>
      <header className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Avatar profile={profile} size={52} onClick={() => navigate('/settings')} />
          <h1 style={{ margin: 0 }}>{profile?.display_id ? `샬롬, ${profile.display_id}님✨` : '오늘의 감사'}</h1>
        </div>
        <button className="icon-btn" aria-label="알림" onClick={() => navigate('/notifications')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {unread > 0 && <span className="badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </header>

      <div className="week-strip fade-in">
        {week.map((d, i) => {
          const s = todayStr(d);
          return (
            <button key={s} type="button"
              className={`wd${s === date ? ' today' : ''}${weekDone.has(s) ? ' done' : ''}`}
              onClick={() => navigate('/calendar')}>
              <span className="lbl">{WD_LABELS[i]}</span>
              <span className="num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      {daily && (
        <>
          <p className="home-title" style={{ marginTop: 4 }}>🌿 오늘의 말씀</p>
          <section className="accent-card lime verse">
            <p className="vtext" style={{ margin: 0 }}>{daily.text}</p>
            <div className="vref">{daily.reference}</div>
          </section>
        </>
      )}

      {/* 편집 중이 아닐 때만 타이틀 바를 바깥에 표시 */}
      {!composing && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <p className="home-title" style={{ margin: '0 4px 0' }}>🧡 오늘의 감사</p>
          {hasSaved && (
            <button className="likebtn" onClick={() => { setComposing(true); setActiveIdx(0); }}>펼치기 <Icon name="chevronDown" size={14} /></button>
          )}
        </div>
      )}

      {/* 기록 없는 초기 상태 */}
      {!composing && !hasSaved && (
        <section className="accent-card lav fade-in" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <p style={{ margin: '0 0 14px', color: 'color-mix(in srgb, var(--accent-ink) 70%, transparent)' }}>
              오늘, 어떤 순간이 감사했나요?<br/> 작은 것도 괜찮아요 ☺️
            </p>
            <button className="btn small soft" onClick={() => {
              if (entries.length === 0) setEntries([blankEntry()]);
              setActiveIdx(0);
              setComposing(true);
              setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }}>기록하기</button>
          </div>
        </section>
      )}

      {/* 저장된 기록이 있으면 — 읽기전용 스와이프 요약 */}
      {!composing && hasSaved && (() => {
        const savedEntries = entries.filter((e) => e.saved);
        return (
          <div className="fade-in" style={{ marginTop: 10 }}>
            {savedEntries.length === 1 ? (
              /* 기록 1개 — 바로 표시 */
              <div style={{ cursor: 'pointer' }} onClick={() => { setComposing(true); setActiveIdx(0); }}>
                <div className="items" style={{
                  background: 'color-mix(in srgb, var(--card) 70%, transparent)',
                  borderRadius: 14, padding: '4px 12px',
                }}>
                  {savedEntries[0].items.filter((v) => v.text || v.photos.length > 0).map((v, i) => (
                    <div key={i} className="item" style={{ pointerEvents: 'none' }}>
                      <span className="dot">·</span>
                      <span style={{ flex: 1, wordBreak: 'break-word' }}>{v.text}</span>
                      {v.photos.length > 0 && (
                        <span className="gc-photos" style={{ marginLeft: 8 }}>
                          {v.photos.slice(0, 2).map((p) => (
                            <img key={p} src={photoUrl(p)} alt="" />
                          ))}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              /* 기록 2개 이상 — 좌우 스와이프 */
              <>
                <div className="entry-scroll summary-scroll" ref={scrollRef} onScroll={onScroll}>
                  {savedEntries.map((entry, ei) => (
                    <div key={entry._tempId} className="entry-page" onClick={() => {
                      setActiveIdx(entries.indexOf(entry));
                      setComposing(true);
                    }} style={{ cursor: 'pointer' }}>
                      <div className="items" style={{
                        background: 'color-mix(in srgb, var(--card) 70%, transparent)',
                        borderRadius: 14, padding: '4px 12px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 0 4px' }}>
                          {entry.emotion && <Emo name={entry.emotion} size="1.2rem" />}
                          <span className="tiny" style={{ color: 'var(--sub)' }}>감사 {ei + 1}</span>
                        </div>
                        {entry.items.filter((v) => v.text || v.photos.length > 0).map((v, i) => (
                          <div key={i} className="item" style={{ pointerEvents: 'none' }}>
                            <span className="dot">·</span>
                            <span style={{ flex: 1, wordBreak: 'break-word' }}>{v.text}</span>
                            {v.photos.length > 0 && (
                              <span className="gc-photos" style={{ marginLeft: 8 }}>
                                {v.photos.slice(0, 2).map((p) => (
                                  <img key={p} src={photoUrl(p)} alt="" />
                                ))}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="entry-dots">
                  {savedEntries.map((e, i) => (
                    <button key={e._tempId} className={`entry-dot${i === activeIdx ? ' on' : ''}`}
                      aria-label={`감사 ${i + 1}`} onClick={() => scrollToIdx(i)} />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* 편집 상태 — 카드 스와이프 + 감정/공유/저장 */}
      {composing && (
      <section className="fade-in" ref={focusRef}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <p className="home-title" style={{ margin: '0 4px 0' }}>🧡 오늘의 감사</p>
          <button className="likebtn" onClick={collapse}>접기 <Icon name="chevronUp" size={14} /></button>
        </div>

        {/* 페이지 인디케이터 (상단) */}
        <div className="entry-dots">
          {entries.map((e, i) => (
            <button key={e._tempId} className={`entry-dot${i === activeIdx ? ' on' : ''}`}
              aria-label={`감사 ${i + 1}`} onClick={() => scrollToIdx(i)} />
          ))}
          <span className="entry-dot add" aria-hidden="true" />
        </div>
        {entries.length === 1 && (
          <p className="tiny center" style={{ margin: '0 0 2px', color: 'var(--sub)' }}>새로운 감사 항목 추가할 수 있어요 →</p>
        )}

        {/* 다중 기록 스와이프 영역 */}
        <div className="entry-scroll" ref={scrollRef} onScroll={onScroll}>
          {entries.map((entry, ei) => (
            <div key={entry._tempId} className="entry-page">

              {entries.length > 1 && (
                <div className="entry-page-header">
                  <span className="entry-page-num">감사 {ei + 1}</span>
                  <button className="likebtn" aria-label="이 기록 삭제"
                    onClick={async () => {
                      if (entry.saved) {
                        const ok = await appConfirm('이 감사 기록을 지울까요?');
                        if (!ok) return;
                      }
                      removeEntry(ei);
                    }}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}

              <div className="sub" style={{ padding: '12px 12px', background: 'var(--card)' }}>
                <ItemsEditor
                  items={entry.items}
                  placeholder="오늘, 어떤 순간이 감사했나요?"
                  onZoom={setZoom}
                  onChange={(newItems) => updateEntry(ei, { items: newItems })}
                />

                {entry.photos.length > 0 && (
                  <div className="photos" style={{ marginTop: 4 }}>
                    {entry.photos.map((p) => (
                      <div className="ph" key={p}>
                        <img src={photoUrl(p)} alt="" onClick={() => setZoom(photoUrl(p))} />
                        <button aria-label="사진 지우기" onClick={() => updateEntry(ei, {
                          photos: entry.photos.filter((x) => x !== p),
                        })}><Icon name="x" size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="sub pop-t">
                <button type="button" className="emo-head" aria-expanded={ei === activeIdx && emoOpen} onClick={() => {
                  if (ei !== activeIdx) scrollToIdx(ei);
                  setEmoOpen((o) => ei === activeIdx ? !o : true);
                }}>
                  <span className="sub-title" style={{ margin: 0 }}>💛 오늘의 마음</span>
                  <span className="emo-sel">
                    {entry.emotion ? <><Emo name={entry.emotion} /> {entry.emotion}</> : '마음 고르기'} <Icon name={ei === activeIdx && emoOpen ? 'chevronUp' : 'chevronDown'} size={14} />
                  </span>
                </button>
                {ei === activeIdx && emoOpen && (
                  <div className="emotions" style={{ marginTop: 14 }}>
                    {EMOTIONS.map((e) => (
                      <button key={e.name} className={entry.emotion === e.name ? 'on' : ''}
                        onClick={() => { updateEntry(ei, { emotion: e.name }); setEmoOpen(false); }}>
                        <span className="e"><Emo name={e.name} size="2.4rem" /></span>
                        <span className="n">{e.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="sub sky-t">
              <p className="sub-title">🕊️ 함께 나누기</p>
              <div className="tabs vis" style={{ margin: 0, flexWrap: 'wrap' }}>
                {[['private', '나만 보기'], ['cell', '셀원들과 공유'], ['group', '나눔 공동체와 공유'], ['users', '개인 공유']].map(([v, l]) => (
                  <button key={v} type="button" className={entry.visibility === v ? 'on' : ''}
                    style={{ flex: '1 1 45%' }}
                    onClick={() => updateEntry(ei, { visibility: v })}>{l}</button>
                ))}
              </div>
              {(entry.visibility === 'cell' || entry.visibility === 'group') && (
                <div className="field" style={{ textAlign: 'center', margin: 0, padding: '10px 0' }}>
                  <p className="tiny" style={{ margin: '10px 0 8px' }}>{entry.visibility === 'cell' ? '현재 본인의 셀을 선택하세요.' : '나눔 공동체를 선택하세요.'}</p>
                  <div>
                    {teams.filter((t) => t.kind === entry.visibility).map((t) => {
                      const on = entry.teamIds.includes(t.id);
                      return (
                        <button key={t.id} type="button"
                          className={`team-chip ${on ? 'on' : ''}`}
                          onClick={() => updateEntry(ei, { teamIds: on ? entry.teamIds.filter((x) => x !== t.id) : [...entry.teamIds, t.id] })}>
                          {on ? '✓ ' : ''}{t.name}
                        </button>
                      );
                    })}
                  </div>
                  {!teams.some((t) => t.kind === entry.visibility) && (
                    <p className="tiny" style={{ margin: '8px 0 0' }}>
                      {entry.visibility === 'cell'
                        ? '아직 속한 셀이 없습니다. 셀리더의 초대를 받아보세요.'
                        : '아직 속한 나눔 공동체가 없습니다.'}
                    </p>
                  )}
                </div>
              )}
              {entry.visibility === 'users' && ei === activeIdx && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <input type="text" className="share-user-search" placeholder="이름으로 검색 (예: 인터치A)" aria-label="공유할 사람 이름 검색" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
                  {userResults.map((u) => (
                    <button key={u.id} className="btn subtle small" style={{ margin: '6px 6px 0 0' }}
                      onClick={() => {
                        if (!entry.sharedUsers.find((x) => x.id === u.id)) updateEntry(ei, { sharedUsers: [...entry.sharedUsers, u] });
                        setUserQuery('');
                      }}>
                      + {u.display_id}
                    </button>
                  ))}
                  <div style={{ marginTop: 8 }}>
                    {entry.sharedUsers.map((u) => (
                      <span key={u.id} className="pill" style={{ marginRight: 6 }}>
                        {u.display_id}{' '}
                        <button className="del" aria-label={`${u.display_id} 빼기`}
                          onClick={() => updateEntry(ei, { sharedUsers: entry.sharedUsers.filter((x) => x.id !== u.id) })}><Icon name="x" size={12} /></button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              </div>

              {!entry.saved && <p className="tiny center fade-in" style={{ margin: '0 0 8px', color: 'var(--sub)' }}>
                처음 한 번만 눌러 주시면, 이후엔 자동으로 저장돼요.
              </p>}
              <button className="btn wide ink small" onClick={() => {
                setActiveIdx(ei);
                if (entry.saved) doSave(ei, false);
                else save();
              }} disabled={saving}>
                {saving && ei === activeIdx ? '담는 중…' : entry.saved ? '수정하기' : '오늘의 감사 담기 🙏'}
              </button>
            </div>
          ))}

          {/* + 새 기록 추가 카드 */}
          <div className="entry-page">
            <button className="entry-add-card" onClick={addEntry} aria-label="새 감사 기록 추가">
              <Icon name="plus" size={28} />
              <span className="tiny" style={{ marginTop: 8, color: 'var(--sub)' }}>새 감사 추가</span>
            </button>
          </div>
        </div>


        {savedNote && <p className={`notice ${savedNoteFading ? 'fade-out' : 'fade-in'}`} style={{whiteSpace:'pre-line'}}>{savedNote}</p>}
      </section>
      )}


      <MemoCard uid={uid} online={online} />

      {popupVerse && (
        <Overlay label="오늘의 말씀" onClose={() => setPopupVerse(null)}>
          <div className="modal verse" onClick={(e) => e.stopPropagation()}>
            <Censer count={popupVerse.total} />
            <p className="tiny center" style={{ margin: '0 0 18px' }}>
              {popupVerse.total
                ? `${popupVerse.total}번째 감사가 금향로에 향처럼 담겼습니다`
                : '오늘의 감사가 금향로에 향처럼 담겼습니다'}
            </p>
            <div className="vlabel">당신에게 건네는 말씀</div>
            <p className="vtext">{popupVerse.text}</p>
            <div className="vref">{popupVerse.reference}</div>
            <div className="spacer" />
            <button className="btn ghost small" style={{ margin: '16px 0' }} onClick={() => setPopupVerse(null)}>아멘</button>
          </div>
        </Overlay>
      )}

      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
