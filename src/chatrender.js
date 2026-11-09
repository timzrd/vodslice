// Hidden window (#chatrender): draws chat states on a transparent canvas and hands PNGs to the main process.
// Look: Twitch-style lines "Name: message" with colored names, emotes inline, black outline for readability
// on any video (the background stays transparent).

const imgCache = new Map();
function loadImg(url) {
  if (!imgCache.has(url))
    imgCache.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const t = setTimeout(() => resolve(null), 12000);
        img.onload = () => {
          clearTimeout(t);
          resolve(img.naturalWidth ? img : null);
        };
        img.onerror = () => {
          clearTimeout(t);
          resolve(null);
        };
        img.src = url;
      })
    );
  return imgCache.get(url);
}

/** Dark name colors get lifted so they stay readable on dark gameplay. */
export function readable(color) {
  const m = /^#?([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return '#ffffff';
  let r = parseInt(m[1].slice(0, 2), 16);
  let g = parseInt(m[1].slice(2, 4), 16);
  let b = parseInt(m[1].slice(4, 6), 16);
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (L < 120) {
    const k = ((120 - L) / 120) * 0.65;
    r += (255 - r) * k;
    g += (255 - g) * k;
    b += (255 - b) * k;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

async function renderJob(job) {
  const { id, width: W, height: H, fps, duration, messages } = job;
  const F = job.fontSize || 26;
  const urls = [...new Set(messages.flatMap((m) => m.parts.filter((p) => p.emote).map((p) => p.emote)))];
  const imgs = new Map();
  await pool(urls, 12, async (u) => imgs.set(u, await loadImg(u)));

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const font = (w) => `${w} ${F}px "Segoe UI", Inter, Arial, sans-serif`;
  const pad = Math.round(F * 0.5);
  const lineH = Math.round(F * 1.45);
  const emH = Math.round(F * 1.35);
  const gap = Math.round(F * 0.32);
  const maxW = W - pad * 2;

  const layout = (m) => {
    const tokens = [];
    ctx.font = font(800);
    const nameText = `${m.name}:`;
    tokens.push({ kind: 'name', text: nameText, w: ctx.measureText(nameText).width, color: readable(m.color) });
    ctx.font = font(600);
    const space = ctx.measureText(' ').width;
    for (const p of m.parts) {
      if (p.emote) {
        const img = imgs.get(p.emote);
        if (img) tokens.push({ kind: 'emote', img, w: Math.round((img.naturalWidth / img.naturalHeight) * emH) });
        else if (p.name) tokens.push({ kind: 'text', text: p.name, w: ctx.measureText(p.name).width });
        continue;
      }
      for (const word of String(p.text || '').split(/\s+/).filter(Boolean)) {
        let w = word;
        // hard-break words longer than a line
        while (ctx.measureText(w).width > maxW && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && ctx.measureText(w.slice(0, k)).width > maxW) k--;
          tokens.push({ kind: 'text', text: w.slice(0, k), w: ctx.measureText(w.slice(0, k)).width });
          w = w.slice(k);
        }
        tokens.push({ kind: 'text', text: w, w: ctx.measureText(w).width });
      }
    }
    const lines = [[]];
    let x = 0;
    for (const tk of tokens) {
      if (x > 0 && x + space + tk.w > maxW) {
        lines.push([]);
        x = 0;
      }
      const xx = x === 0 ? 0 : x + space;
      lines[lines.length - 1].push({ ...tk, x: xx });
      x = xx + tk.w;
    }
    return { lines, height: lines.length * lineH };
  };

  const items = messages.map((m) => ({ t: m.t, ...layout(m) })).sort((a, b) => a.t - b.t);
  const step = 1 / (fps || 15);
  const times = [0];
  for (const it of items) {
    if (it.t <= 0) continue;
    const q = Math.ceil(it.t / step - 1e-6) * step;
    if (q < duration && q - times[times.length - 1] > 1e-6) times.push(q);
  }
  window.api.chatRenderStart(id, times.length);

  const draw = (T) => {
    ctx.clearRect(0, 0, W, H);
    let y = H - pad;
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (it.t > T + 1e-6) continue;
      y -= it.height;
      if (y + it.height < 0) break;
      it.lines.forEach((line, li) => {
        const mid = y + li * lineH + lineH / 2;
        for (const tk of line) {
          const x = pad + tk.x;
          if (tk.kind === 'emote') {
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,0.65)';
            ctx.shadowBlur = 4;
            ctx.drawImage(tk.img, x, mid - emH / 2, tk.w, emH);
            ctx.restore();
            continue;
          }
          ctx.font = font(tk.kind === 'name' ? 800 : 600);
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = Math.max(3, F * 0.2);
          ctx.strokeStyle = 'rgba(0,0,0,0.9)';
          ctx.strokeText(tk.text, x, mid);
          ctx.fillStyle = tk.kind === 'name' ? tk.color : '#ffffff';
          ctx.fillText(tk.text, x, mid);
        }
      });
      y -= gap;
    }
  };
  const blob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
  for (let i = 0; i < times.length; i++) {
    draw(times[i]);
    const b = await blob();
    window.api.chatRenderFrame(id, i, times[i], new Uint8Array(await b.arrayBuffer()));
    if (i % 25 === 24) await new Promise((r) => setTimeout(r, 0));
  }
}

window.api.onChatRenderJob((job) => {
  renderJob(job)
    .then(() => window.api.chatRenderDone(job.id))
    .catch((e) => window.api.chatRenderError(job.id, e.message || String(e)));
});
window.api.chatRenderReady();
