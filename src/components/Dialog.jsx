import { useEffect, useState } from 'react';
import Overlay from './Overlay.jsx';

/* 앱 스타일 알림창 — 브라우저 기본 alert/confirm/prompt 대신 사용.
   appAlert(문구)            → Promise<void>
   appConfirm(문구)          → Promise<boolean>
   appPrompt(문구, 안내문)   → Promise<string | null>
   <Dialog />가 화면에 있어야 동작하며, 없으면 브라우저 기본 창으로 대신한다. */

let push = null;

export function appAlert(message) {
  if (!push) { window.alert(message); return Promise.resolve(); }
  return new Promise((res) => push({ kind: 'alert', message, res }));
}

export function appConfirm(message) {
  if (!push) return Promise.resolve(window.confirm(message));
  return new Promise((res) => push({ kind: 'confirm', message, res }));
}

export function appPrompt(message, placeholder = '') {
  if (!push) return Promise.resolve(window.prompt(message));
  return new Promise((res) => push({ kind: 'prompt', message, placeholder, res }));
}

export default function Dialog() {
  const [d, setD] = useState(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    push = (next) => { setValue(''); setD(next); };
    return () => { push = null; };
  }, []);

  if (!d) return null;

  const cancelValue = d.kind === 'confirm' ? false : d.kind === 'prompt' ? null : undefined;
  const okValue = d.kind === 'confirm' ? true : d.kind === 'prompt' ? value : undefined;
  const close = (result) => { setD(null); d.res(result); };

  return (
    <Overlay label="알림" onClose={() => close(cancelValue)}>
      <div className="modal center" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <p style={{ margin: '4px 0 0', lineHeight: 1.9, whiteSpace: 'pre-line', wordBreak: 'keep-all' }}>
          {d.message}
        </p>
        {d.kind === 'prompt' && (
          <div className="field" style={{ marginTop: 14 }}>
            <input type="text" value={value} placeholder={d.placeholder} autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) close(value); }} />
          </div>
        )}
        <div className="spacer" />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {d.kind !== 'alert' && (
            <button className="btn subtle small" onClick={() => close(cancelValue)}>
              {d.kind === 'confirm' ? '아니요' : '취소'}
            </button>
          )}
          <button className="btn small" onClick={() => close(okValue)}>
            {d.kind === 'confirm' ? '네' : '확인'}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
