import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.jsx';

const W = 1440;
const H = 1920;

/**
 * Live 3:4 preview of the Premiere sequence, drawn from the playing video: facecam box covering the top area
 * (center-cropped exactly like the XML does), the blue gameplay window below, and a sample caption.
 */
export default function PremierePreview({ getVideo, facecamRect, gameplayRect, split = 1 / 3, captions, height = 230, onClose }) {
  const canvas = useRef(null);
  const [big, setBig] = useState(false);
  const [right, setRight] = useState(() => {
    try {
      return localStorage.getItem('prp-side') === 'right';
    } catch {
      return false;
    }
  });
  const flip = () => {
    setRight((r) => {
      try {
        localStorage.setItem('prp-side', r ? 'left' : 'right');
      } catch {}
      return !r;
    });
  };
  const h = big ? Math.round(height * 1.8) : height;
  const w = Math.round((h * W) / H);
  const props = useRef({});
  props.current = { facecamRect, gameplayRect, split, captions };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const c = canvas.current;
      const v = getVideo && getVideo();
      if (!c) return;
      const ctx = c.getContext('2d');
      const cw = c.width;
      const ch = c.height;
      const k = cw / W;
      const topH = Math.round(H * props.current.split) * k;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      if (!v || !v.videoWidth) return;
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      const { facecamRect: fr, gameplayRect: gr, captions: cap } = props.current;
      try {
        // gameplay: the chosen window covers the bottom area
        const g = gr || { x: 0, y: 0, w: 1, h: 1 };
        cover(ctx, v, g.x * vw, g.y * vh, g.w * vw, g.h * vh, 0, topH, cw, ch - topH);
        // facecam: cover the top area, centered crop
        if (fr) cover(ctx, v, fr.x * vw, fr.y * vh, fr.w * vw, fr.h * vh, 0, 0, cw, topH);
      } catch {
        return;
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(0, topH - 0.5, cw, 1);
      if (cap && cap.enabled) {
        const y = cap.posY != null ? cap.posY * ch : topH;
        const size = Math.max(8, (cap.size || 84) * k);
        ctx.font = `900 ${size}px "${cap.font || 'Arial Black'}", "Arial Black", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        const words = (cap.uppercase === false ? ['So', 'sieht', 'es', 'aus'] : ['SO', 'SIEHT', 'ES', 'AUS']).slice(0, Math.max(1, Math.min(4, cap.maxWords || 3)));
        const full = words.join(' ');
        const total = ctx.measureText(full).width;
        let x = cw / 2 - total / 2;
        const hi = Math.floor((now / 450) % words.length);
        words.forEach((wd, i) => {
          const ww = ctx.measureText(wd).width;
          ctx.lineWidth = Math.max(1.5, (cap.outline || 7) * k * 2);
          ctx.strokeStyle = '#000';
          ctx.strokeText(wd, x + ww / 2, y);
          ctx.fillStyle = i === hi ? cap.highlight || '#ffd23f' : cap.color || '#fff';
          ctx.fillText(wd, x + ww / 2, y);
          x += ww + ctx.measureText(' ').width;
        });
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getVideo]);

  return (
    <div className={`pr-preview ${big ? 'big' : ''} ${right ? 'right' : ''}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <canvas ref={canvas} width={w * 2} height={h * 2} style={{ width: w, height: h }} onClick={() => setBig((b) => !b)} title="Premiere preview (1440×1920) — click to enlarge" />
      <div className="prp-bar">
        <span className="pr-logo">Pr</span>
        <span>1440×1920</span>
        <button className="icon-btn xs ghost" title="Move to the other side" onClick={flip}>
          <Icon name={right ? 'chevronLeft' : 'chevronRight'} size={12} />
        </button>
        {onClose && (
          <button className="icon-btn xs ghost" title="Hide preview (video menu)" onClick={onClose}>
            <Icon name="x" size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/** drawImage that scales the source rect to cover the target, cropping the overflow centered. */
function cover(ctx, v, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (sw <= 0 || sh <= 0) return;
  const s = Math.max(dw / sw, dh / sh);
  const cw = dw / s;
  const ch = dh / s;
  const cx = sx + (sw - cw) / 2;
  const cy = sy + (sh - ch) / 2;
  ctx.drawImage(v, cx, cy, cw, ch, dx, dy, dw, dh);
}
