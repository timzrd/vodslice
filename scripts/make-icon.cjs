// Renders the app icon (same design as src/components/Logo.jsx) to PNG without any dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const S = 512;
const SS = 4; // supersampling per axis

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x));
  const cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function inTri(x, y) {
  const [ax, ay, bx, by, cx, cy] = [11, 8.5, 11, 23.5, 23.5, 16];
  const s = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = s(x, y, ax, ay, bx, by);
  const d2 = s(x, y, bx, by, cx, cy);
  const d3 = s(x, y, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function distSeg(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}
const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const A = hex('#d4ff3f');
const B = hex('#7cf5c4');

function sample(x, y) {
  // returns [r,g,b,a]
  if (!inRoundRect(x, y, 0.6, 0.6, 31.4, 31.4, 8)) return [0, 0, 0, 0];
  const border = !inRoundRect(x, y, 1.3, 1.3, 30.7, 30.7, 7.3);
  let c = border ? [52, 58, 69] : [lerp(26, 13, y / 32), lerp(30, 15, y / 32), lerp(37, 19, y / 32)];
  if (inTri(x, y) && distSeg(x, y, 7, 21.5, 25, 10) > 1.3) {
    const t = Math.max(0, Math.min(1, (x - 11 + (y - 8.5)) / 27));
    c = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
  }
  return [...c, 255];
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = ((i + (sx + 0.5) / SS) / size) * 32;
          const y = ((j + (sy + 0.5) / SS) / size) * 32;
          const c = sample(x, y);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      const o = (j * size + i) * 4;
      px[o] = a ? r / a : 0;
      px[o + 1] = a ? g / a : 0;
      px[o + 2] = a ? b / a : 0;
      px[o + 3] = a / (SS * SS);
    }
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const root = path.join(__dirname, '..');
const img = png(S, render(S));
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'public'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), img);
fs.writeFileSync(path.join(root, 'public', 'icon.png'), png(256, render(256)));
console.log('icon written');
