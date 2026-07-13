import Overlay from './Overlay.jsx';

// 사진 확대 보기 — 아무 곳이나 누르거나 Escape로 닫힌다
export default function Lightbox({ src, onClose }) {
  if (!src) return null;
  return (
    <Overlay className="lightbox no-print" style={{ zIndex: 60 }} label="사진 확대 보기" onClose={onClose}>
      <img src={src} alt="확대한 사진" />
    </Overlay>
  );
}
