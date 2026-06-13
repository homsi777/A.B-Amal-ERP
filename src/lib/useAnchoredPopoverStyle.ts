import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

function isDocumentRtl(): boolean {
  if (typeof document === 'undefined') return true;
  const dir = document.documentElement.getAttribute('dir');
  if (dir) return dir === 'rtl';
  return getComputedStyle(document.documentElement).direction === 'rtl';
}

/** يثبت لوحة منبثقة أسفل زر المرساة دون قصّها عند حافة الشاشة (يدعم RTL). */
export function useAnchoredPopoverStyle(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  width = 380,
): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }

    const update = () => {
      const el = anchorRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const margin = 12;
      const gap = 10;
      const panelWidth = Math.min(width, window.innerWidth - margin * 2);
      const rtl = isDocumentRtl();
      const top = rect.bottom + gap;
      const maxHeight = Math.max(160, window.innerHeight - top - margin);

      if (rtl) {
        let right = window.innerWidth - rect.right;
        const maxRight = window.innerWidth - panelWidth - margin;
        right = Math.max(margin, Math.min(right, maxRight));
        setStyle({
          position: 'fixed',
          top,
          right,
          left: 'auto',
          width: panelWidth,
          maxHeight,
          zIndex: 9999,
        });
      } else {
        let left = rect.left;
        left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
        setStyle({
          position: 'fixed',
          top,
          left,
          right: 'auto',
          width: panelWidth,
          maxHeight,
          zIndex: 9999,
        });
      }
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, width]);

  return open ? style : null;
}
