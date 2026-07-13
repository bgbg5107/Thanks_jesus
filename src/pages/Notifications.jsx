import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { supabase } from '../lib/supabase.js';
import { appAlert } from '../components/Dialog.jsx';

const LABEL = {
  team_invite: '공동체 초대',
  invite_accepted: '초대 수락',
  like: '좋아요',
  nudge: '셀의 마음',
  cell_week: '우리 셀 소식',
  report: '신고 접수',
  admin: '관리자 알림',
};

export default function Notifications() {
  const { session, profile, loadUnread } = useApp();
  const uid = session.user.id;
  const [items, setItems] = useState(null);
  // 진입 시점의 미읽음 ID를 기억 — 읽음 처리 후에도 시각적으로 구분 유지
  const unreadIdsRef = useRef(new Set());

  const load = useCallback(async () => {
    const { data } = await supabase.from('notifications').select('*')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(50);
    return data || [];
  }, [uid]);

  // 알림 탭 진입: 목록 로드 → 2초 뒤 읽음 처리 (미읽음 상태를 먼저 확인할 수 있도록)
  useEffect(() => {
    let timer;
    (async () => {
      const data = await load();
      // 최초 진입 시만 미읽음 ID 기록
      if (unreadIdsRef.current.size === 0) {
        data.filter((n) => !n.read).forEach((n) => unreadIdsRef.current.add(n.id));
      }
      setItems(data);

      timer = setTimeout(async () => {
        await supabase.from('notifications').update({ read: true })
          .eq('user_id', uid).eq('read', false);
        loadUnread();
      }, 2000);
    })();
    return () => clearTimeout(timer);
  }, [load, uid, loadUnread]);

  async function respondInvite(n, accept) {
    const { error } = await supabase.from('team_members')
      .update({ status: accept ? 'accepted' : 'rejected' })
      .eq('team_id', n.payload.team_id).eq('user_id', uid).eq('status', 'invited');
    if (error) { appAlert(error.message); return; }
    await supabase.from('notifications').update({ read: true, payload: { ...n.payload, responded: accept ? '수락' : '거절' } }).eq('id', n.id);
    // 수락하면 초대한 리더에게 소식 전하기
    if (accept) {
      const { data: t } = await supabase.from('teams')
        .select('leader_id, name').eq('id', n.payload.team_id).single();
      if (t) {
        await supabase.from('notifications').insert({
          user_id: t.leader_id, type: 'invite_accepted',
          payload: { team_name: t.name, member: profile?.display_id || '새 멤버' },
        });
      }
    }
    unreadIdsRef.current.delete(n.id);
    setItems(await load()); loadUnread();
  }

  function text(n) {
    if (n.type === 'team_invite') return `'${n.payload.team_name}'에서 당신을 초대했습니다.`;
    if (n.type === 'invite_accepted') return `${n.payload.member} 님이 '${n.payload.team_name}'에 함께하게 되었습니다.`;
    if (n.type === 'nudge') return `${n.payload.from} 님이 당신의 감사 이야기를 조용히 기다리고 있어요. 🙏`;
    if (n.type === 'like') return `${n.payload.entry_date}의 감사에 누군가 마음을 전했습니다. ♥`;
    if (n.type === 'report') return `신고가 접수되었습니다: ${n.payload.reason || ''}`;
    return n.payload?.message || '알림';
  }

  const isUnread = (n) => unreadIdsRef.current.has(n.id);
  const isAdmin = (n) => n.type === 'admin' || n.type === 'report';

  return (
    <>
      <header className="top"><h1>알림</h1></header>
      {items === null && <p className="muted center">불러오는 중…</p>}
      {items?.length === 0 && (
        <div className="card center fade-in"><p className="muted">아직 도착한 소식이 없습니다.</p></div>
      )}
      {items?.map((n) => (
        <div className={`card noti-card fade-in${isUnread(n) ? ' unread' : ' read'}${isAdmin(n) ? ' admin-noti' : ''}`} key={n.id}>
          <div className="entry-head">
            <span className="who" style={{ display: 'flex', alignItems: 'center' }}>
              {isUnread(n) && <span className="noti-dot" />}
              {isAdmin(n)
                ? <span className="noti-label-admin">{LABEL[n.type] || '알림'}</span>
                : (LABEL[n.type] || '알림')}
            </span>
            <span className="when">{new Date(n.created_at).toLocaleString('ko-KR')}</span>
          </div>
          <p style={{ margin: '4px 0', whiteSpace: 'pre-line' }}>{text(n)}</p>
          {n.type === 'team_invite' && !n.payload.responded && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn small" onClick={(e) => { e.stopPropagation(); respondInvite(n, true); }}>수락</button>
              <button className="btn subtle small" onClick={(e) => { e.stopPropagation(); respondInvite(n, false); }}>거절</button>
            </div>
          )}
          {n.payload?.responded && <span className="pill">{n.payload.responded}함</span>}
        </div>
      ))}
    </>
  );
}
