import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { configured, supabase } from './lib/supabase.js';
import { flushPending } from './lib/offline.js';
import { todayStr } from './lib/util.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import CalendarPage from './pages/CalendarPage.jsx';
import Feed from './pages/Feed.jsx';
import Teams from './pages/Teams.jsx';
import Notifications from './pages/Notifications.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dialog, { appAlert } from './components/Dialog.jsx';

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = 로딩 중
  const [profile, setProfile] = useState(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [unread, setUnread] = useState(0);
  const [recovery, setRecovery] = useState(false);
  const [teams, setTeams] = useState([]);
  const reminderShown = useRef('');
  const hadSession = useRef(false);
  const navigate = useNavigate();

  // 인증 세션
  useEffect(() => {
    if (!configured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s ?? null);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      // 로그인 직후에는 항상 '오늘' 탭에서 시작
      if (event === 'SIGNED_IN' && !hadSession.current) navigate('/');
      hadSession.current = Boolean(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = useCallback(async () => {
    if (!session?.user) { setProfile(null); return; }
    const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
    if (data?.status === 'suspended') {
      await appAlert('이 계정은 현재 이용이 제한되어 있습니다.\n관리자에게 문의해 주세요.');
      await supabase.auth.signOut();
      return;
    }
    setProfile(data ?? null);
  }, [session]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  // 온라인/오프라인 감지 + 자동 동기화
  useEffect(() => {
    const on = async () => {
      setOnline(true);
      if (session?.user) {
        const n = await flushPending(session.user.id);
        if (n > 0) window.dispatchEvent(new CustomEvent('synced'));
      }
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    if (navigator.onLine && session?.user) flushPending(session.user.id);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [session]);

  // 내 팀(셀) 목록
  const loadTeams = useCallback(async () => {
    if (!session?.user || !navigator.onLine) return;
    const uid = session.user.id;
    const { data: lead } = await supabase.from('teams').select('*').eq('leader_id', uid);
    const { data: mem } = await supabase.from('team_members')
      .select('status, teams(*)').eq('user_id', uid).eq('status', 'accepted');
    // 역할 이름은 방 종류에 따라: 셀 → 셀리더/셀원, 나눔 공동체 → 모임지기/멤버
    const leaderRole = (t) => (t.kind === 'cell' ? '셀리더' : '모임지기');
    const memberRole = (t) => (t.kind === 'cell' ? '셀원' : '멤버');
    const list = [
      ...(lead || []).map((t) => ({ ...t, role: leaderRole(t) })),
      ...(mem || []).map((m) => ({ ...m.teams, role: memberRole(m.teams) })).filter((t) => t.leader_id !== uid),
    ];
    setTeams(list);
  }, [session]);

  useEffect(() => { loadTeams(); }, [loadTeams]);

  // 새로 나눠진 감사 수 (마지막으로 나눔 탭을 본 이후)
  const [feedNew, setFeedNew] = useState(0);

  const loadFeedNew = useCallback(async () => {
    if (!session?.user || !navigator.onLine) return;
    const seen = localStorage.getItem(`feed-seen-${session.user.id}`) || new Date(0).toISOString();
    const { count } = await supabase
      .from('entries')
      .select('*', { count: 'exact', head: true })
      .neq('visibility', 'private')
      .neq('user_id', session.user.id)
      .gt('updated_at', seen);
    setFeedNew(count || 0);
  }, [session]);

  useEffect(() => {
    loadFeedNew();
    const t = setInterval(loadFeedNew, 60000);
    return () => clearInterval(t);
  }, [loadFeedNew]);

  const markFeedSeen = useCallback(() => {
    if (session?.user) localStorage.setItem(`feed-seen-${session.user.id}`, new Date().toISOString());
    setFeedNew(0);
  }, [session]);

  // 읽지 않은 알림 수
  const loadUnread = useCallback(async () => {
    if (!session?.user || !navigator.onLine) return;
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.user.id)
      .eq('read', false);
    setUnread(count || 0);
  }, [session]);

  useEffect(() => {
    loadUnread();
    const t = setInterval(loadUnread, 60000);
    return () => clearInterval(t);
  }, [loadUnread]);

  // 주말(토·일)에 한 번, 우리 셀의 한 주 감사 요약을 알림으로 전한다
  useEffect(() => {
    if (!session?.user || !navigator.onLine || !teams.length) return;
    const day = new Date().getDay();
    if (day !== 0 && day !== 6) return;
    const cell = teams.find((t) => t.kind === 'cell');
    if (!cell) return;
    const sun = new Date();
    sun.setDate(sun.getDate() - sun.getDay());
    const from = todayStr(sun);
    const key = `cellweek-${session.user.id}-${from}`;   // 주 1회
    if (localStorage.getItem(key)) return;
    (async () => {
      const { data } = await supabase.rpc('team_week_activity', {
        p_team_id: cell.id, p_from: from, p_to: todayStr(),
      });
      const total = (data || []).reduce((n, m) => n + (m.dates?.length || 0), 0);
      if (!total) return;
      await supabase.from('notifications').insert({
        user_id: session.user.id, type: 'cell_week',
        payload: { message: `이번 주 '${cell.name}'은 함께 ${total}번의 감사를 심었어요. 🌱\n고요한 한 주의 열매를 돌아보세요.` },
      });
      localStorage.setItem(key, '1');
      loadUnread();
    })();
  }, [session, teams, loadUnread]);

  // 매일 리마인드 알림 (앱이 열려 있는 동안, 설정된 시각에)
  useEffect(() => {
    const t = setInterval(() => {
      const rt = profile?.reminder_time;
      if (!rt) return;
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const key = `${new Date().toDateString()}-${rt}`;
      if (hhmm === rt && reminderShown.current !== key) {
        reminderShown.current = key;
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('감사 기록', { body: '오늘 하루, 감사했던 순간을 조용히 기록해 보세요.' });
        }
      }
    }, 30000);
    return () => clearInterval(t);
  }, [profile]);

  if (!configured) {
    return (
      <div className="app">
        <div className="card fade-in" style={{ marginTop: 60 }}>
          <h2 style={{ fontWeight: 500 }}>설정이 필요합니다</h2>
          <p className="muted">
            프로젝트 폴더의 <b>README.md</b>를 따라 Supabase 프로젝트를 만들고,
            <b> .env</b> 파일에 URL과 anon key를 입력한 뒤 다시 실행해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (session === undefined) return null;

  if (recovery) {
    return <><ResetPassword onDone={() => setRecovery(false)} /><Dialog /></>;
  }

  if (!session) return <Login />;

  // 관리자 계정은 관리자 페이지만 사용 — 하단 탭 없이 바로 이동
  const isAdmin = Boolean(profile?.is_admin);

  return (
    <Ctx.Provider value={{ session, profile, reloadProfile: loadProfile, online, unread, loadUnread, teams, loadTeams, feedNew, markFeedSeen }}>
      <div className="app">
        {!online && <div className="offline-bar">오프라인 상태입니다 · 기록은 안전하게 보관되며 연결 시 자동 저장됩니다</div>}
        <Routes>
          <Route path="/" element={isAdmin ? <Navigate to="/admin" replace /> : <Home />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/settings" element={<Settings />} />
          {isAdmin && <Route path="/admin" element={<Admin />} />}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        {!isAdmin && (
          <nav className="nav no-print">
            <Tab to="/" icon={<NavIcon name="leaf" />} label="오늘" />
            <Tab to="/calendar" icon={<NavIcon name="calendar" />} label="캘린더" />
            <Tab to="/feed" icon={<NavIcon name="send" />} label="나눔" badge={feedNew} />
            <Tab to="/teams" icon={<NavIcon name="users" />} label="공동체" />
            <Tab to="/settings" icon={<NavIcon name="sliders" />} label="설정" />
          </nav>
        )}
        <Dialog />
      </div>
    </Ctx.Provider>
  );
}

function Tab({ to, icon, label, badge = 0 }) {
  return (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'on' : '')} end={to === '/'}>
      <span className="i">{icon}</span>
      {label}
      {badge > 0 && <span className="badge">{badge > 9 ? '9+' : badge}</span>}
    </NavLink>
  );
}

// 하단 탭 라인 아이콘 (홈 헤더의 벨과 같은 스트로크 톤)
const NAV_PATHS = {
  leaf: (
    <>
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>
  ),
};

function NavIcon({ name }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {NAV_PATHS[name]}
    </svg>
  );
}
