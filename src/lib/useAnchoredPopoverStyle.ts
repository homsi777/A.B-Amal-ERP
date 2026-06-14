import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

/** يثبت لوحة منبثقة أسفل زر المرساة دون قصّها عند حافة الشاشة (RTL). */
export function useAnchoredPopoverStyle(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  width = 340,
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
      const panelWidth = Math.min(width, window.innerWidth - 16);
      const margin = 8;
      let left = rect.right - panelWidth;
      left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));

      setStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left,
        width: panelWidth,
        zIndex: 9999,
      });
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
