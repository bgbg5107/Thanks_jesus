import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { appAlert } from '../components/Dialog.jsx';

export default function ResetPassword({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (pw.length < 6) { setErr('비밀번호는 6자리 이상으로 적어 주세요.'); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setErr(error.message); return; }
    await appAlert('비밀번호가 새로 설정되었습니다.');
    onDone();
  }

  return (
    <div className="app">
      <form className="card fade-in" style={{ marginTop: 70 }} onSubmit={submit} noValidate>
        <h2 style={{ fontWeight: 500 }}>새 비밀번호 설정</h2>
        <div className="field">
          <label>새 비밀번호 (6자리 이상)</label>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        {err && <p className="error">{err}</p>}
        <button className="btn wide">저장하기</button>
      </form>
    </div>
  );
}
