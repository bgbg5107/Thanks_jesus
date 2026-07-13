import { useEffect, useRef } from 'react';
import { photoUrl } from '../lib/supabase.js';
import { itemPhotos, itemText } from '../lib/util.js';
import { appAlert } from './Dialog.jsx';
import Icon from './Icon.jsx';

// 감사 항목 편집기 — 항목마다 사진을 붙일 수 있다.
// item 형태: { text, photos: [저장된 경로], newFiles: [아직 안 올린 File] }
// Enter: 새 불릿, 빈 항목에서 Backspace: 불릿 삭제 후 이전 항목으로

export const emptyItem = () => ({ text: '', photos: [], newFiles: [] });

// DB contents(문자열 | {text, photos}) → 편집용 item 배열
export const toEditItems = (contents) => {
  const list = contents?.length ? contents : [''];
  return list.map((c) => ({ text: itemText(c), photos: [...itemPhotos(c)], newFiles: [] }));
};

// 스냅샷(자동 저장 비교용)
export const snapItems = (items) =>
  items.map((x) => ({ t: x.text, p: x.photos, n: x.newFiles.length }));

export default function ItemsEditor({ items, onChange, placeholder = '오늘, 어떤 순간이 감사했나요?', onZoom }) {
  const refs = useRef([]);
  const focusTo = useRef(null); // { i, atStart }
  const fileRef = useRef(null);
  const pickIdx = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    if (focusTo.current === null) return;
    const { i, atStart } = focusTo.current;
    const el = refs.current[i];
    if (el) {
      el.focus();
      const pos = atStart ? 0 : el.value.length;
      el.selectionStart = el.selectionEnd = pos;
      autoGrow(el);
    }
    focusTo.current = null;
  });

  const isEmpty = (x) => !x.text && !x.photos.length && !x.newFiles.length;

  function onKeyDown(e, i) {
    // 한글 조합(IME) 중에는 Enter/Backspace를 건드리지 않는다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const el = e.target;
      const before = items[i].text.slice(0, el.selectionStart);
      const after = items[i].text.slice(el.selectionEnd);
      const next = [...items];
      next[i] = { ...next[i], text: before };
      next.splice(i + 1, 0, { ...emptyItem(), text: after });
      focusTo.current = { i: i + 1, atStart: true };
      onChange(next);
    } else if (e.key === 'Backspace' && isEmpty(items[i]) && items.length > 1) {
      e.preventDefault();
      focusTo.current = { i: Math.max(0, i - 1), atStart: false };
      onChange(items.filter((_, j) => j !== i));
    }
  }

  async function pickFiles(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    const converted = [];
    for (const f of files) {
      try {
        converted.push(await toJpeg(f));   // 어떤 형식이든 JPEG로 변환 (HEIC 등 대비)
      } catch {
        await appAlert(`'${f.name}' 사진은 이 브라우저가 읽지 못하는 형식이에요.\nJPG/PNG 사진으로 다시 담아 주세요.`);
      }
    }
    if (converted.length) {
      const i = pickIdx.current;
      const cur = itemsRef.current;
      onChange(cur.map((x, j) => (j === i ? { ...x, newFiles: [...x.newFiles, ...converted] } : x)));
    }
  }

  return (
    <>
      <div className="items">
        {items.map((v, i) => (
          <div className="item" key={i}>
            <span className="dot">·</span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <textarea
                rows={1}
                value={v.text}
                placeholder={i === 0 ? placeholder : '또 하나의 감사'}
                ref={(el) => { refs.current[i] = el; autoGrow(el); }}
                onChange={(e) => { autoGrow(e.target); onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))); }}
                onKeyDown={(e) => onKeyDown(e, i)}
              />
              {(v.photos.length > 0 || v.newFiles.length > 0) && (
                <div className="photos" style={{ marginTop: 8 }}>
                  {v.photos.map((p) => (
                    <div className="ph" key={p}>
                      <img src={photoUrl(p)} alt="" onClick={() => onZoom && onZoom(photoUrl(p))} />
                      <button aria-label="사진 지우기" onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, photos: x.photos.filter((y) => y !== p) } : x)))}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                  {v.newFiles.map((f, k) => (
                    <div className="ph" key={k}>
                      <img src={URL.createObjectURL(f)} alt="" onClick={(e) => onZoom && onZoom(e.target.src)} />
                      <button aria-label="사진 지우기" onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, newFiles: x.newFiles.filter((_, m) => m !== k) } : x)))}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button className="del" title="사진 담기" aria-label="사진 담기"
              onClick={() => { pickIdx.current = i; fileRef.current?.click(); }}><Icon name="camera" size={18} /></button>
            <button className="del" title="항목 지우기" aria-label="항목 지우기"
              onClick={() => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : [emptyItem()])}><Icon name="x" size={18} /></button>
          </div>
        ))}
      </div>
      <button className="btn subtle small add wide" aria-label="감사 더하기" title="감사 더하기"
        onClick={() => { focusTo.current = { i: items.length, atStart: true }; onChange([...items, emptyItem()]); }}>
        +
      </button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pickFiles} />
    </>
  );
}

function autoGrow(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// 사진을 JPEG로 변환 + 긴 변 max px로 축소 (기본 1600, 프로필 사진 등은 더 작게)
export async function toJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('convert'))), 'image/jpeg', 0.85)
  );
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
