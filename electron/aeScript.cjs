// "Editable captions" for After Effects: an ExtendScript (.jsx) that builds a comp with one real text layer per
// caption — font, size, colors, stroke and position from the Premiere-tab preset, timing from the transcript.
// Run it in AE (File > Scripts > Run Script File…) or let Vodslice start AE with `AfterFX.exe -r <file>`.
const fs = require('node:fs');
const path = require('node:path');

/** JSON that ExtendScript (ES3) reads safely: non-ASCII as \u escapes. */
const esJson = (v) => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const rgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '#ffffff');
  const n = parseInt(m ? m[1] : 'ffffff', 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * @param o.name comp name; o.width/height/fps/duration; o.caps [{start, end, text}]; o.cap caption style;
 *        o.x/o.y caption center in frame px; o.u frame px per style px; o.font PostScript name
 */
function build(o) {
  const cap = o.cap;
  const stroke = (cap.effects || []).find((e) => e.on && e.type === 'stroke');
  const shadow = (cap.effects || []).find((e) => e.on && e.type === 'shadow');
  const D = {
    name: o.name,
    w: o.width,
    h: o.height,
    fps: Math.round(o.fps * 1000) / 1000,
    dur: Math.max(0.1, o.duration),
    font: o.font,
    size: Math.round(cap.size * o.u),
    fill: rgb(cap.color),
    stroke: stroke ? Math.round(stroke.width * 2 * o.u) : 0,
    strokeColor: rgb(stroke ? stroke.color : '#000000'),
    shadow: shadow ? { color: rgb(shadow.color), opacity: Math.round((shadow.opacity == null ? 0.6 : shadow.opacity) * 100), size: Math.round((shadow.blur || 0) * o.u), distance: Math.round((shadow.distance || 0) * o.u), angle: shadow.angle == null ? 90 : shadow.angle } : null,
    tracking: Math.round((cap.tracking || 0) * 10),
    x: Math.round(o.x),
    y: Math.round(o.y),
    pop: cap.anim && cap.anim.in && cap.anim.in !== 'none',
    caps: o.caps.map((c) => [Math.round(c.start * 1000) / 1000, Math.round(c.end * 1000) / 1000, c.text]),
  };
  return `// Vodslice — editable captions for After Effects
// Run it: File > Scripts > Run Script File... (creates the comp "${String(o.name).replace(/[^\x20-\x7e]/g, '?')}" in the open project)
(function () {
  var D = ${esJson(D)};
  app.beginUndoGroup('Vodslice captions');
  if (!app.project) app.newProject();
  var comp = app.project.items.addComp(D.name, D.w, D.h, 1, D.dur, D.fps);
  var missingFont = false;
  for (var i = D.caps.length - 1; i >= 0; i--) {
    var c = D.caps[i];
    var layer = comp.layers.addText(c[2]);
    layer.name = c[2];
    var src = layer.property('ADBE Text Properties').property('ADBE Text Document');
    var td = src.value;
    try { td.resetCharStyle(); } catch (e0) {}
    try { td.font = D.font; } catch (e1) { missingFont = true; }
    td.fontSize = D.size;
    td.applyFill = true;
    td.fillColor = D.fill;
    if (D.stroke > 0) {
      td.applyStroke = true;
      td.strokeColor = D.strokeColor;
      td.strokeWidth = D.stroke;
      td.strokeOverFill = false;
    } else td.applyStroke = false;
    td.tracking = D.tracking;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    src.setValue(td);
    layer.outPoint = Math.min(D.dur, c[1]);
    layer.inPoint = c[0];
    var r = layer.sourceRectAtTime(c[0], false);
    var tr = layer.property('ADBE Transform Group');
    tr.property('ADBE Anchor Point').setValue([r.left + r.width / 2, r.top + r.height / 2]);
    tr.property('ADBE Position').setValue([D.x, D.y]);
    if (D.pop) {
      var sc = tr.property('ADBE Scale');
      sc.setValueAtTime(c[0], [55, 55, 100]);
      sc.setValueAtTime(c[0] + 0.12, [108, 108, 100]);
      sc.setValueAtTime(c[0] + 0.2, [100, 100, 100]);
    }
    if (D.shadow) {
      try {
        var ds = layer.property('ADBE Effect Parade').addProperty('ADBE Drop Shadow');
        ds.property('ADBE Drop Shadow-0001').setValue(D.shadow.color.concat([1]));
        ds.property('ADBE Drop Shadow-0002').setValue(D.shadow.opacity * 2.55);
        ds.property('ADBE Drop Shadow-0003').setValue(D.shadow.angle + 90);
        ds.property('ADBE Drop Shadow-0004').setValue(D.shadow.distance);
        ds.property('ADBE Drop Shadow-0005').setValue(D.shadow.size);
      } catch (e2) {}
    }
  }
  comp.openInViewer();
  app.endUndoGroup();
  if (missingFont) alert('Vodslice: the font "' + D.font + '" is not installed - install it (Vodslice can do that in the Premiere tab) and run the script again.');
})();
`;
}

/** Newest installed After Effects (AfterFX.exe) or null. */
function findAfterEffects() {
  const roots = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramW6432'] || 'C:\\Program Files'].filter(Boolean);
  const found = [];
  for (const root of [...new Set(roots)]) {
    const adobe = path.join(root, 'Adobe');
    let dirs = [];
    try {
      dirs = fs.readdirSync(adobe).filter((d) => /^Adobe After Effects/i.test(d));
    } catch {
      continue;
    }
    for (const d of dirs) {
      const exe = path.join(adobe, d, 'Support Files', 'AfterFX.exe');
      if (fs.existsSync(exe)) found.push({ exe, name: d, year: Number((/(\d{4})/.exec(d) || [0, 0])[1]) });
    }
  }
  found.sort((a, b) => b.year - a.year);
  return found[0] || null;
}

module.exports = { build, findAfterEffects };
