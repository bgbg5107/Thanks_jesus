import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';
import { photoUrl, supabase } from '../lib/supabase.js';
import { EMOTIONS, randomVerse, todayStr, verseOfDay } from '../lib/util.js';
import Emo from '../components/Emo.jsx';
import Avatar from '../components/Avatar.jsx';
import { filesToData, getPending, removePending, savePending, uploadPhotos } from '../lib/offline.js';
import ItemsEditor, { emptyItem, snapItems, toEditItems, toJpeg } from '../components/ItemsEditor.jsx';
import Lightbox from '../components/Lightbox.jsx';
import Censer from '../components/Censer.jsx';
import MemoCard from '../components/MemoCard.jsx';
import { appAlert, appConfirm } from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import Overlay from '../components/Overlay.jsx';

const WD_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
const gcLabel = (i) => `감사${i + 1}`;

export default function Home() {
  const { session, profile, online, teams, unread } = useApp();
  const uid = session.user.id;
  const date = todayStr();
  const navigate = useNavigate();

  const [verses, setVerses] = useState(() => JSON.parse(localStorage.getItem('verses') || '[]'));
  const [items, setItems] = useState([emptyItem()]);
  const [emotion, setEmotion] = useState('');
  const [photos, setPhotos] = useState([]);       // 옛 형식: 하루 단위로 붙었던 사진
  const [visibility, setVisibility] = useState('private');
  const [teamIds, setTeamIds] = useState([]);   // 나눌 셀 여러 개 선택 가능
  const [sharedUsers, setSharedUsers] = useState([]); // {id, display_id}
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const [popupVerse, setPopupVerse] = useState(null);
  const [zoom, setZoom] = useState(null);   // 확대 보기 사진 URL
  const [emoOpen, setEmoOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [savedNoteFading, setSavedNoteFading] = useState(false);
  const [saved, setSaved] = useState(false);   // 오늘 기록이 한 번이라도 담긴 뒤에는 자동 저장
  const [composing, setComposing] = useState(false); // '기록하기'를 눌러 편집 화면을 연 상태
  const [weekDone, setWeekDone] = useState(new Set()); // 이번 주 기록된 날짜들
  const focusRef = useRef(null);                // 감사 기록 섹션 (스크롤 타겟)
  const lastSaved = useRef('');                 // 마지막으로 저장된 내용 스냅샷

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

  const makeSnap = (v) => JSON.stringify(v);
  const snapshot = () => makeSnap({
    items: snapItems(items), emotion, visibility, teamIds,
    su: sharedUsers.map((u) => u.id), photos,
  });

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

  // 오늘 기록 로드 (서버 → 로컬 대기분 우선)
  const load = useCallback(async () => {
    let entry = null;
    if (online) {
      const { data } = await supabase.from('entries').select('*')
        .eq('user_id', uid).eq('date', date).maybeSingle();
      entry = data;
    }
    const pending = (await getPending())[date];
    const src = pending || entry;
    if (src) {
      const its = toEditItems(src.contents);
      let su = [];
      if (!pending && entry?.shared_user_ids?.length) {
        const { data: us } = await supabase.from('profiles').select('id, display_id').in('id', entry.shared_user_ids);
        su = us || [];
      }
      // DB의 'team' 공유를 화면 카테고리(셀/나눔 공동체)로 분류
      let uiVis = src.visibility || 'private';
      if (uiVis === 'team') {
        const hasCell = (src.shared_team_ids || []).some((id) => teams.find((t) => t.id === id)?.kind === 'cell');
        uiVis = hasCell ? 'cell' : 'group';
      }
      setItems(its);
      setEmotion(src.emotion || '');
      setPhotos(src.photos || []);
      setVisibility(uiVis);
      setTeamIds(src.shared_team_ids || []);
      setSharedUsers(su);
      setSaved(true);
      setComposing(true);
      lastSaved.current = makeSnap({
        items: snapItems(its), emotion: src.emotion || '', visibility: uiVis,
        teamIds: src.shared_team_ids || [], su: su.map((u) => u.id), photos: src.photos || [],
      });
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
      Object.keys(await getPending()).forEach((d) => { if (d >= from && d <= to) done.add(d); });
      setWeekDone(done);
    })();
  }, [online, uid, saved]);  // eslint-disable-line react-hooks/exhaustive-deps

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

  async function doSave(silent) {
    const cleaned = items.filter((x) => x.text.trim() || x.photos.length || x.newFiles.length);
    if (!cleaned.length) { if (!silent) appAlert('감사한 일을 한 가지라도 적어 주세요.'); return false; }
    if (!emotion) { if (!silent) { setEmoOpen(true); appAlert('오늘의 마음을 하나 골라 주세요.'); } return false; }
    // 셀/나눔 공동체 공유는 DB에서는 동일한 'team' 공유 — 종류에 맞는 선택만 저장
    const isTeamMode = visibility === 'cell' || visibility === 'group';
    const kindIds = isTeamMode
      ? teamIds.filter((id) => teams.find((t) => t.id === id)?.kind === visibility)
      : [];
    if (isTeamMode && !kindIds.length) {
      if (!silent) appAlert(visibility === 'cell' ? '셀을 하나 이상 골라 주세요.' : '나눔 공동체를 하나 이상 골라 주세요.');
      return false;
    }
    setSaving(true);
    const base = {
      date, emotion, photos,
      visibility: isTeamMode ? 'team' : visibility,
      shared_team_ids: kindIds,
      shared_user_ids: visibility === 'users' ? sharedUsers.map((u) => u.id) : [],
    };
    try {
      if (!navigator.onLine) throw new Error('offline');
      // 항목별 새 사진 업로드 후 각 항목에 붙인다
      const newItems = [];
      for (const x of cleaned) {
        const paths = x.newFiles.length ? await uploadPhotos(uid, await filesToData(x.newFiles)) : [];
        newItems.push({ text: x.text.trim(), photos: [...x.photos, ...paths], newFiles: [] });
      }
      const contents = newItems.map((x) => ({ text: x.text, photos: x.photos }));
      const { error } = await supabase.from('entries').upsert({
        user_id: uid, ...base, contents,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,date' });
      if (error) throw error;
      await removePending(date);
      setItems(newItems);
      setSavedNote(silent ? '자동으로 저장되었습니다.' : '오늘의 감사가 담겼습니다.');
      lastSaved.current = makeSnap({
        items: snapItems(newItems), emotion, visibility, teamIds,
        su: sharedUsers.map((u) => u.id), photos,
      });
    } catch {
      // 오프라인 — 항목별 사진은 blob으로 보관했다가 연결되면 항목에 붙인다
      const contents = cleaned.map((x) => ({ text: x.text.trim(), photos: x.photos }));
      const itemPhotosData = [];
      for (let i = 0; i < cleaned.length; i++) {
        for (const d of await filesToData(cleaned[i].newFiles)) itemPhotosData.push({ i, ...d });
      }
      await savePending({ ...base, contents, itemPhotosData });
      setSavedNote('연결이 닿는 대로 자동으로 저장해 드릴게요.');
      lastSaved.current = snapshot();
    }
    setSaved(true);
    setSaving(false);
    return true;
  }

  async function save() {
    const first = !saved;   // 오늘의 첫 담기인지
    const ok = await doSave(false);
    if (ok) { setComposing(false); }
    if (ok && first) {
      // 금향로에 쌓일 전체 누적 기록 수 (오프라인이면 개수 없이 연출만)
      let total = null;
      try {
        if (navigator.onLine) {
          const { count } = await supabase.from('entries')
            .select('*', { count: 'exact', head: true }).eq('user_id', uid);
          total = count;
        }
      } catch { /* 조용히 넘어간다 */ }
      const v = randomVerse(verses);
      setPopupVerse({ ...(v || {}), total });   // 말씀 팝업은 첫 담기 때만
    }
  }

  // 감사를 모두 지우면 오늘의 기록도 조용히 비워진다 (자동 저장과 같은 호흡)
  const isEmpty = items.every((x) => !x.text.trim() && !x.photos.length && !x.newFiles.length) && !photos.length;

  async function removeToday() {
    if (!navigator.onLine) return;   // 연결이 닿으면 다음 호흡에 비워진다
    setSaving(true);
    try {
      const { error } = await supabase.from('entries').delete().eq('user_id', uid).eq('date', date);
      if (error) throw error;
      await removePending(date);
      setSaved(false);
      lastSaved.current = '';
      setSavedNoteFading(false);
      setSavedNote('오늘의 기록을 비웠습니다.\n마음이 닿는 순간, 언제든 다시 담아 주세요.');
      setTimeout(() => setSavedNoteFading(true), 2400);
      setTimeout(() => { setSavedNote(''); setSavedNoteFading(false); }, 3000);
    } catch { /* 다음 자동 저장 때 다시 시도한다 */ } finally {
      setSaving(false);
    }
  }

  // 한 번 담긴 뒤에는 손을 멈추면 3초 후 자동으로 저장 — 모두 지웠다면 조용히 비운다
  // 단, 카드 편집 팝업이 열려 있는 동안은 보류 — 저장이 빈 항목을 걷어내며
  // 편집 중인 카드가 사라질 수 있으므로, 팝업을 닫은 뒤에 저장한다.
  useEffect(() => {
    if (!saved || saving) return;
    if (snapshot() === lastSaved.current) return;
    const t = setTimeout(() => (isEmpty ? removeToday() : doSave(true)), 3000);
    return () => clearTimeout(t);
  });

  // 첫 담기 전 초안(draft)을 localStorage에 보관 — 페이지 이동 후 복원
  const DRAFT_KEY = `draft-${uid}-${date}`;
  const saveDraft = useCallback(() => {
    if (!composing) { return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      items: items.map((x) => ({ text: x.text, photos: x.photos })),
      emotion, visibility, teamIds,
      sharedUsers: sharedUsers.map((u) => ({ id: u.id, display_id: u.display_id })),
      composing: true,
    }));
  }, [items, emotion, visibility, teamIds, sharedUsers, composing, DRAFT_KEY]);

  // saved가 되면 초안 삭제 (서버/오프라인에 저장됐으므로)
  useEffect(() => { if (saved) localStorage.removeItem(DRAFT_KEY); }, [saved, DRAFT_KEY]);

  // 초안 복원 — 서버 기록이 없을 때만
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (draftLoaded.current || saved) return;
    draftLoaded.current = true;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const d = JSON.parse(raw);
      if (d.items) setItems(toEditItems(d.items));
      if (d.emotion) setEmotion(d.emotion);
      if (d.visibility) setVisibility(d.visibility);
      if (d.teamIds) setTeamIds(d.teamIds);
      if (d.sharedUsers) setSharedUsers(d.sharedUsers);
      if (d.composing) setComposing(true);
    } catch { localStorage.removeItem(DRAFT_KEY); }
  }, [DRAFT_KEY]); // eslint-disable-line react-hooks/exhaustive-deps

  // 첫 담기 전 편집 중이면 변경마다 초안 저장
  useEffect(() => {
    if (saved) return;
    const t = setTimeout(saveDraft, 500);
    return () => clearTimeout(t);
  }); // 매 렌더마다 확인

  // 언마운트 시 초안 저장
  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;
  useEffect(() => {
    if (saved) return;
    return () => saveDraftRef.current();
  }, [saved]);

  const daily = verseOfDay(verses);

  // 기록 화면 접기 — 남은 변경분은 조용히 저장하고 닫는다
  async function collapse() {
    if (saved && snapshot() !== lastSaved.current) {
      if (isEmpty) await removeToday();
      else await doSave(true);
    }
    setComposing(false);
  }

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
          <section className="accent-card lime verse fade-in" style={{ padding: '30px 24px', textAlign: 'center' }}>
            <p className="vtext" style={{ margin: 0 }}>{daily.text}</p>
            <div className="vref">{daily.reference}</div>
          </section>
        </>
      )}

      {/* 편집 중이 아닐 때만 타이틀 바를 바깥에 표시 */}
      {!composing && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <p className="home-title" style={{ margin: '0 4px 0' }}>🧡 오늘의 감사</p>
          {saved && (
            <button className="likebtn" onClick={() => setComposing(true)}>펼치기 <Icon name="chevronDown" size={14} /></button>
          )}
        </div>
      )}

      {/* 기록 없는 초기 상태 */}
      {!composing && !saved && (
        <section className="accent-card lav fade-in" style={{ textAlign: 'center', padding: 20 }}>
          <div style={{ textAlign: 'center', padding: '6px 0' }}>
            <p style={{ margin: '0 0 14px', color: 'color-mix(in srgb, var(--accent-ink) 70%, transparent)' }}>
              오늘, 어떤 순간이 감사했나요?<br/> 작은 것도 괜찮아요 ☺️
            </p>
            <button className="btn small soft" onClick={() => {
            setComposing(true);
            setTimeout(() => focusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }}>기록하기</button>
          </div>
        </section>
      )}

      {/* 저장된 기록이 있으면 — 읽기전용 불릿 리스트 */}
      {!composing && saved && (
        <div className="items fade-in" style={{ cursor: 'pointer', background: 'color-mix(in srgb, var(--card) 70%, transparent)', borderRadius: 14, padding: '4px 12px', marginTop: 10 }} onClick={() => setComposing(true)}>
          {items.filter((v) => v.text || v.photos.length > 0).map((v, i) => (
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
      )}

      {/* 편집 상태 — 카드 스크롤 + 감정/공유/저장 */}
      {composing && (
      <section className="fade-in" ref={focusRef}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
          <p className="home-title" style={{ margin: '0 4px 0' }}>🧡 오늘의 감사</p>
          <button className="likebtn" onClick={collapse}>접기 <Icon name="chevronUp" size={14} /></button>
        </div>
        <div className="sub" style={{ padding: '16px 12px', background: 'var(--card)' }}>
          <ItemsEditor
            items={items}
            placeholder="오늘, 어떤 순간이 감사했나요?"
            onZoom={setZoom}
            onChange={setItems}
          />

          {photos.length > 0 && (
            <div className="photos" style={{ marginTop: 4 }}>
              {photos.map((p) => (
                <div className="ph" key={p}>
                  <img src={photoUrl(p)} alt="" onClick={() => setZoom(photoUrl(p))} />
                  <button aria-label="사진 지우기" onClick={() => setPhotos((a) => a.filter((x) => x !== p))}><Icon name="x" size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="sub pop-t">
          <button type="button" className="emo-head" aria-expanded={emoOpen} onClick={() => setEmoOpen((o) => !o)}>
            <span className="sub-title" style={{ margin: 0 }}>💛 오늘의 마음</span>
            <span className="emo-sel">
              {emotion ? <><Emo name={emotion} /> {emotion}</> : '마음 고르기'} <Icon name={emoOpen ? 'chevronUp' : 'chevronDown'} size={14} />
            </span>
          </button>
          {emoOpen && (
            <div className="emotions" style={{ marginTop: 14 }}>
              {EMOTIONS.map((e) => (
                <button key={e.name} className={emotion === e.name ? 'on' : ''}
                  onClick={() => { setEmotion(e.name); setEmoOpen(false); }}>
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
            <button key={v} type="button" className={visibility === v ? 'on' : ''}
              style={{ flex: '1 1 45%' }}
              onClick={() => setVisibility(v)}>{l}</button>
          ))}
        </div>
        {(visibility === 'cell' || visibility === 'group') && (
          <div className="field" style={{ textAlign: 'center', margin: 0, padding: '10px 0' }}>
            <p className="tiny" style={{ margin: '10px 0 8px' }}>{visibility === 'cell' ? '현재 본인의 셀을 선택하세요.' : '나눔 공동체를 선택하세요.'}</p>
            <div>
              {teams.filter((t) => t.kind === visibility).map((t) => {
                const on = teamIds.includes(t.id);
                return (
                  <button key={t.id} type="button"
                    className={`team-chip ${on ? 'on' : ''}`}
                    onClick={() => setTeamIds((a) => (on ? a.filter((x) => x !== t.id) : [...a, t.id]))}>
                    {on ? '✓ ' : ''}{t.name}
                  </button>
                );
              })}
            </div>
            {!teams.some((t) => t.kind === visibility) && (
              <p className="tiny" style={{ margin: '8px 0 0' }}>
                {visibility === 'cell'
                  ? '아직 속한 셀이 없습니다. 셀리더의 초대를 받아보세요.'
                  : '아직 속한 나눔 공동체가 없습니다.'}
              </p>
            )}
          </div>
        )}
        {visibility === 'users' && (
          <div className="field" style={{ marginBottom: 0 }}>
            <input type="text" className="share-user-search" placeholder="이름으로 검색 (예: 인터치A)" aria-label="공유할 사람 이름 검색" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
            {userResults.map((u) => (
              <button key={u.id} className="btn subtle small" style={{ margin: '6px 6px 0 0' }}
                onClick={() => {
                  if (!sharedUsers.find((x) => x.id === u.id)) setSharedUsers((a) => [...a, u]);
                  setUserQuery('');
                }}>
                + {u.display_id}
              </button>
            ))}
            <div style={{ marginTop: 8 }}>
              {sharedUsers.map((u) => (
                <span key={u.id} className="pill" style={{ marginRight: 6 }}>
                  {u.display_id}{' '}
                  <button className="del" aria-label={`${u.display_id} 빼기`}
                    onClick={() => setSharedUsers((a) => a.filter((x) => x.id !== u.id))}><Icon name="x" size={12} /></button>
                </span>
              ))}
            </div>
          </div>
        )}
        </div>

        {savedNote && <p className={`notice ${savedNoteFading ? 'fade-out' : 'fade-in'}`} style={{whiteSpace:'pre-line'}}>{savedNote}</p>}
        {!saved && <p className="tiny center fade-in" style={{ margin: '0 0 8px', color: 'var(--sub)' }}>
          처음 한 번만 눌러 주시면, 이후엔 자동으로 저장돼요.
        </p>}
        <button className="btn wide ink small" onClick={save} disabled={saving || (saved && isEmpty)}>
          {saving ? '담는 중…' : saved ? '수정하기' : '오늘의 감사 담기 🙏'}
        </button>
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
