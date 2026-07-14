import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import Icon from '../components/Icon.jsx';

// iOS Safari에서 PWA로 설치되지 않은 경우 감지
const isIosSafari = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.navigator.standalone === true;
const showPwaHint = isIosSafari && !isStandalone;

export default function Login() {
  const [mode, setMode] = useState('login'); // login | signup | forgot
  const [entered, setEntered] = useState(false); // '주님 감사합니다!'를 눌러 폼이 올라온 상태
  const [name, setName] = useState('');      // 가입: 실명
  const [loginId, setLoginId] = useState(''); // 로그인/재설정: 아이디(이름)
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function switchMode(m) {
    setMode(m); setErr(''); setMsg(''); setShowPw(false);
  }

  async function emailOf(id) {
    const { data, error } = await supabase.rpc('email_for_login', { p_display_id: id.trim() });
    if (error) throw error;
    if (!data) throw new Error('등록되지 않은 아이디입니다.');
    return data;
  }

  async function submit(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      if (mode !== 'signup' && !loginId.trim()) throw new Error('아이디(이름)를 입력해 주세요.');
      if (mode !== 'forgot' && pw.length < 6) throw new Error('비밀번호는 6자리 이상으로 적어 주세요.');
      if (mode === 'signup') {
        if (!name.trim()) throw new Error('이름을 입력해 주세요.');
        if (!email.includes('@')) throw new Error('이메일 주소를 확인해 주세요.');
        const { error } = await supabase.auth.signUp({
          email, password: pw,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        // 자동 로그인 방지: 회원가입 후 세션을 즉시 종료
        await supabase.auth.signOut();
        setMsg('가입이 완료되었습니다!\n아이디는 입력하신 이름입니다 (동명이인이 있으면 A·B가 붙습니다).\n아래에서 로그인해 주세요.');
        setLoginId(name.trim());
        setPw('');
        setEmail('');
        setName('');
        setMode('login');
        return;
      } else if (mode === 'login') {
        const em = await emailOf(loginId);
        const { error } = await supabase.auth.signInWithPassword({ email: em, password: pw });
        if (error) throw error;
      } else {
        // 이름만으로는 동명이인에게 갈 수 있어, 가입 이메일까지 함께 확인한다
        if (!email.includes('@')) throw new Error('가입할 때 사용한 이메일 주소를 입력해 주세요.');
        const em = await emailOf(loginId);
        if (em.trim().toLowerCase() !== email.trim().toLowerCase()) {
          throw new Error('이름과 이메일이 서로 맞지 않습니다.\n동명이인은 이지영A · 이지영B 처럼 구분되니,\n가입할 때의 이름과 이메일을 확인해 주세요.');
        }
        const { error } = await supabase.auth.resetPasswordForEmail(em, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setMsg('입력하신 이메일로 비밀번호 재설정 링크를 보내드렸습니다.');
      }
    } catch (e2) {
      const m = e2.message || '';
      if (m === 'Invalid login credentials') setErr('비밀번호가 맞지 않습니다.');
      else if (m.includes('Email not confirmed')) setErr('이메일 인증이 아직 완료되지 않았습니다.\n가입 시 입력한 이메일의 받은 편지함에서 인증 링크를 눌러 주세요.');
      else setErr(m);
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === 'login' ? 'Shalom ❤️' :
    mode === 'signup' ? 'Shalom 😊' : '잠시 잊으셔도 괜찮아요';
  const sub =
    mode === 'login' ? '이름과 비밀번호를 입력해 주세요.' :
    mode === 'signup' ? '감사의 여정을 함께 시작해요.' :
    '가입하신 이름과 이메일을 확인한 뒤\n재설정 링크를 보내드릴게요.';

  return (
    <div className={`login-page${entered ? ' entered' : ''}`}>
      <header className="login-hero fade-in" onClick={() => { if (entered) { setEntered(false); switchMode('login'); } }}>
        <div className="login-hero-top">
          {mode !== 'login' && (
            <button type="button" className="login-back" aria-label="로그인으로 돌아가기" onClick={() => switchMode('login')}>
              <Icon name="chevronLeft" size={20} />
            </button>
          )}
          <h1 className="login-brand">✨모든 것이 감사✨</h1>
        </div>
        <p className="login-verse">
          "항상 기뻐하라. 쉬지 말고 기도하라.
          범사에 감사하라. 이것이 그리스도 예수
          안에서 너희를 향하신 하나님의 뜻이니라."
          <span className="ref">살전 5:16~18</span>
        </p>
        <button type="button" className={`btn ink login-cta${entered ? ' hide' : ''}`}
          disabled={entered} onClick={() => setEntered(true)}>
          주님 감사합니다! 🙏
        </button>
      </header>

      {entered && (
      <form className="login-card" onSubmit={submit} noValidate>
        <h2>{heading}</h2>
        <p className="login-sub">{sub}</p>

        {mode === 'signup' ? (
          <>
            <div className="field boxed">
              <label htmlFor="su-name">이름 (실명)</label>
              <input id="su-name" type="text" value={name} autoComplete="name" spellCheck={false} onChange={(e) => setName(e.target.value)} />
            </div>
            <p className="tiny login-hint"><>본인의 이름을 정확히 입력해주세요.<br></br>(동명이인의 경우 김영광A·김영광B 구분하여 적어주세요.)</></p>
            <div className="field boxed">
              <label htmlFor="su-email">이메일 (비밀번호를 잊었을 때 재설정용)</label>
              <input id="su-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" spellCheck={false} />
            </div>
          </>
        ) : (
          <>
            <div className="field boxed">
              <label htmlFor="li-name">이름</label>
              <input id="li-name" type="text" value={loginId} autoComplete="username" spellCheck={false} onChange={(e) => setLoginId(e.target.value)} required />
            </div>
            {mode === 'forgot' && (
              <div className="field boxed">
                <label htmlFor="fg-email">이메일 (가입할 때 사용한 주소)</label>
                <input id="fg-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" spellCheck={false} />
              </div>
            )}
          </>
        )}
        {mode !== 'forgot' && (
          <div className="field boxed">
            <label htmlFor="li-pw">비밀번호 (6자리 이상)</label>
            <div className="pw-wrap">
              <input id="li-pw" type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
              <button type="button" className="pw-eye" aria-label={showPw ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPw((v) => !v)}>
                <Icon name={showPw ? 'eyeOff' : 'eye'} size={20} />
              </button>
            </div>
          </div>
        )}
        {err && <p className="error">{err}</p>}
        {msg && <p className="notice">{msg}</p>}
        <div className="spacer" />
        <button className="btn ink wide" disabled={busy}>
          {mode === 'login' ? '로그인' : mode === 'signup' ? '함께하기' : '재설정 링크 보내기'}
        </button>
        <div className="login-links">
          {mode === 'login' ? (
            <>
              <button type="button" className="login-link" onClick={() => switchMode('forgot')}>비밀번호를 잊으셨나요?</button>
              <button type="button" className="login-link" onClick={() => switchMode('signup')}>가입하기</button>
            </>
          ) : (
            <button type="button" className="login-link" onClick={() => switchMode('login')}>로그인으로 돌아가기</button>
          )}
        </div>
        {showPwaHint && (
          <p className="pwa-hint">
            <strong>홈 화면에 추가</strong> 하시면 로그인이 유지됩니다.
          </p>
        )}
      </form>
      )}
    </div>
  );
}
