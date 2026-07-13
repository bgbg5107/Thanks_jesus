import { useEffect } from 'react';

// 공용 팝업 배경 — Escape로 닫기, 열려 있는 동안 배경 스크롤 잠금, dialog 시맨틱.
// 겹쳐 열린 경우(사진 확대 등) Escape는 맨 위 팝업만 닫는다.
const stack = [];

export default function Overlay({ onClose, label, className = '', style, children }) {
  useEffect(() => {
    const entry = {};
    stack.push(entry);
    document.body.classList.add('modal-open');
    const onKey = (e) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === entry) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (!stack.length) document.body.classList.remove('modal-open');
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className={`overlay ${className}`.trim()} style={style}
      role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      {children}
    </div>
  );
}
