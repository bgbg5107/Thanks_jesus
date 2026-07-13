import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../App.jsx';
import { supabase } from '../lib/supabase.js';
import { itemText } from '../lib/util.js';
import { appAlert, appConfirm, appPrompt } from '../components/Dialog.jsx';
import Icon from '../components/Icon.jsx';

/* ── 상대 시간 ───────────────────────────────────────────── */
function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export default function Admin() {
  const { profile } = useApp();
  const [tab, setTab] = useState('dashboard');
  const [reports, setReports] = useState([]);
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');

  /* 대시보드 메트릭 */
  const [todayActive, setTodayActive] = useState(0);
  const [cellCount, setCellCount] = useState(0);

  /* 신고 필터 */
  const [reportFilter, setReportFilter] = useState('open');
  /* 유저 필터 */
  const [userFilter, setUserFilter] = useState('all');

  /* 셀 현황 (기간 선택) */
  const now = new Date();
  const monthFirst = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const [statRange, setStatRange] = useState({ from: monthFirst, to: todayIso });
  const [stats, setStats] = useState(null);
  const [cellQuery, setCellQuery] = useState('');

  /* 셀 관리 */
  const [cellList, setCellList] = useState(null);
  const [cellMgmtQuery, setCellMgmtQuery] = useState('');
  const [expandedCell, setExpandedCell] = useState(null);
  const [cellSubTab, setCellSubTab] = useState('stats');

  /* 유저 알림 이력 */
  const [expandedUser, setExpandedUser] = useState(null);
  const [userNotifs, setUserNotifs] = useState([]);

  /* ── 데이터 로드 ──────────────────────────────────────── */
  useEffect(() => {
    if (tab !== 'stats') return;
    supabase.rpc('admin_team_stats', { p_from: statRange.from, p_to: statRange.to })
      .then(({ data }) => setStats(data || []));
  }, [tab, statRange, cellSubTab]);

  const load = useCallback(async () => {
    const { data: r } = await supabase.from('reports')
      .select('*, reporter:reporter_id(display_id), reported:reported_user_id(display_id), entries:entry_id(date, contents, user_id)')
      .order('created_at', { ascending: false }).limit(100);
    setReports(r || []);
    const { data: u } = await supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(500);
    setUsers(u || []);
  }, []);

  /* 대시보드 추가 메트릭 */
  const loadDashMetrics = useCallback(async () => {
    const { count: active } = await supabase.from('entries')
      .select('id', { count: 'exact', head: true }).eq('date', todayIso);
    setTodayActive(active || 0);
    const { count: cells } = await supabase.from('teams')
      .select('id', { count: 'exact', head: true }).eq('kind', 'cell');
    setCellCount(cells || 0);
  }, [todayIso]);

  /* 셀 관리 목록 */
  const loadCells = useCallback(async () => {
    const { data } = await supabase.from('teams')
      .select('*, leader:leader_id(display_id), team_members(user_id, status, profiles(display_id))')
      .eq('kind', 'cell').order('created_at', { ascending: false });
    setCellList(data || []);
  }, []);

  useEffect(() => { load(); loadDashMetrics(); }, [load, loadDashMetrics]);
  useEffect(() => { if (tab === 'stats' && cellSubTab === 'manage') loadCells(); }, [tab, cellSubTab, loadCells]);

  if (!profile?.is_admin) return null;

  /* ── 신고 처리 ──────────────────────────────────────── */
  async function setReport(r, status) {
    await supabase.from('reports').update({ status }).eq('id', r.id);
    load();
  }

  async function deleteEntry(r) {
    if (!r.entry_id) return;
    if (!(await appConfirm('해당 게시물을 삭제할까요?'))) return;
    await supabase.from('entries').delete().eq('id', r.entry_id);
    await setReport(r, 'deleted');
  }

  async function warn(r) {
    const target = r.reported_user_id || r.entries?.user_id;
    if (!target) return;
    await supabase.from('notifications').insert({
      user_id: target, type: 'admin',
      payload: { message: '커뮤니티 가이드에 어긋나는 활동으로 경고가 접수되었습니다.\n서로를 아끼는 공간이 되도록 함께해 주세요.' },
    });
    await setReport(r, 'warned');
  }

  /* ── 유저 관리 ──────────────────────────────────────── */
  async function toggleSuspend(u) {
    const next = u.status === 'suspended' ? 'active' : 'suspended';
    if (!(await appConfirm(`${u.display_id} 님을 ${next === 'suspended' ? '이용 정지' : '정지 해제'}할까요?`))) return;
    await supabase.from('profiles').update({ status: next }).eq('id', u.id);
    load();
  }

  async function toggleCellLeader(u) {
    const next = !u.is_cell_leader;
    if (!(await appConfirm(`${u.display_id} 님에게 셀리더 권한을 ${next ? '드릴까요' : '거둘까요'}?`))) return;
    const { error } = await supabase.from('profiles').update({ is_cell_leader: next }).eq('id', u.id);
    if (error) { appAlert(error.message); return; }
    if (next) {
      await supabase.from('notifications').insert({
        user_id: u.id, type: 'admin',
        payload: { message: '셀리더로 지정되었습니다.\n이제 공동체 탭에서 셀을 만들고 섬길 수 있습니다.' },
      });
    }
    load();
  }

  async function deleteUser(u) {
    if (u.is_admin) { appAlert('관리자 계정은 삭제할 수 없습니다.'); return; }
    if (!(await appConfirm(`${u.display_id} 님의 계정을 영구적으로 삭제할까요?\n모든 기록과 데이터가 함께 사라집니다.`))) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: u.id });
    if (error) { appAlert(error.message); return; }
    appAlert(`${u.display_id} 님의 계정이 삭제되었습니다.`);
    load(); loadDashMetrics();
  }

  async function sendNotification(u) {
    const msg = await appPrompt(`${u.display_id} 님에게 보낼 알림 내용을 입력해 주세요.`);
    if (!msg) return;
    const { error } = await supabase.from('notifications').insert({
      user_id: u.id, type: 'admin',
      payload: { message: msg },
    });
    if (error) { appAlert(error.message); return; }
    appAlert('알림을 보냈습니다.');
  }

  async function sendReset(u) {
    const email = await appPrompt(`${u.display_id} 님의 이메일을 입력하면\n재설정 링크를 보냅니다.`);
    if (!email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    appAlert(error ? error.message : '재설정 링크를 보냈습니다.');
  }

  async function loadUserNotifs(u) {
    if (expandedUser === u.id) { setExpandedUser(null); return; }
    setExpandedUser(u.id);
    const { data } = await supabase.from('notifications')
      .select('*').eq('user_id', u.id).eq('type', 'admin')
      .order('created_at', { ascending: false }).limit(20);
    setUserNotifs(data || []);
  }

  /* 일괄 작업 */
  async function bulkSetCellLeader(targets, value) {
    const names = targets.map((u) => u.display_id).join(', ');
    const label = value ? '셀리더로 지정' : '셀리더 해제';
    if (!(await appConfirm(`${names}\n${targets.length}명을 ${label}할까요?`))) return;
    for (const u of targets) {
      await supabase.from('profiles').update({ is_cell_leader: value }).eq('id', u.id);
      if (value) {
        await supabase.from('notifications').insert({
          user_id: u.id, type: 'admin',
          payload: { message: '셀리더로 지정되었습니다.\n이제 공동체 탭에서 셀을 만들고 섬길 수 있습니다.' },
        });
      }
    }
    load();
  }

  async function bulkSuspend(targets) {
    const names = targets.map((u) => u.display_id).join(', ');
    if (!(await appConfirm(`${names}\n${targets.length}명을 이용 정지할까요?`))) return;
    for (const u of targets) {
      await supabase.from('profiles').update({ status: 'suspended' }).eq('id', u.id);
    }
    load();
  }

  /* ── 셀 관리 ────────────────────────────────────────── */
  async function renameCell(cell) {
    const newName = await appPrompt(`새 이름을 입력해 주세요.`, cell.name);
    if (!newName || newName === cell.name) return;
    const { error } = await supabase.from('teams').update({ name: newName }).eq('id', cell.id);
    if (error) { appAlert(error.message); return; }
    loadCells();
  }

  async function deleteCell(cell) {
    if (!(await appConfirm(`"${cell.name}" 셀을 삭제할까요?\n멤버 연결이 모두 해제됩니다.`))) return;
    const { error } = await supabase.from('teams').delete().eq('id', cell.id);
    if (error) { appAlert(error.message); return; }
    loadCells(); loadDashMetrics();
  }

  /* ── 파생 데이터 ────────────────────────────────────── */
  const STATUS_KO = { open: '접수됨', warned: '경고', suspended: '정지', deleted: '삭제', dismissed: '기각' };
  const openCount = reports.filter((r) => r.status === 'open').length;

  // 신고 필터
  const filteredReports = reports.filter((r) => {
    if (reportFilter === 'open') return r.status === 'open';
    if (reportFilter === 'resolved') return r.status !== 'open';
    return true;
  });

  // 유저 검색 + 역할 필터
  const terms = query.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const leaderCount = users.filter((u) => u.is_cell_leader).length;
  const filteredUsers = users
    .filter((u) => !terms.length || terms.some((t) => u.display_id.includes(t)))
    .filter((u) => {
      if (userFilter === 'leader') return u.is_cell_leader;
      if (userFilter === 'member') return !u.is_cell_leader && !u.is_admin;
      return true;
    });

  // 셀 통계
  const cellTerms = cellQuery.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const cells = (stats || [])
    .filter((s) => s.kind === 'cell')
    .filter((s) => !cellTerms.length || cellTerms.some((t) => s.name.includes(t)))
    .sort((a, b) => b.entry_count - a.entry_count);

  // 셀 관리 검색
  const cellMgmtTerms = cellMgmtQuery.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  const filteredCellList = (cellList || [])
    .filter((c) => !cellMgmtTerms.length || cellMgmtTerms.some((t) => c.name.includes(t)));

  return (
    <>
      <header className="top">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="shield" size={22} /> 관리자
        </h1>
        <button className="btn subtle small" onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </header>
      <div className="tabs">
        <button className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>한눈에</button>
        <button className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>
          신고 {openCount > 0 && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--pop)', fontWeight: 700 }}>({openCount})</span>}
        </button>
        <button className={tab === 'users' ? 'on' : ''} onClick={() => setTab('users')}>유저 관리</button>
        <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>공동체</button>
      </div>

      {/* ─── 대시보드 ─────────────────────────────────── */}
      {tab === 'dashboard' && (
        <>
          <div className="admin-metrics fade-in">
            <div className="admin-metric">
              <div className="am-num">{users.length}</div>
              <div className="am-label">전체 유저</div>
            </div>
            <div className="admin-metric">
              <div className="am-num">{todayActive}</div>
              <div className="am-label">오늘 감사한 분</div>
            </div>
            <div className={`admin-metric${openCount > 0 ? ' alert' : ''}`}>
              <div className="am-num">{openCount}</div>
              <div className="am-label">미처리 신고</div>
            </div>
            <div className="admin-metric">
              <div className="am-num">{cellCount}</div>
              <div className="am-label">셀</div>
            </div>
          </div>
          <div className="card fade-in">
            <div className="section-title" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>최근 미처리 신고</div>
            {openCount === 0 && (
              <p className="muted" style={{ textAlign: 'center', padding: '12px 0' }}>
                처리할 신고가 없습니다. 평안한 하루입니다.
              </p>
            )}
            {reports.filter((r) => r.status === 'open').slice(0, 3).map((r) => (
              <div className="dash-report-row" key={r.id}
                onClick={() => { setTab('reports'); setReportFilter('open'); }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500, fontSize: 'var(--fs-sm)' }}>
                    {r.reporter?.display_id} → {r.reported?.display_id}
                  </span>
                  <span className="tiny">{timeAgo(r.created_at)}</span>
                </div>
                <div className="tiny" style={{ marginTop: 2, color: 'var(--ink-soft)' }}>
                  {r.reason}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── 신고 처리 ────────────────────────────────── */}
      {tab === 'reports' && (
        <>
          <div className="admin-filters" style={{ padding: '0 16px' }}>
            <button className={reportFilter === 'open' ? 'on' : ''} onClick={() => setReportFilter('open')}>
              미처리{openCount > 0 ? ` (${openCount})` : ''}
            </button>
            <button className={reportFilter === 'resolved' ? 'on' : ''} onClick={() => setReportFilter('resolved')}>처리됨</button>
            <button className={reportFilter === 'all' ? 'on' : ''} onClick={() => setReportFilter('all')}>전체</button>
          </div>
          {filteredReports.length === 0 && (
            <div className="card center fade-in">
              <p className="muted">{reportFilter === 'open' ? '미처리 신고가 없습니다.' : '신고 내역이 없습니다.'}</p>
            </div>
          )}
          {filteredReports.map((r) => (
            <div className={`card fade-in report-card status-${r.status}`} key={r.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <span style={{ fontWeight: 500, fontSize: 'var(--fs-sm)' }}>
                  {r.reporter?.display_id} 님의 신고
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="tiny">{timeAgo(r.created_at)}</span>
                  <span className="pill" style={{ fontSize: 'var(--fs-xs)' }}>{STATUS_KO[r.status]}</span>
                </div>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)' }}>
                사유: <mark style={{ background: 'color-mix(in srgb, var(--pop) 20%, var(--card))', padding: '2px 8px', borderRadius: 6, color: 'var(--ink)' }}>{r.reason}</mark>
              </p>
              {r.reported && <p className="tiny" style={{ marginTop: 4 }}>대상: {r.reported.display_id}</p>}
              {r.entries && (
                <div className="report-preview">
                  게시물({r.entries.date}): {(r.entries.contents || []).map(itemText).join(' / ').slice(0, 120)}
                </div>
              )}
              {r.status === 'open' && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  <button className="btn subtle small" onClick={() => warn(r)}>경고</button>
                  {r.entry_id && <button className="btn danger small" onClick={() => deleteEntry(r)}>게시물 삭제</button>}
                  <button className="btn subtle small" onClick={() => setReport(r, 'dismissed')}>기각</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ─── 유저 관리 ────────────────────────────────── */}
      {tab === 'users' && (
        <>
          <div className="admin-filters" style={{ padding: '0 16px' }}>
            <button className={userFilter === 'all' ? 'on' : ''} onClick={() => setUserFilter('all')}>전체</button>
            <button className={userFilter === 'leader' ? 'on' : ''} onClick={() => setUserFilter('leader')}>셀리더 ({leaderCount})</button>
            <button className={userFilter === 'member' ? 'on' : ''} onClick={() => setUserFilter('member')}>일반</button>
          </div>
          <div className="card fade-in">
            <input type="text" placeholder="이름 검색 (쉼표로 여러 명 검색 가능)" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <span className="tiny" style={{ fontWeight: 500 }}>
                {terms.length ? `검색 결과 ${filteredUsers.length}명` : `전체 ${users.length}명`}
              </span>
              {terms.length > 0 && filteredUsers.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {filteredUsers.some((u) => !u.is_cell_leader) && (
                    <button className="btn small subtle" onClick={() => bulkSetCellLeader(filteredUsers.filter((u) => !u.is_cell_leader && !u.is_admin), true)}>
                      일괄 셀리더 지정
                    </button>
                  )}
                  {filteredUsers.some((u) => u.is_cell_leader) && (
                    <button className="btn small" onClick={() => bulkSetCellLeader(filteredUsers.filter((u) => u.is_cell_leader && !u.is_admin), false)}>
                      일괄 셀리더 해제
                    </button>
                  )}
                  {filteredUsers.some((u) => u.status !== 'suspended' && !u.is_admin) && (
                    <button className="btn small danger" onClick={() => bulkSuspend(filteredUsers.filter((u) => u.status !== 'suspended' && !u.is_admin))}>
                      일괄 정지
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="card fade-in">
            {filteredUsers.length === 0 && <p className="muted">검색 결과가 없습니다.</p>}
            {filteredUsers.map((u) => (
              <div className="admin-urow" key={u.id}>
                <div className="urow-head">
                  <span className={`status-dot ${u.status === 'suspended' ? 'suspended' : 'active'}`} />
                  <b style={{ fontWeight: 600 }}>{u.display_id}</b>
                  {u.is_admin && <span className="pill pill-admin">관리자</span>}
                  {u.is_cell_leader && <span className="pill pill-leader">셀리더</span>}
                  <span className="tiny" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    {new Date(u.created_at).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                <div className="urow-links">
                  <button className={u.is_cell_leader ? 'link-danger' : 'link-positive'} onClick={() => toggleCellLeader(u)}>
                    {u.is_cell_leader ? '셀리더 해제' : '셀리더 지정'}
                  </button>
                  <span className="sep" />
                  <button onClick={() => sendNotification(u)}>알림</button>
                  <span className="sep" />
                  <button onClick={() => sendReset(u)}>PW 링크</button>
                  <span className="sep" />
                  <button className={u.status === 'suspended' ? '' : 'link-danger'} onClick={() => toggleSuspend(u)}>
                    {u.status === 'suspended' ? '정지 해제' : '정지'}
                  </button>
                  {!u.is_admin && (
                    <>
                      <span className="sep" />
                      <button className="link-danger" onClick={() => deleteUser(u)}>삭제</button>
                    </>
                  )}
                  <span className="sep" />
                  <button onClick={() => loadUserNotifs(u)}>이력 {expandedUser === u.id ? '▴' : '▾'}</button>
                </div>
                {expandedUser === u.id && (
                  <div className="noti-history">
                    {userNotifs.length === 0 && <p className="tiny muted">보낸 알림이 없습니다.</p>}
                    {userNotifs.map((n) => (
                      <p key={n.id}>
                        <span style={{ color: 'var(--gray)', marginRight: 8 }}>{timeAgo(n.created_at)}</span>
                        {n.payload?.message?.slice(0, 60)}{n.payload?.message?.length > 60 ? '…' : ''}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ─── 공동체 (셀 통계 + 관리) ─────────────────── */}
      {tab === 'stats' && (
        <>
          <div className="admin-filters" style={{ padding: '0 16px' }}>
            <button className={cellSubTab === 'stats' ? 'on' : ''} onClick={() => setCellSubTab('stats')}>감사 현황</button>
            <button className={cellSubTab === 'manage' ? 'on' : ''} onClick={() => setCellSubTab('manage')}>셀 관리</button>
          </div>

          {cellSubTab === 'stats' && (
            <>
              <div className="card fade-in">
                <div style={{ display: 'flex', gap: 10 }}>
                  <div className="field" style={{ flex: 1, minWidth: 0 }}><label>시작</label>
                    <input type="date" value={statRange.from} onChange={(e) => setStatRange((r) => ({ ...r, from: e.target.value }))} /></div>
                  <div className="field" style={{ flex: 1, minWidth: 0 }}><label>끝</label>
                    <input type="date" value={statRange.to} onChange={(e) => setStatRange((r) => ({ ...r, to: e.target.value }))} /></div>
                </div>
                <p className="tiny" style={{ marginTop: 8 }}>기간 안에 각 셀의 셀원들이 감사를 몇 번 심었는지 집계합니다. (내용은 조회하지 않아요)</p>
                <input type="text" placeholder="셀 이름 검색 (쉼표로 여러 셀 검색 가능)"
                  value={cellQuery} onChange={(e) => setCellQuery(e.target.value)} style={{ marginTop: 8 }} />
              </div>
              <div className="card fade-in">
                {stats === null && <p className="muted">불러오는 중…</p>}
                {stats !== null && cells.length === 0 && (
                  <p className="muted">{cellTerms.length ? '검색과 닿는 셀이 없습니다.' : '아직 만들어진 셀이 없습니다.'}</p>
                )}
                {cells.map((s) => {
                  const rate = s.member_count > 0 ? Math.round((s.active_members / s.member_count) * 100) : 0;
                  return (
                    <div className="cell-row" key={s.team_id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <b style={{ fontWeight: 600 }}>{s.name}</b>
                        <span className="tiny" style={{ fontWeight: 500, color: 'var(--brand)' }}>{rate}%</span>
                      </div>
                      <div className="cell-bar"><i style={{ width: `${rate}%` }} /></div>
                      <div className="tiny">
                        셀원 {s.member_count}명 중 {s.active_members}명 참여 · 감사 {s.entry_count}회
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {cellSubTab === 'manage' && (
            <>
              <div className="card fade-in">
                <input type="text" placeholder="셀 이름 검색"
                  value={cellMgmtQuery} onChange={(e) => setCellMgmtQuery(e.target.value)} />
                <span className="tiny" style={{ display: 'block', marginTop: 6, fontWeight: 500 }}>
                  {cellList === null ? '불러오는 중…' : `${filteredCellList.length}개 셀`}
                </span>
              </div>
              <div className="card fade-in">
                {cellList !== null && filteredCellList.length === 0 && (
                  <p className="muted">{cellMgmtTerms.length ? '검색 결과가 없습니다.' : '아직 만들어진 셀이 없습니다.'}</p>
                )}
                {filteredCellList.map((c) => {
                  const accepted = (c.team_members || []).filter((m) => m.status === 'accepted');
                  const isExpanded = expandedCell === c.id;
                  return (
                    <div className="cell-row" key={c.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <b style={{ fontWeight: 600 }}>{c.name}</b>
                          <span className="tiny" style={{ marginLeft: 8 }}>리더: {c.leader?.display_id}</span>
                        </div>
                        <span className="tiny">{accepted.length}명</span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        <button className="btn subtle small" onClick={() => renameCell(c)}>이름 변경</button>
                        <button className="btn subtle small" onClick={() => setExpandedCell(isExpanded ? null : c.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="users" size={14} /> 멤버
                          <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={12} />
                        </button>
                        <button className="btn danger small" onClick={() => deleteCell(c)}
                          style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <Icon name="trash" size={14} /> 삭제
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="cell-members">
                          {accepted.length === 0 && <p className="tiny muted">수락된 멤버가 없습니다.</p>}
                          {accepted.map((m) => (
                            <div className="member-item" key={m.user_id}>
                              {m.profiles?.display_id || '(알 수 없음)'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
