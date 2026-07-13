import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { photoUrl, supabase } from '../lib/supabase.js';
import { EMOTIONS, fmtKoDate, itemPhotos, itemText, todayStr } from '../lib/util.js';
import Emo from '../components/Emo.jsx';
import { appAlert, appConfirm, appPrompt } from '../components/Dialog.jsx';
import { filesToData, uploadPhotos } from '../lib/offline.js';
import ItemsEditor, { snapItems, toEditItems } from '../components/ItemsEditor.jsx';
import Lightbox from '../components/Lightbox.jsx';
import Avatar from '../components/Avatar.jsx';
import Icon from '../components/Icon.jsx';
import Overlay from '../components/Overlay.jsx';

export default function Feed() {
  const { session, teams, markFeedSeen } = useApp();
  const uid = session.user.id;
  const [posts, setPosts] = useState(null);
  const [tab, setTab] = useState('all');   // 'all' | 팀 id
  const [zoom, setZoom] = useState(null);  // 확대 보기 사진 URL
  const [pastOpen, setPastOpen] = useState(false);  // 지난 나눔 펼침
  const tabDefaulted = useRef(false);

  // 탭을 바꾸면 지난 나눔은 다시 접는다
  useEffect(() => { setPastOpen(false); }, [tab]);

  // 탭 순서: 전체 → 셀 → 나눔 공동체
  const sortedTeams = [...teams.filter((t) => t.kind === 'cell'), ...teams.filter((t) => t.kind !== 'cell')];

  // 소속 셀이 있으면 처음에 그 셀 탭을 기본 선택
  useEffect(() => {
    if (tabDefaulted.current) return;
    const firstCell = teams.find((t) => t.kind === 'cell');
    if (firstCell) {
      setTab(firstCell.id);
      tabDefaulted.current = true;
    }
  }, [teams]);
  const [editing, setEditing] = useState(null); // { post, items, emotion } — 내 글 수정
  const [editNote, setEditNote] = useState('');
  const [likers, setLikers] = useState(null);   // 좋아요 누른 사람 목록
  const lastEditSaved = useRef('');
  const snapEdit = (ed) => JSON.stringify({ items: snapItems(ed.items), emotion: ed.emotion });

  // 나눔 탭을 열면 새 나눔 배지를 지운다
  useEffect(() => { markFeedSeen(); }, [markFeedSeen]);

  const load = useCallback(async () => {
    // 나눔은 최근 7일까지만 (그 이전 기록은 각자의 캘린더에)
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const { data } = await supabase
      .from('entries')
      .select('*, profiles:user_id(display_id, avatar_url), likes(user_id, profiles:user_id(display_id))')
      .neq('visibility', 'private')
      .gte('date', todayStr(from))
      .order('date', { ascending: false })
      .limit(200);
    setPosts(data || []);
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  async function toggleLike(post) {
    const liked = post.likes.some((l) => l.user_id === uid);
    if (liked) {
      await supabase.from('likes').delete().eq('entry_id', post.id).eq('user_id', uid);
    } else {
      await supabase.from('likes').insert({ entry_id: post.id, user_id: uid });
      if (post.user_id !== uid) {
        await supabase.from('notifications').insert({
          user_id: post.user_id, type: 'like',
          payload: { entry_date: post.date, from: uid },
        });
      }
    }
    load();
  }

  async function report(post) {
    const reason = await appPrompt('신고 사유를 적어 주세요.');
    if (!reason?.trim()) return;
    await supabase.from('reports').insert({
      entry_id: post.id, reported_user_id: post.user_id,
      reporter_id: uid, reason: reason.trim(),
    });
    const { data: admins } = await supabase.from('profiles').select('id').eq('is_admin', true);
    if (admins?.length) {
      await supabase.from('notifications').insert(
        admins.map((a) => ({ user_id: a.id, type: 'report', payload: { entry_id: post.id, reason: reason.trim() } }))
      );
    }
    appAlert(<>신고가 접수되었습니다. <br/> 관리자가 살펴볼 예정입니다.</>);
  }

  // 내 게시물 수정 저장 (silent=true: 자동 저장)
  async function saveEdit(silent = false) {
    const cleaned = editing.items.filter((x) => x.text.trim() || x.photos.length || x.newFiles.length);
    if (!cleaned.length) { if (!silent) appAlert('감사한 일을 한 가지라도 적어 주세요.'); return; }
    // 항목별 새 사진 업로드 후 각 항목에 붙인다
    const newItems = [];
    for (const x of cleaned) {
      const paths = x.newFiles.length ? await uploadPhotos(uid, await filesToData(x.newFiles)) : [];
      newItems.push({ text: x.text.trim(), photos: [...x.photos, ...paths], newFiles: [] });
    }
    const contents = newItems.map((x) => ({ text: x.text, photos: x.photos }));
    const { error } = await supabase.from('entries')
      .update({ contents, emotion: editing.emotion, updated_at: new Date().toISOString() })
      .eq('id', editing.post.id);
    if (error) { if (!silent) appAlert(error.message); return; }
    setEditing((ed) => (ed ? { ...ed, items: newItems } : ed));
    lastEditSaved.current = snapEdit({ ...editing, items: newItems });
    setEditNote('자동으로 저장되었습니다.');
    load();
  }

  // 수정 중 손을 멈추면 3초 후 자동 저장
  useEffect(() => {
    if (!editing) return;
    if (snapEdit(editing) === lastEditSaved.current) return;
    const t = setTimeout(() => saveEdit(true), 3000);
    return () => clearTimeout(t);
  });

  // 닫을 때 남은 변경분을 조용히 저장하고 닫기
  async function closeEditing() {
    if (editing && snapEdit(editing) !== lastEditSaved.current) await saveEdit(true);
    setEditing(null);
    setEditNote('');
  }

  // 내 게시물 삭제 (그날의 기록 전체가 지워진다)
  async function removePost(post) {
    if (!(await appConfirm(`${fmtKoDate(post.date)}의 감사 기록을 삭제할까요?\n되돌릴 수 없습니다.`))) return;
    const { error } = await supabase.from('entries').delete().eq('id', post.id);
    if (error) { appAlert(error.message); return; }
    load();
  }

  async function block(post) {
    if (!(await appConfirm(`${post.profiles?.display_id} 님을 차단할까요?\n서로의 기록이 보이지 않게 됩니다.`))) return;
    await supabase.from('blocks').insert({ blocker_id: uid, blocked_id: post.user_id });
    load();
  }

  const shown = (posts || []).filter((p) =>
    tab === 'all' ? true : (p.shared_team_ids || []).includes(tab)
  );
  // 당일 나눔이 우선, 지난 나눔은 접어둔다
  const todayPosts = shown.filter((p) => p.date === todayStr());
  const pastPosts = shown.filter((p) => p.date !== todayStr());

  const postCard = (p) => (
    <article className="card fade-in" key={p.id}>
      <div className="entry-head" style={{ justifyContent: 'flex-start', gap: 10 }}>
        <Avatar profile={p.profiles} size={38} plain />
        <span className="who">
          {p.user_id === uid ? `${p.profiles?.display_id} (나)` : p.profiles?.display_id || '알 수 없음'}
          <span className="entry-emotion" style={{ marginLeft: 8 }}><Emo name={p.emotion} /> {p.emotion}</span>
          <span className="tiny" style={{ display: 'block', marginTop: 2 }}>{fmtKoDate(p.date)}</span>
        </span>
      </div>
      <ul className="entry-items">
        {(p.contents || []).map((c, i) => (
          <li key={i}>
            {itemText(c)}
            {itemPhotos(c).length > 0 && (
              <div className="photos" style={{ marginTop: 6 }}>
                {itemPhotos(c).map((ph) => (
                  <img key={ph} src={photoUrl(ph)} alt="" onClick={() => setZoom(photoUrl(ph))} />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {p.photos?.length > 0 && (
        <div className="photos">
          {p.photos.map((ph) => (
            <img key={ph} src={photoUrl(ph)} alt="" onClick={() => setZoom(photoUrl(ph))} />
          ))}
        </div>
      )}
      <div className="entry-foot">
        <button className={`likebtn ${p.likes.some((l) => l.user_id === uid) ? 'on' : ''}`}
          aria-pressed={p.likes.some((l) => l.user_id === uid)} aria-label="마음 전하기"
          onClick={() => toggleLike(p)}>
          <Icon name="heart" size={16} filled={p.likes.some((l) => l.user_id === uid)} />
          {p.likes.length === 0 ? ' 마음 전하기' : ''}
        </button>
        {p.likes.length > 0 && (
          <button className="likebtn" style={{ marginLeft: -4 }}
            onClick={() => setLikers(p.likes.map((l) => l.profiles?.display_id || '누군가'))}>
            {p.likes.length}명이 마음을 전했어요
          </button>
        )}
        <span style={{ flex: 1 }} />
        {p.user_id === uid ? (
          <>
            <button className="likebtn"
              onClick={() => {
                const init = { post: p, items: toEditItems(p.contents), emotion: p.emotion };
                setEditing(init);
                setEditNote('');
                lastEditSaved.current = snapEdit(init);
              }}>
              수정
            </button>
            <button className="likebtn" onClick={() => removePost(p)}>삭제</button>
          </>
        ) : (
          <>
            <button className="likebtn" onClick={() => report(p)}>신고</button>
            <button className="likebtn" onClick={() => block(p)}>차단</button>
          </>
        )}
      </div>
    </article>
  );

  return (
    <>
      <header className="top">
        <h1>감사 나눔</h1>
      </header>
      {teams.length > 0 && (
        <div className="tabs scroll no-print">
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>전체</button>
          {sortedTeams.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.name}</button>
          ))}
        </div>
      )}
      {posts === null && <p className="muted center">불러오는 중…</p>}
      {posts !== null && shown.length === 0 && (
        <div className="card center fade-in">
          <p className="muted">아직 나눈 감사가 없습니다.<br />셀에 함께하거나, 오늘의 감사를 나눠보세요.</p>
        </div>
      )}

      {/* 오늘의 나눔 */}
      {todayPosts.map(postCard)}
      {posts !== null && todayPosts.length === 0 && pastPosts.length > 0 && (
        <div className="card center fade-in">
          <p className="muted">오늘 나눈 감사가 아직 없어요.<br />가장 먼저 오늘의 감사를 나눠보세요.</p>
        </div>
      )}

      {/* 지난 나눔 — 최근 7일, 접어두기 */}
      {pastPosts.length > 0 && (
        <button className="btn subtle small" style={{ display: 'block', margin: '14px auto' }}
          onClick={() => setPastOpen((o) => !o)}>
          {pastOpen ? '지난 나눔 접기' : `지난 7일의 나눔 ${pastPosts.length}개 보기`} <Icon name={pastOpen ? 'chevronUp' : 'chevronDown'} size={14} />
        </button>
      )}
      {pastOpen && pastPosts.map(postCard)}

      {editing && (
        <Overlay label="나눈 감사 수정" onClose={closeEditing}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="entry-head">
              <span className="who">{fmtKoDate(editing.post.date)}</span>
              <span className="when">{editing.emotion ? <>{editing.emotion} <Emo name={editing.emotion} /></> : ''}</span>
            </div>
            <ItemsEditor items={editing.items} onZoom={setZoom}
              onChange={(arr) => setEditing((ed) => ({ ...ed, items: arr }))} />
            <div className="emotions" style={{ marginTop: 14 }}>
              {EMOTIONS.map((e) => (
                <button key={e.name} className={editing.emotion === e.name ? 'on' : ''}
                  onClick={() => setEditing((ed) => ({ ...ed, emotion: e.name }))}>
                  <span className="e"><Emo name={e.name} size="2.4rem" /></span>
                  <span className="n">{e.name}</span>
                </button>
              ))}
            </div>
            {editNote && <p className="notice fade-in">{editNote}</p>}
            <div className="spacer" />
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 1 }} />
              <button className="btn subtle small" onClick={closeEditing}>닫기</button>
            </div>
          </div>
        </Overlay>
      )}

      {likers && (
        <Overlay label="마음을 전한 사람들" onClose={() => setLikers(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontWeight: 500, marginTop: 0 }}>마음을 전한 사람들 ♥</h3>
            <div className="rows">
              {likers.map((name, i) => (
                <div className="row" key={i}>
                  <div className="main">{name}</div>
                </div>
              ))}
            </div>
            <div className="spacer" />
            <button className="btn subtle small" onClick={() => setLikers(null)}>닫기</button>
          </div>
        </Overlay>
      )}

      <Lightbox src={zoom} onClose={() => setZoom(null)} />
    </>
  );
}
