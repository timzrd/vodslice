/** Sprite cell of a storyboard ({width,height,rows,columns,fragments:[{url,duration}]}) for time t. */
export function sbFrame(sb, t) {
  if (!sb || !sb.fragments || !sb.fragments.length) return null;
  const cells = sb.rows * sb.columns;
  let acc = 0;
  for (let i = 0; i < sb.fragments.length; i++) {
    const f = sb.fragments[i];
    const d = f.duration || 0;
    if (t < acc + d || i === sb.fragments.length - 1) {
      const per = d / cells || 1;
      const idx = Math.min(cells - 1, Math.max(0, Math.floor((t - acc) / per)));
      return { url: f.url, col: idx % sb.columns, row: Math.floor(idx / sb.columns) };
    }
    acc += d;
  }
  return null;
}

/** CSS background that shows the frame at t covering a w×h box. */
export function sbStyle(sb, t, w, h) {
  const fr = sbFrame(sb, t);
  if (!fr) return null;
  const scale = Math.max(w / sb.width, h / sb.height);
  const fw = sb.width * scale;
  const fh = sb.height * scale;
  const ox = (w - fw) / 2;
  const oy = (h - fh) / 2;
  return {
    backgroundImage: `url("${fr.url}")`,
    backgroundSize: `${sb.columns * fw}px ${sb.rows * fh}px`,
    backgroundPosition: `${ox - fr.col * fw}px ${oy - fr.row * fh}px`,
    backgroundRepeat: 'no-repeat',
  };
}

/** Nearest grabbed frame ({t, dataUrl}[]) for t. */
export function nearestThumb(thumbs, t) {
  if (!thumbs || !thumbs.length) return null;
  let best = thumbs[0];
  for (const x of thumbs) if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
  return best.dataUrl;
}

/** Background for a w×h tile at time t from whatever the source has. */
export function frameStyle(info, thumbs, t, w, h) {
  if (info && info.storyboard) return sbStyle(info.storyboard, t, w, h);
  const u = nearestThumb(thumbs, t) || (info && info.thumbnail);
  return u ? { backgroundImage: `url("${u}")`, backgroundSize: 'cover', backgroundPosition: 'center' } : null;
}
