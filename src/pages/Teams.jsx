import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { supabase } from '../lib/supabase.js';
import { appAlert, appConfirm } from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';
import Overlay from '../components/Overlay.jsx';

const KIND_KO = { cell: '셀', group: '나눔 공동체' };

export default function Teams() {
  const { session, profile, teams, loadTeams } = useApp();
  const uid = session.user.id;
  const canLeadCell = Boolean(profile?.is_cell_leader || profile?.is_admin);
  const [kind, setKind] = useState(canLeadCell ? 'cell' : 'group');

  // 프로필이 늦게 로드된 경우에도 셀리더면 '셀'을 기본 선택
  useEffect(() => { if (canLeadCell) setKind('cell'); }, [canLeadCell]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [open, setOpen] = useState(null);       // 선택된 공동체
  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  const loadMembers = useCallback(async (team) => {
    const { data } = await supabase.from('team_members')
      .select('user_id, status, profiles:user_id(display_id)')
      .eq('team_id', team.id).in('status', ['invited', 'accepted']);
    const { data: leader } = await supabase.from('profiles').select('display_id').eq('id', team.leader_id).single();
    setMembers([
      { user_id: team.leader_id, status: 'leader', profiles: leader },
      ...(data || []).filter((m) => m.user_id !== team.leader_id),
    ]);
  }, []);

  useEffect(() => { if (open) loadMembers(open); }, [open, loadMembers]);

  // 이름 검색 (초대) — 쉼표/공백으로 여러 명 동시 검색 가능
  useEffect(() => {
    const terms = query.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!terms.length || !open) { setResults([]); return; }
    const t = setTimeout(async () => {
      const orExpr = terms.map((s) => `display_id.ilike.%${s}%`).join(',');
      const { data } = await supabase.from('profiles').select('id, display_id')
        .or(orExpr).limit(20);
      const existing = new Set(members.map((m) => m.user_id));
      setResults((data || []).filter((u) => !existing.has(u.id)));
    }, 300);
    return () => clearTimeout(t);
  }, [query, open, members]);

  async function createTeam() {
    if (!name.trim()) return;
    setCreating(true);
    setErrMsg('');
    try {
      let nm = name.trim();
      if (kind === 'cell' && !nm.endsWith('셀')) nm += '셀';  // 셀 이름은 '~셀'로 통일
      const { error } = await supabase.from('teams')
        .insert({ name: nm, leader_id: uid, kind });
      if (error) throw error;
      setName('');
      await loadTeams();
    } catch (e) {
      setErrMsg(e.message || '방을 만드는 데 어려움이 있었습니다. 잠시 후 다시 시도해 주세요.');
    }
    setCreating(false);
  }

  async function invite(user) {
    const { error } = await supabase.from('team_members')
      .upsert({ team_id: open.id, user_id: user.id, status: 'invited' });
    if (error) { appAlert(error.message); return; }
    await supabase.from('notifications').insert({
      user_id: user.id, type: 'team_invite',
      payload: { team_id: open.id, team_name: open.name },
    });
    // 검색어는 유지 — 초대된 사람만 결과에서 빠져 여러 명을 이어서 초대할 수 있다
    setResults((rs) => rs.filter((u) => u.id !== user.id));
    loadMembers(open);
  }

  const word = (t) => KIND_KO[t?.kind] || '공동체';

  async function remove(member) {
    if (member.status === 'invited') {
      // 초대 취소 — 1분 이내면 상대방 알림도 조용히 회수 (서버 함수)
      if (!(await appConfirm(`${member.profiles?.display_id} 님에게 보낸 초대를 거둘까요?`))) return;
      const { error } = await supabase.rpc('cancel_team_invite', {
        p_team_id: open.id, p_user_id: member.user_id,
      });
      if (error) { appAlert(error.message); return; }
    } else {
      if (!(await appConfirm(`${member.profiles?.display_id} 님을 ${word(open)}에서 내보낼까요?`))) return;
      await supabase.from('team_members')
        .update({ status: 'removed' }).eq('team_id', open.id).eq('user_id', member.user_id);
    }
    loadMembers(open);
  }

  async function leave(team) {
    if (!(await appConfirm(`${team.name}에서 나갈까요?`))) return;
    await supabase.from('team_members').delete().eq('team_id', team.id).eq('user_id', uid);
    setOpen(null);
    loadTeams();
  }

  async function disband(team) {
    if (!(await appConfirm(`${team.name}을(를) 없앨까요?\n되돌릴 수 없습니다.`))) return;
    await supabase.from('teams').delete().eq('id', team.id);
    setOpen(null);
    loadTeams();
  }

  const isLeader = open && open.leader_id === uid;

  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');

  function startEditName() {
    setEditName(open.name);
    setEditingName(true);
  }

  async function saveName() {
    const nm = editName.trim();
    if (!nm || nm === open.name) { setEditingName(false); return; }
    const { error } = await supabase.from('teams').update({ name: nm }).eq('id', open.id);
    if (error) { appAlert(error.message); return; }
    setOpen((prev) => ({ ...prev, name: nm }));
    await loadTeams();
    setEditingName(false);
  }

  return (
    <>
      <header className="top"><h1>감사 나눔 공동체</h1></header>

      <section className="card fade-in">
        <p className="section-title" style={{ margin: '0 0 10px' }}>
          {canLeadCell ? '새로 만들기' : '새로운 나눔 공동체 만들기'}
        </p>
        {canLeadCell && (
          <div className="tabs" style={{ margin: '0 0 10px' }}>
            {[['cell', '셀'], ['group', '나눔 공동체']].map(([v, l]) => (
              <button key={v} type="button" className={kind === v ? 'on' : ''} onClick={() => setKind(v)}>{l}</button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="text" aria-label="공동체 이름" className="team-name-input"
            placeholder={kind === 'cell' && canLeadCell ? '셀 이름 (예: 인터치셀)' : '나눔 공동체 이름을 정해보세요'}
            value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn small ink" onClick={createTeam} disabled={creating}>
            {creating ? '만드는 중…' : '만들기'}
          </button>
        </div>
        <p className="tiny" style={{ marginTop: 8 }}>
          {canLeadCell
            ? '셀은 교회에서 정해진 모임, 나눔 공동체는 자유로운 모임입니다.'
            : <>셀 개설은 셀리더에게 권한이 있습니다.<br />셀 외에도 나눔 공동체를 만들어 감사를 공유해보세요.</>}
        </p>
        {errMsg && <p className="error">{errMsg}</p>}
      </section>

      <section className="card fade-in">
        <p className="section-title" style={{ margin: '0 0 14px' }}>나의 공동체</p>
        {teams.length === 0 && <p className="muted">아직 속한 공동체가 없습니다.</p>}
        <div className="team-list">
          {teams.map((t) => (
            <button type="button" className="team-item" key={t.id} onClick={() => setOpen(t)}>
              <span className="team-info">
                <span className="team-name">{t.name}</span>
                <span className="team-meta">
                  <span className={`pill ${t.kind === 'cell' ? 'pill-cell' : 'pill-group'}`}>{KIND_KO[t.kind] || '공동체'}</span>
                  <span className="role-tag">{t.role}</span>
                </span>
              </span>
              <Icon name="chevronRight" size={18} style={{ color: 'var(--gray)' }} />
            </button>
          ))}
        </div>
      </section>

      {open && (
        <Overlay label="공동체 정보" onClose={() => setOpen(null)}>
          <div className="modal team-modal" onClick={(e) => e.stopPropagation()}>
            {/* 헤더 */}
            <div className="tm-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                {editingName ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                    <input
                      type="text"
                      aria-label="공동체 이름 수정"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                      autoFocus
                      style={{ flex: 1, fontSize: 'var(--fs-md)' }}
                    />
                    <button className="btn small ink" onClick={saveName}>저장</button>
                    <button className="btn small" onClick={() => setEditingName(false)}>취소</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <h3 className="tm-title" style={{ margin: 0 }}>{open.name}</h3>
                    {isLeader && (
                      <button onClick={startEditName} aria-label="공동체 이름 수정"
                        style={{ background: 'none', border: 'none', padding: '4px', cursor: 'pointer', color: 'var(--gray)', lineHeight: 1 }}>
                        <Icon name="edit" size={16} />
                      </button>
                    )}
                  </div>
                )}
                <span className={`pill ${open.kind === 'cell' ? 'pill-cell' : 'pill-group'}`}>{word(open)}</span>
              </div>
              <button className="tm-close" onClick={() => setOpen(null)} aria-label="닫기">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* 멤버 목록 */}
            <p className="section-title" style={{ margin: '20px 0 10px' }}>멤버</p>
            <div className="tm-members">
              {members.map((m) => {
                const role = m.status === 'leader'
                  ? (open.kind === 'cell' ? '셀리더' : '모임지기')
                  : m.status === 'invited' ? '초대 중' : '함께하는 중';
                const isLead = m.status === 'leader';
                return (
                  <div className="tm-member" key={m.user_id}>
                    <div className={`tm-avatar ${isLead ? 'lead' : ''}`}>
                      {(m.profiles?.display_id || '?')[0]}
                    </div>
                    <div className="tm-member-info">
                      <span className="tm-member-name">{m.profiles?.display_id || '알 수 없음'}</span>
                      <span className="tm-member-role">{role}</span>
                    </div>
                    {isLeader && !isLead && (
                      <button className="btn danger small" onClick={() => remove(m)}>내보내기</button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 초대 */}
            {isLeader && (
              <div className="tm-invite">
                <p className="section-title" style={{ margin: '0 0 10px' }}>초대하기</p>
                <input type="text" placeholder="이름을 검색해 보세요 (쉼표로 여러 명)" aria-label="초대할 사람 이름 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
                {results.length > 0 && (
                  <div className="tm-results">
                    {results.map((u) => (
                      <button key={u.id} className="tm-result-btn" onClick={() => invite(u)}>
                        <span className="tm-avatar sm">{u.display_id[0]}</span>
                        {u.display_id}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 하단 액션 */}
            <div className="tm-footer">
              {isLeader
                ? <button className="btn danger small" onClick={() => disband(open)}>{word(open)} 삭제</button>
                : <button className="btn danger small" onClick={() => leave(open)}>나가기</button>}
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}
