import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './ui.jsx';
import { presetSize, chunkWords, sampleWords } from '../../electron/layout.mjs';
import { drawComposition } from '../lib/compose.js';

/**
 * Small live view of the Premiere-tab layout inside the player (same drawing code as the Premiere tab and the
 * caption exporter). Click it to open the Premiere tab.
 */
export default function PremierePreview({ getVideo, facecamRect, preset, sample, height = 230, onOpen, onClose }) {
  const canvas = useRef(null);
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
  const [W, H] = presetSize(preset);
  const h = height;
  const w = Math.round((h * W) / H);
  const chunks = useMemo(() => chunkWords(sampleWords(sample || 'this is how your captions will look'), { words: preset.captions.words, maxChars: preset.captions.maxChars }), [sample, preset.captions.words, preset.captions.maxChars]);
  const props = useRef({});
  props.current = { facecamRect, preset, chunks };

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 33) return;
      last = now;
      const c = canvas.current;
      if (!c) return;
      const { preset: p, facecamRect: fr, chunks: ch } = props.current;
      const v = getVideo && getVideo();
      const [FW] = presetSize(p);
      const media = v && v.videoWidth ? { gameplay: { el: v }, facecam: fr ? { el: v, box: fr } : null } : {};
      const loop = ch.length ? ch.at(-1).end + 1.4 : 3;
      drawComposition(c.getContext('2d'), { preset: p, k: c.width / FW, media, chunks: ch, t: (now / 1000) % loop, noFacecam: 'Facecam' });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getVideo]);

  return (
    <div className={`pr-preview ${right ? 'right' : ''}`} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <canvas ref={canvas} width={w * 2} height={h * 2} style={{ width: w, height: h }} onClick={() => onOpen && onOpen()} title={`${preset.name} · ${W}×${H} — click to design it in the Premiere tab`} />
      <div className="prp-bar">
        <span className="pr-logo">Pr</span>
        <span className="prp-name">{preset.name}</span>
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
