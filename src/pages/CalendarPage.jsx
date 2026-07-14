import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { photoUrl, supabase } from '../lib/supabase.js';
import { EMOTIONS, emojiOf, fmtKoDate, itemText, randomVerse, streakOf, todayStr } from '../lib/util.js';
import Emo from '../components/Emo.jsx';
import { cacheEntries, filesToData, getCachedEntries, getPending, removePending, savePending, uploadPhotos } from '../lib/offline.js';
import ItemsEditor, { emptyItem, snapItems, toEditItems } from '../components/ItemsEditor.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { appAlert, appConfirm } from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import Overlay from '../components/Overlay.jsx';
import Censer from '../components/Censer.jsx';

const WDAYS = ['일', '월', '화', '수', '목', '금', '토'];

// 빈 기록(편집용)
function blankEdit() {
  return { items: [emptyItem()], emotion: '', vis: 'private', teamIds: [], sharedUsers: [] };
}

export default function CalendarPage() {
  const { session, profile, online, teams } = useApp();
  const uid = session.user.id;
  const now = new Date();
  const [ym, setYm] = useState([now.getFullYear(), now.getMonth()]);
  const [entries, setEntries] = useState([]);
  // 상세 오버레이 — detailDate: 선택된 날짜, detailEntries: 해당 날짜 기록 배열
  const [detailDate, setDetailDate] = useState(null);
  const [detailEntries, setDetailEntries] = useState([]);  // 서버/pending 기록 원본 배열
  const [detailIdx, setDetailIdx] = useState(0);            // 현재 활성 기록 인덱스
  const [edit, setEdit] = useState(null);
  const [editNote, setEditNote] = useState('');
  const [emoOpen, setEmoOpen] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [userResults, setUserResults] = useState([]);
  const lastEditSaved = useRef('');
  const detailScrollRef = useRef(null);

  const classify = (vis, ids) => (vis === 'team'
    ? ((ids || []).some((id) => teams.find((t) => t.id === id)?.kind === 'cell') ? 'cell' : 'group')
    : (vis || 'private'));
  const snapEdit = (ed) => JSON.stringify({
    items: snapItems(ed.items), emotion: ed.emotion, vis: ed.vis,
    teamIds: ed.teamIds, su: ed.sharedUsers.map((u) => u.id),
  });
  const [exp, setExp] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [popupVerse, setPopupVerse] = useState(null);
  const [verses] = useState(() => JSON.parse(localStorage.getItem('verses') || '[]'));

  const cells = teams.filter((t) => t.kind === 'cell');
  const [cellId, setCellId] = useState('');
  const [cellOpen, setCellOpen] = useState(false);
  const [week, setWeek] = useState([]);
  const weekDays = useMemo(() => {
    const sun = new Date();
    sun.setDate(sun.getDate() - sun.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      return todayStr(d);
    });
  }, []);

  useEffect(() => {
    if (!cellId && cells.length) setCellId(cells[0].id);
  }, [cells, cellId]);

  useEffect(() => {
    if (!cellId || !online) { setWeek([]); return; }
    supabase.rpc('team_week_activity', {
      p_team_id: cellId, p_from: weekDays[0], p_to: weekDays[6],
    }).then(({ data }) => setWeek(data || []));
  }, [cellId, online, weekDays]);

  const [nudged, setNudged] = useState({});
  useEffect(() => {
    const m = {};
    week.forEach((w) => {
      if (localStorage.getItem(`nudge-${uid}-${w.user_id}-${todayStr()}`)) m[w.user_id] = true;
    });
    setNudged(m);
  }, [week, uid]);

  async function sendNudge(m) {
    const { error } = await supabase.from('notifications').insert({
      user_id: m.user_id, type: 'nudge',
      payload: { from: profile?.display_id || '셀 식구', team_name: cells.find((c) => c.id === cellId)?.name || '' },
    });
    if (error) { appAlert(error.message); return; }
    localStorage.setItem(`nudge-${uid}-${m.user_id}-${todayStr()}`, '1');
    setNudged((p) => ({ ...p, [m.user_id]: true }));
  }
  const [range, setRange] = useState({ from: todayStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayStr() });

  useEffect(() => {
    (async () => {
      let list = [];
      if (online) {
        const { data } = await supabase.from('entries').select('*').eq('user_id', uid).order('date');
        list = data || [];
        await cacheEntries(list);
      } else {
        list = await getCachedEntries();
      }
      // pending 기록 병합 (tempId 기반)
      const pending = await getPending();
      for (const tempId of Object.keys(pending)) {
        const d = pending[tempId];
        const merged = { ...d, user_id: uid, pending: true, _tempId: tempId };
        if (d.id) {
          // 기존 서버 기록의 수정본 — 서버 버전을 대체
          const i = list.findIndex((e) => e.id === d.id);
          if (i >= 0) list[i] = { ...list[i], ...merged };
          else list.push(merged);
        } else {
          // 신규 오프라인 기록
          list.push(merged);
        }
      }
      setEntries(list.sort((a, b) => a.date.localeCompare(b.date)));
    })();
  }, [uid, online]);

  // 날짜별 기록 배열
  const byDate = useMemo(() => {
    const m = {};
    entries.forEach((e) => { (m[e.date] = m[e.date] || []).push(e); });
    return m;
  }, [entries]);

  const [year, month] = ym;
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthEntries = entries.filter((e) => e.date.startsWith(monthKey));
  const countItems = (arr) => arr.reduce((sum, e) => sum + (e.contents || []).filter((c) => itemText(c)).length, 0);

  const dist = useMemo(() => {
    const m = {};
    for (const e of monthEntries) m[e.emotion] = (m[e.emotion] || 0) + 1;
    return EMOTIONS.filter((e) => m[e.name]).map((e) => ({ ...e, count: m[e.name] }))
      .sort((a, b) => b.count - a.count);
  }, [monthEntries]);

  const maxDist = dist[0]?.count || 1;
  const streak = useMemo(() => streakOf(new Set(entries.map((e) => e.date))), [entries]);
  const yearEntries = entries.filter((e) => e.date.startsWith(String(year)));

  function download() {
    const sel = entries.filter((e) => e.date >= range.from && e.date <= range.to);
    if (!sel.length) { appAlert('선택한 기간에 기록이 없습니다.'); return; }
    const text = sel.map((e) =>
      `${fmtKoDate(e.date)} · ${e.emotion} ${emojiOf(e.emotion)}\n${(e.contents || []).map((c) => `  · ${itemText(c)}`).join('\n')}`
    ).join('\n\n');
    const blob = new Blob([`감사 기록 (${range.from} ~ ${range.to})\n\n${text}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `감사기록_${range.from}_${range.to}.txt`;
    a.click();
  }

  const printSel = entries.filter((e) => e.date >= range.from && e.date <= range.to);

  // 현재 상세 보기의 활성 기록
  const activeDetail = detailEntries[detailIdx] || null;

  // 상세 열기 — 해당 날짜의 모든 기록을 로드
  function openDetail(dateStr) {
    const dayEntries = byDate[dateStr] || [];
    setDetailDate(dateStr);
    setEmoOpen(false);
    setEditNote('');

    if (dayEntries.length > 0) {
      setDetailEntries(dayEntries);
      setDetailIdx(0);
      const e = dayEntries[0];
      const init = {
        items: toEditItems(e.contents),
        emotion: e.emotion || '',
        vis: classify(e.visibility, e.shared_team_ids),
        teamIds: e.shared_team_ids || [],
        sharedUsers: (e.shared_user_ids || []).map((id) => ({ id, display_id: '…' })),
      };
      setEdit(init);
      lastEditSaved.current = snapEdit(init);
      if (e.shared_user_ids?.length) {
        supabase.from('profiles').select('id, display_id').in('id', e.shared_user_ids)
          .then(({ data }) => setEdit((ed) => (ed ? { ...ed, sharedUsers: data || ed.sharedUsers } : ed)));
      }
    } else {
      if (dateStr > todayStr()) return;
      // 빈 날짜 — 새 기록 작성
      setDetailEntries([{ date: dateStr, contents: [], photos: [], visibility: 'private', shared_team_ids: [], shared_user_ids: [], isNew: true }]);
      setDetailIdx(0);
      setEdit(blankEdit());
      lastEditSaved.current = '';
    }
  }

  // 상세 내 기록 전환
  function switchDetailEntry(idx) {
    if (idx === detailIdx || idx < 0 || idx >= detailEntries.length) return;
    // 현재 수정분이 있으면 자동 저장
    if (edit && !activeDetail?.isNew && snapEdit(edit) !== lastEditSaved.current) {
      saveEdit(true);
    }
    setDetailIdx(idx);
    setEmoOpen(false);
    setEditNote('');
    setUserQuery('');
    const e = detailEntries[idx];
    const init = {
      items: toEditItems(e.contents),
      emotion: e.emotion || '',
      vis: classify(e.visibility, e.shared_team_ids),
      teamIds: e.shared_team_ids || [],
      sharedUsers: (e.shared_user_ids || []).map((id) => ({ id, display_id: '…' })),
    };
    setEdit(init);
    lastEditSaved.current = e.isNew ? '' : snapEdit(init);
    if (e.shared_user_ids?.length) {
      supabase.from('profiles').select('id, display_id').in('id', e.shared_user_ids)
        .then(({ data }) => setEdit((ed) => (ed ? { ...ed, sharedUsers: data || ed.sharedUsers } : ed)));
    }
  }

  // 상세에 새 기록 추가
  function addDetailEntry() {
    if (!detailDate) return;
    // 현재 수정분 저장
    if (edit && !activeDetail?.isNew && snapEdit(edit) !== lastEditSaved.current) {
      saveEdit(true);
    }
    const ne = { date: detailDate, contents: [], photos: [], visibility: 'private', shared_team_ids: [], shared_user_ids: [], isNew: true };
    setDetailEntries((prev) => [...prev, ne]);
    const newIdx = detailEntries.length;
    setDetailIdx(newIdx);
    setEdit(blankEdit());
    lastEditSaved.current = '';
    setEmoOpen(false);
    setEditNote('');
    // 새로 추가된 카드로 스크롤
    setTimeout(() => {
      if (detailScrollRef.current) {
        detailScrollRef.current.scrollTo({ left: newIdx * detailScrollRef.current.offsetWidth, behavior: 'smooth' });
      }
    }, 80);
  }

  // 기록 수정 저장
  async function saveEdit(silent = false) {
    if (!edit || !activeDetail) return;
    const cleaned = edit.items.filter((x) => x.text.trim() || x.photos.length || x.newFiles.length);
    if (!cleaned.length) { if (!silent) appAlert('감사한 일을 한 가지라도 적어 주세요.'); return; }
    if (!edit.emotion) { if (!silent) { setEmoOpen(true); appAlert('그날의 마음을 하나 골라 주세요.'); } return; }
    const isTeamMode = edit.vis === 'cell' || edit.vis === 'group';
    const kindIds = isTeamMode
      ? edit.teamIds.filter((id) => teams.find((t) => t.id === id)?.kind === edit.vis)
      : [];
    if (isTeamMode && !kindIds.length) {
      if (!silent) appAlert(edit.vis === 'cell' ? '나눌 셀을 하나 이상 골라 주세요.' : '나눌 나눔 공동체를 하나 이상 골라 주세요.');
      return;
    }
    const share = {
      visibility: isTeamMode ? 'team' : edit.vis,
      shared_team_ids: kindIds,
      shared_user_ids: edit.vis === 'users' ? edit.sharedUsers.map((u) => u.id) : [],
    };
    let contents;
    const updated = { ...activeDetail, emotion: edit.emotion, ...share, isNew: false };
    try {
      if (activeDetail.pending || !navigator.onLine) throw new Error('offline');
      const newItems = [];
      for (const x of cleaned) {
        const paths = x.newFiles.length ? await uploadPhotos(uid, await filesToData(x.newFiles)) : [];
        newItems.push({ text: x.text.trim(), photos: [...x.photos, ...paths], newFiles: [] });
      }
      contents = newItems.map((x) => ({ text: x.text, photos: x.photos }));
      const row = {
        user_id: uid, date: detailDate, contents, emotion: edit.emotion,
        photos: activeDetail.photos || [], ...share,
        updated_at: new Date().toISOString(),
      };
      if (activeDetail.id) {
        // 기존 기록 수정
        const { error } = await supabase.from('entries').update(row).eq('id', activeDetail.id);
        if (error) throw error;
      } else {
        // 신규 기록 삽입
        const { data: inserted, error } = await supabase.from('entries').insert(row).select('id').single();
        if (error) throw error;
        updated.id = inserted.id;
      }
      setEdit((ed) => (ed ? { ...ed, items: newItems } : ed));
      lastEditSaved.current = snapEdit({ ...edit, items: newItems });
    } catch {
      contents = cleaned.map((x) => ({ text: x.text.trim(), photos: x.photos }));
      const itemPhotosData = [];
      for (let i = 0; i < cleaned.length; i++) {
        for (const d of await filesToData(cleaned[i].newFiles)) itemPhotosData.push({ i, ...d });
      }
      await savePending({
        _tempId: activeDetail._tempId, id: activeDetail.id,
        date: detailDate, contents, emotion: edit.emotion,
        photos: activeDetail.photos || [], photosData: activeDetail.photosData || [],
        itemPhotosData, ...share,
      });
      updated.pending = true;
      lastEditSaved.current = snapEdit(edit);
    }
    updated.contents = contents;
    // entries 전체 목록 업데이트
    setEntries((list) => {
      if (activeDetail.id) {
        return list.map((e) => (e.id === activeDetail.id ? { ...e, ...updated } : e));
      }
      // 신규 기록 추가
      return [...list, updated].sort((a, b) => a.date.localeCompare(b.date));
    });
    setDetailEntries((prev) => prev.map((e, i) => i === detailIdx ? updated : e));
    if (silent) setEditNote('자동으로 저장되었습니다.');
    else {
      if (activeDetail.isNew && detailDate === todayStr()) {
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
      setEdit(null);
    }
  }

  async function closeDetail() {
    if (edit && !activeDetail?.isNew && snapEdit(edit) !== lastEditSaved.current) {
      if (editEmpty) await removeEntry();
      else await saveEdit(true);
    }
    setDetailDate(null);
    setDetailEntries([]);
    setEdit(null);
    setUserQuery('');
  }

  const editEmpty = edit && edit.items.every((x) => !x.text.trim() && !x.photos.length && !x.newFiles.length) && !activeDetail?.photos?.length;

  async function removeEntry() {
    if (!activeDetail) return;
    if (activeDetail.id && navigator.onLine) {
      try {
        const { error } = await supabase.from('entries').delete().eq('id', activeDetail.id);
        if (error) throw error;
      } catch { return; }
    }
    if (activeDetail._tempId) await removePending(activeDetail._tempId);
    // 전체 목록에서 제거
    if (activeDetail.id) {
      setEntries((list) => list.filter((e) => e.id !== activeDetail.id));
    }
    // 상세 목록에서 제거
    const next = detailEntries.filter((_, i) => i !== detailIdx);
    if (next.length === 0) {
      // 해당 날짜 기록이 모두 사라짐
      setDetailEntries([{ date: detailDate, contents: [], photos: [], visibility: 'private', shared_team_ids: [], shared_user_ids: [], isNew: true }]);
      setDetailIdx(0);
      setEdit(blankEdit());
      lastEditSaved.current = '';
      setEditNote(<>이 날의 기록을 비웠습니다.<br/> 언제든 다시 담아 주세요.</>);
    } else {
      setDetailEntries(next);
      const newIdx = Math.min(detailIdx, next.length - 1);
      setDetailIdx(newIdx);
      const e = next[newIdx];
      setEdit({
        items: toEditItems(e.contents),
        emotion: e.emotion || '',
        vis: classify(e.visibility, e.shared_team_ids),
        teamIds: e.shared_team_ids || [],
        sharedUsers: (e.shared_user_ids || []).map((id) => ({ id, display_id: '…' })),
      });
    }
  }

  // 자동 저장 (3초)
  useEffect(() => {
    if (!edit || activeDetail?.isNew) return;
    if (snapEdit(edit) === lastEditSaved.current) return;
    const t = setTimeout(() => (editEmpty ? removeEntry() : saveEdit(true)), 3000);
    return () => clearTimeout(t);
  });

  useEffect(() => {
    if (!userQuery.trim() || !edit) { setUserResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, display_id')
        .ilike('display_id', `%${userQuery.trim()}%`).neq('id', uid).limit(8);
      setUserResults(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [userQuery, uid, edit]);

  // 상세 스크롤 snap 감지
  function onDetailScroll() {
    const el = detailScrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.offsetWidth);
    if (idx !== detailIdx && idx >= 0 && idx < detailEntries.length) {
      switchDetailEntry(idx);
    }
  }

  function scrollDetailTo(idx) {
    switchDetailEntry(idx);
    setTimeout(() => {
      if (detailScrollRef.current) {
        detailScrollRef.current.scrollTo({ left: idx * detailScrollRef.current.offsetWidth, behavior: 'smooth' });
      }
    }, 30);
  }

  return (
    <>
      <header className="top no-print">
        <h1>감사 캘린더</h1>
        <span className="date">{streak > 0 ? `🔥 ${streak}일 연속` : ''}</span>
      </header>

      <section className="card fade-in no-print">
        <div className="calhead">
          <button aria-label="이전 달" onClick={() => setYm(([y, m]) => (m === 0 ? [y - 1, 11] : [y, m - 1]))}><Icon name="chevronLeft" size={18} /></button>
          <h3>{year}년 {month + 1}월</h3>
          <button aria-label="다음 달" onClick={() => setYm(([y, m]) => (m === 11 ? [y + 1, 0] : [y, m + 1]))}><Icon name="chevronRight" size={18} /></button>
        </div>
        <div className="cal">
          {WDAYS.map((w) => <div className="wd" key={w}>{w}</div>)}
          {Array.from({ length: first.getDay() }).map((_, i) => <div key={`b${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const d = `${monthKey}-${String(i + 1).padStart(2, '0')}`;
            const dayEntries = byDate[d] || [];
            const e = dayEntries[0];
            return (
              <button className={`day ${d === todayStr() ? 'today' : ''}`} key={d}
                onClick={() => openDetail(d)}>
                {e ? (
                  <>
                    <span className="e"><Emo name={e.emotion} size="1.7rem" /></span>
                    {dayEntries.length > 1 && (
                      <span className="entry-count-badge">{dayEntries.length}</span>
                    )}
                  </>
                ) : <span>{i + 1}</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card fade-in no-print">
        <div className="stats">
          <div className="stat"><div className="num">{countItems(monthEntries)}</div><div className="lbl">이번 달 감사</div></div>
          <div className="stat"><div className="num">{countItems(yearEntries)}</div><div className="lbl">{String(year).slice(2)}년도 전체 감사</div></div>
        </div>
        {dist.length > 0 && (
          <div className="dist">
            {dist.map((d) => (
              <div className="row" key={d.name}>
                <span style={{ width: 86 }}><Emo name={d.name} /> {d.name}</span>
                <div className="bar"><i style={{ width: `${(d.count / maxDist) * 100}%` }} /></div>
                <span className="cnt">{d.count}회</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {cells.length > 0 && (
        <section className="card fade-in no-print">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="section-title" style={{ margin: 0 }}>우리 셀의 이번 주</p>
            {cells.length > 1 && (
              <div style={{ position: 'relative' }}>
                <button className="btn subtle small" onClick={() => setCellOpen(!cellOpen)}
                  aria-label="셀 선택" aria-haspopup="listbox"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', minHeight: 36 }}>
                  {cells.find((c) => c.id === cellId)?.name || '셀 선택'}
                  <Icon name="chevronDown" size={14} />
                </button>
                {cellOpen && (
                  <Overlay label="셀 선택" onClose={() => setCellOpen(false)}>
                    <div className="modal center" style={{ maxWidth: 300, padding: '20px 8px' }}
                      onClick={(e) => e.stopPropagation()}>
                      <p className="section-title" style={{ margin: '0 0 12px', textAlign: 'center' }}>셀을 선택해 주세요</p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {cells.map((c) => (
                          <button key={c.id}
                            className={`btn small ${c.id === cellId ? '' : 'subtle'}`}
                            style={{ width: '100%', justifyContent: 'center' }}
                            onClick={() => { setCellId(c.id); setCellOpen(false); }}>
                            {c.id === cellId && <Icon name="check" size={16} />}
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Overlay>
                )}
              </div>
            )}
          </div>
          {(() => {
            const total = week.reduce((n, m) => n + (m.dates?.length || 0), 0);
            const passed = weekDays.filter((d) => d <= todayStr());
            const everyone = week.length > 1
              && week.every((m) => passed.every((d) => m.dates?.includes(d)));
            return (
              <p className="tiny" style={{ marginBottom: 12 }}>
                {everyone
                  ? `우리 셀 모두가 하루도 빠짐없이 감사를 남겼어요 🎉 (100% 달성)`
                  : total > 0
                    ? `이번 주 우리 셀은 함께 ${total}번의 감사를 심었어요. 🌱`
                    : '이번 주의 첫 감사를 기다리고 있어요.'}
              </p>
            );
          })()}
          <div className="rows">
            {week.map((m) => (
              <div className="row" key={m.user_id} style={{ padding: '9px 2px' }}>
                <div className="main">
                  {m.display_id}{m.user_id === uid ? ' (나)' : ''}
                  {m.user_id !== uid && (m.dates?.length || 0) === 0 && (
                    <button className="likebtn" style={{ marginLeft: 8 }} disabled={nudged[m.user_id]}
                      onClick={() => sendNudge(m)}>
                      {nudged[m.user_id] ? '🙏 마음을 보냈어요' : '🙏 마음 보내기'}
                    </button>
                  )}
                </div>
                <div className="week-dots">
                  {weekDays.map((d) => (
                    <span key={d} className={`wdot ${m.dates?.includes(d) ? 'on' : ''} ${d === todayStr() ? 'today' : ''}`} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="tiny" style={{ marginTop: 10 }}>서로의 기록 여부만 보이며, 내용은 나눈 것만 볼 수 있어요.</p>
        </section>
      )}

      <button className="no-print fade-in" onClick={() => setExp(true)}
        style={{ background:'none', border:'none', color:'var(--gray)', fontSize:'var(--fs-xs)', cursor:'pointer', padding:'12px 0 4px', width:'100%', textAlign:'center', letterSpacing:'0.02em' }}>
        나의 감사 기록 내보내기
      </button>

      {exp && (
        <Overlay className="no-print" label="감사 기록 내보내기" onClose={() => setExp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 500, marginTop: 0 }}>감사 기록 내보내기</h3>
            <div style={{ display: 'flex', gap: 10 }}>
              <div className="field" style={{ flex: 1, minWidth: 0 }}><label>시작</label>
                <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></div>
              <div className="field" style={{ flex: 1, minWidth: 0 }}><label>끝</label>
                <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => window.print()}>PDF로 저장 (인쇄)</button>
              <button className="btn ghost small" onClick={download}>텍스트 파일</button>
            </div>
            <p className="tiny" style={{ marginTop: 8 }}>PDF는 인쇄 화면에서 'PDF로 저장'을 선택하면 됩니다.</p>
            <div className="spacer" />
            <button className="btn subtle small" onClick={() => setExp(false)}>닫기</button>
          </div>
        </Overlay>
      )}

      {/* 인쇄 전용 영역 */}
      <div className="print-only" style={{ display: 'none' }}>
        <style>{`@media print { .print-only { display: block !important; } }`}</style>
        <h2 style={{ fontWeight: 500 }}>감사 기록 · {range.from} ~ {range.to}</h2>
        {printSel.map((e) => (
          <div className="card" key={e.id || e.date}>
            <b>{fmtKoDate(e.date)}</b> — {e.emotion} <Emo name={e.emotion} />
            <ul className="entry-items">{(e.contents || []).map((c, i) => <li key={i}>{itemText(c)}</li>)}</ul>
          </div>
        ))}
      </div>

      {/* 상세 오버레이 */}
      {detailDate && edit && (
        <Overlay className="no-print" label="지난 기록" onClose={closeDetail}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="entry-head">
              <span className="who">{fmtKoDate(detailDate)}</span>
              <span className="when">
                {detailEntries.length > 1 && `${detailIdx + 1}/${detailEntries.length}`}
                {activeDetail?.pending ? ' · 동기화 대기' : ''}
              </span>
            </div>

            {/* 기록 인디케이터 dots */}
            <div className="entry-dots" style={{ paddingBottom: 8 }}>
              {detailEntries.map((_, i) => (
                <button key={i} className={`entry-dot${i === detailIdx ? ' on' : ''}`}
                  aria-label={`감사 ${i + 1}`} onClick={() => scrollDetailTo(i)} />
              ))}
              <span className="entry-dot add" aria-hidden="true" />
            </div>

            {/* 수평 스와이프 캐러셀 — 홈 페이지와 동일한 구조 */}
            <div className="detail-entry-scroll" ref={detailScrollRef} onScroll={onDetailScroll}>
              {detailEntries.map((entry, i) => (
                <div key={entry.id ?? i} className="detail-entry-page">
                  {i === detailIdx ? (
                    <>
                      <ItemsEditor items={edit.items} placeholder="그날, 어떤 순간이 감사했나요?"
                        onZoom={setZoom} onChange={(arr) => setEdit((ed) => ({ ...ed, items: arr }))} />
                      {activeDetail?.photos?.length > 0 && (
                        <div className="photos">
                          {activeDetail.photos.map((p) => (
                            <img key={p} src={photoUrl(p)} alt="" onClick={() => setZoom(photoUrl(p))} />
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="items" style={{ pointerEvents: 'none', opacity: 0.7 }}>
                      {toEditItems(entry.contents).filter((v) => v.text).map((v, j) => (
                        <div key={j} className="item">
                          <span className="dot">·</span>
                          <span style={{ flex: 1, wordBreak: 'break-word' }}>{v.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {/* 새 감사 추가 카드 */}
              <div className="detail-entry-page">
                <button className="entry-add-card" onClick={addDetailEntry} aria-label="새 감사 기록 추가">
                  <Icon name="plus" size={28} />
                  <span className="tiny" style={{ marginTop: 8, color: 'var(--sub)' }}>새 감사 추가</span>
                </button>
              </div>
            </div>

            <button type="button" className="emo-head" aria-expanded={emoOpen} style={{ marginTop: 16 }} onClick={() => setEmoOpen((o) => !o)}>
              <span className="section-title" style={{ margin: 0 }}>그날의 마음</span>
              <span className="emo-sel">
                {edit.emotion ? <><Emo name={edit.emotion} /> {edit.emotion}</> : '마음 고르기'} <Icon name={emoOpen ? 'chevronUp' : 'chevronDown'} size={14} />
              </span>
            </button>
            {emoOpen && (
              <div className="emotions" style={{ marginTop: 14 }}>
                {EMOTIONS.map((e) => (
                  <button key={e.name} className={edit.emotion === e.name ? 'on' : ''}
                    onClick={() => { setEdit((ed) => ({ ...ed, emotion: e.name })); setEmoOpen(false); }}>
                    <span className="e"><Emo name={e.name} size="2.4rem" /></span>
                    <span className="n">{e.name}</span>
                  </button>
                ))}
              </div>
            )}

            <p className="section-title" style={{ margin: '16px 0 8px' }}>함께 나누기</p>
            <div className="tabs vis" style={{ margin: 0, flexWrap: 'wrap' }}>
              {[['private', '나만 보기'], ['cell', '셀원들과 공유'], ['group', '나눔 공동체와 공유'], ['users', '개인 공유']].map(([v, l]) => (
                <button key={v} type="button" className={edit.vis === v ? 'on' : ''}
                  style={{ flex: '1 1 45%' }}
                  onClick={() => setEdit((ed) => ({ ...ed, vis: v }))}>{l}</button>
              ))}
            </div>
            {(edit.vis === 'cell' || edit.vis === 'group') && (
              <div style={{ marginTop: 14, textAlign: 'center' }}>
                <p className="tiny" style={{ margin: '4px 0 6px' }}>{edit.vis === 'cell' ? '현재 본인의 셀을 선택하세요.' : '나눔 공동체를 선택하세요.'}</p>
                {teams.filter((t) => t.kind === edit.vis).map((t) => {
                  const on = edit.teamIds.includes(t.id);
                  return (
                    <button key={t.id} type="button"
                      className={`team-chip ${on ? 'on' : ''}`}
                      onClick={() => setEdit((ed) => ({
                        ...ed,
                        teamIds: on ? ed.teamIds.filter((x) => x !== t.id) : [...ed.teamIds, t.id],
                      }))}>
                      {on ? '✓ ' : ''}{t.name}
                    </button>
                  );
                })}
                {!teams.some((t) => t.kind === edit.vis) && (
                  <p className="tiny" style={{ margin: '4px 0 0' }}>{edit.vis === 'cell' ? '아직 속한 셀이 없습니다.' : '아직 속한 나눔 공동체가 없습니다.'}</p>
                )}
              </div>
            )}
            {edit.vis === 'users' && (
              <div style={{ marginTop: 8 }}>
                <input type="text" placeholder="이름으로 검색" aria-label="공유할 사람 이름 검색" value={userQuery} onChange={(e) => setUserQuery(e.target.value)} />
                {userResults.map((u) => (
                  <button key={u.id} className="btn subtle small" style={{ margin: '6px 6px 0 0' }}
                    onClick={() => {
                      setEdit((ed) => (ed.sharedUsers.find((x) => x.id === u.id) ? ed : { ...ed, sharedUsers: [...ed.sharedUsers, u] }));
                      setUserQuery('');
                    }}>
                    + {u.display_id}
                  </button>
                ))}
                <div style={{ marginTop: 8 }}>
                  {edit.sharedUsers.map((u) => (
                    <span key={u.id} className="pill" style={{ marginRight: 6 }}>
                      {u.display_id}{' '}
                      <button className="del" aria-label={`${u.display_id} 빼기`}
                        onClick={() => setEdit((ed) => ({ ...ed, sharedUsers: ed.sharedUsers.filter((x) => x.id !== u.id) }))}><Icon name="x" size={12} /></button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {editNote && <p className="notice fade-in">{editNote}</p>}
            <div className="spacer" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 }}>
              <div>
                {!activeDetail?.isNew && detailEntries.length > 1 && (
                  <button className="btn subtle small" aria-label="삭제" onClick={async () => {
                    const ok = await appConfirm('이 감사 기록을 지울까요?');
                    if (ok) removeEntry();
                  }}><Icon name="trash" size={18} style={{ color: 'var(--alert)' }} /></button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {activeDetail?.isNew && <button className="btn small" onClick={() => saveEdit(false)}>감사 담기</button>}
                <button className="btn subtle small" onClick={closeDetail}>닫기</button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

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
