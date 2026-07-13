import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App.jsx';
import { supabase } from '../lib/supabase.js';
import { appAlert, appConfirm, appPrompt } from '../components/Dialog.jsx';
import Avatar from '../components/Avatar.jsx';
import { toJpeg } from '../components/ItemsEditor.jsx';

export default function Settings() {
  const { session, profile, reloadProfile, theme, setTheme } = useApp();
  const uid = session.user.id;
  const [reminder, setReminder] = useState(profile?.reminder_time || '');
  const [blocks, setBlocks] = useState([]);
  const avatarRef = useRef(null);

  useEffect(() => { setReminder(profile?.reminder_time || ''); }, [profile]);

  useEffect(() => {
    supabase.from('blocks').select('blocked_id, profiles:blocked_id(display_id)')
      .eq('blocker_id', uid).then(({ data }) => setBlocks(data || []));
  }, [uid]);

  async function saveReminder(v) {
    setReminder(v);
    if (v && 'Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    await supabase.from('profiles').update({ reminder_time: v || null }).eq('id', uid);
    reloadProfile();
  }

  // 프로필 사진 올리기 (JPEG 512px 축소 후 photos 버킷에 보관)
  async function pickAvatar(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const jpg = await toJpeg(f, 512);
      const path = `${uid}/avatar-${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from('photos').upload(path, jpg, { contentType: 'image/jpeg' });
      if (upErr) throw upErr;
      const old = profile?.avatar_url;
      const { error } = await supabase.from('profiles').update({ avatar_url: path }).eq('id', uid);
      if (error) throw error;
      if (old) await supabase.storage.from('photos').remove([old]);
      reloadProfile();
    } catch {
      appAlert('사진을 담지 못했습니다.\n잠시 후 다시 시도해 주세요.');
    }
  }

  async function removeAvatar() {
    const old = profile?.avatar_url;
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', uid);
    if (old) await supabase.storage.from('photos').remove([old]);
    reloadProfile();
  }

  async function unblock(b) {
    await supabase.from('blocks').delete().eq('blocker_id', uid).eq('blocked_id', b.blocked_id);
    setBlocks((a) => a.filter((x) => x.blocked_id !== b.blocked_id));
  }

  async function deleteAccount() {
    if (!(await appConfirm('정말 떠나시겠어요?\n모든 기록·사진·셀 정보가 영구히 삭제되며\n되돌릴 수 없습니다.'))) return;
    if ((await appPrompt("확인을 위해 '삭제'라고 입력해 주세요.")) !== '삭제') return;
    try {
      const { data: files } = await supabase.storage.from('photos').list(uid, { limit: 1000 });
      if (files?.length) {
        await supabase.storage.from('photos').remove(files.map((f) => `${uid}/${f.name}`));
      }
      const { error } = await supabase.rpc('delete_account');
      if (error) throw error;
      await supabase.auth.signOut();
    } catch (e) {
      appAlert(`탈퇴 처리 중 문제가 생겼습니다.\n${e.message}`);
    }
  }

  return (
    <>
      <header className="top"><h1>설정</h1></header>

      <section className="card fade-in">
        <p className="section-title" style={{ margin: '0 0 10px' }}>내 정보</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Avatar profile={profile} size={56} onClick={() => avatarRef.current?.click()} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: '0 0 6px' }}>{profile?.display_id} <span className="tiny">({session.user.email})</span></p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn subtle small" onClick={() => avatarRef.current?.click()}>
                {profile?.avatar_url ? '사진 바꾸기' : '프로필 사진 담기'}
              </button>
              {profile?.avatar_url && (
                <button className="btn subtle small" onClick={removeAvatar}>사진 지우기</button>
              )}
            </div>
          </div>
        </div>
        <input ref={avatarRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
      </section>

      <section className="card fade-in">
        <p className="section-title" style={{ margin: '0 0 10px' }}>화면 모드</p>
        <div className="tabs" style={{ margin: 0 }}>
          {[['light', '라이트'], ['dark', '다크'], ['system', '시스템 연동']].map(([v, l]) => (
            <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}>{l}</button>
          ))}
        </div>
      </section>

      <section className="card fade-in">
        <p className="section-title" style={{ margin: '0 0 10px' }}>매일 리마인드</p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="time" aria-label="리마인드 시각" value={reminder} onChange={(e) => saveReminder(e.target.value)} style={{ flex: 1 }} />
          {reminder && <button className="btn subtle small" onClick={() => saveReminder('')}>끄기</button>}
        </div>
        <p className="tiny" style={{ marginTop: 8 }}>
          정해진 시각에 '오늘의 감사를 기록해 보세요' 알림을 드립니다. (앱이 열려 있을 때 · 브라우저 알림 권한 필요)
        </p>
      </section>

      {blocks.length > 0 && (
        <section className="card fade-in rows">
          <p className="section-title" style={{ margin: '0 0 6px' }}>차단한 사람</p>
          {blocks.map((b) => (
            <div className="row" key={b.blocked_id}>
              <div className="main">{b.profiles?.display_id}</div>
              <button className="btn subtle small" onClick={() => unblock(b)}>차단 해제</button>
            </div>
          ))}
        </section>
      )}

      <section className="fade-in" style={{ padding: '0 var(--page-px)', display: 'flex', gap: 10 }}>
        <button className="btn ink small" style={{ flex: 1, background: 'var(--gray-500)', borderColor: 'var(--gray-500)', color: 'var(--ink)' }} onClick={deleteAccount}>계정 탈퇴</button>
        <button className="btn ink small" style={{ flex: 1 }} onClick={() => supabase.auth.signOut()}>로그아웃</button>
      </section>
    </>
  );
}
