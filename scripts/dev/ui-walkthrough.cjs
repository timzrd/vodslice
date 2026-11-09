// UI walkthrough of the v2 shell: home, YouTube channel, pick video, clips, context menu, Twitch chat activity.
module.exports = async (ctx) => {
  const { wait, exec, capture, main } = ctx;
  main.setBounds({ x: -5000, y: 0, width: 1920, height: 1040 });
  const log = (...a) => console.log('[test]', ...a);
  const until = async (js, ms = 60000, step = 400) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await exec(js)) return true;
      } catch {}
      await wait(step);
    }
    log('TIMEOUT', js);
    return false;
  };
  const click = async (x, y, button = 'left') => {
    main.webContents.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1 });
    await wait(40);
    main.webContents.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1 });
  };
  const rect = async (sel) => JSON.parse(await exec(`JSON.stringify((document.querySelector(${JSON.stringify(sel)})||{getBoundingClientRect:()=>null}).getBoundingClientRect())`));

  await until('!!window.__vs && !!window.__vs.setView');
  await wait(800);
  await capture('01-home');

  // search picker
  await exec(`(() => { const i = document.querySelector('.urlbox input'); i.focus(); })()`);
  main.webContents.insertText('DrDonut');
  await wait(200);
  main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await until(`!!document.querySelector('.site-picker')`, 5000);
  await capture('02-picker');
  await exec(`document.querySelector('.sp-btn.yt').click()`);
  await until(`document.querySelectorAll('.bc').length > 5`, 30000);
  await wait(1500);
  await capture('03-youtube-channel');
  log('yt cards', await exec(`document.querySelectorAll('.bc').length`));
  // scroll to load more
  await exec(`document.querySelector('.browse').scrollTop = 99999`);
  await until(`document.querySelectorAll('.bc').length > 31`, 20000);
  log('yt cards after scroll', await exec(`document.querySelectorAll('.bc').length`));
  await exec(`document.querySelector('.browse').scrollTop = 0`);
  await wait(500);

  // pick the 2nd stream -> flyer + editor
  await exec(`document.querySelectorAll('.bc')[1].click()`);
  await wait(250);
  await capture('04-morph');
  await until(`!!window.__vs.state().info && !window.__vs.state().info.stale`, 60000);
  await until(`!!document.querySelector('.stage video') && document.querySelector('.stage video').readyState >= 2`, 30000);
  await wait(2500);
  await capture('05-editor-loaded');
  const st = JSON.parse(await exec(`JSON.stringify({ src: window.__vs.state().activeSrc, dur: window.__vs.state().info.duration, sb: !!window.__vs.state().info.storyboard, heat: (window.__vs.state().info.heatmap||[]).length, project: window.__vs.state().project })`));
  log('editor', JSON.stringify(st));

  // clips via I/O and drag
  await exec(`window.__vs.seek(1200)`);
  await wait(600);
  await exec(`window.__vs.markIn()`);
  await exec(`window.__vs.seek(1260)`);
  await wait(400);
  await exec(`window.__vs.markOut()`);
  await wait(300);
  await exec(`window.__vs.addClip(2000, 2045)`);
  await exec(`window.__vs.addClip(3000, 3030)`);
  await exec(`window.__vs.seek(2010)`);
  await wait(1500);
  await capture('06-clips');
  log('clips', await exec(`JSON.stringify(window.__vs.state().clips.map(c => [c.segments[0].start, c.segments[0].end, c.on]))`));

  // wheel on timeline (pan) and ctrl+wheel (zoom)
  const z = await rect('.zoom');
  const v0 = await exec(`JSON.stringify(window.__vs.state().view)`);
  main.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(z.x + z.width / 2), y: Math.round(z.y + 50), deltaX: 0, deltaY: -240, canScroll: true });
  await wait(300);
  const v1 = await exec(`JSON.stringify(window.__vs.state().view)`);
  main.webContents.sendInputEvent({ type: 'mouseWheel', x: Math.round(z.x + z.width / 2), y: Math.round(z.y + 50), deltaX: 0, deltaY: -240, modifiers: ['control'], canScroll: true });
  await wait(300);
  const v2 = await exec(`JSON.stringify(window.__vs.state().view)`);
  log('wheel views', v0, v1, v2);

  // right-click on the active segment
  await exec(`window.__vs.seek(2010)`);
  await wait(800);
  const sg = await rect('.tseg');
  if (sg) {
    await click(Math.round(sg.x + sg.width / 2), Math.round(sg.y + sg.height / 2), 'right');
    await wait(400);
    await capture('07-context-menu');
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    await wait(200);
  }

  // scrub preview: start a drag on the progress bar
  const sc = await rect('.scrub-hit');
  if (sc) {
    const y = Math.round(sc.y + sc.height / 2);
    main.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(sc.x + sc.width * 0.3), y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      main.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(sc.x + sc.width * (0.3 + i * 0.02)), y, button: 'left', modifiers: ['leftButtonDown'] });
      await wait(25);
    }
    await capture('08-scrub-preview');
    main.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(sc.x + sc.width * 0.46), y, button: 'left', clickCount: 1 });
    await wait(500);
  }

  // Premiere preview
  await exec(`window.api.setSettings({ premiere: { enabled: true } })`);
  await wait(1500);
  await capture('09-premiere-preview');

  // Twitch channel + VOD with chat activity
  await exec(`window.__vs.openChannel({ site: 'twitch', ref: 'papaplatte' })`);
  await until(`document.querySelectorAll('.bc').length > 3`, 30000);
  await wait(1500);
  await capture('10-twitch-channel');
  const idx = await exec(`(() => { const cards = [...document.querySelectorAll('.bc')]; return cards.findIndex(c => !c.querySelector('.bc-badge.live') && c.querySelector('img')); })()`);
  await exec(`document.querySelectorAll('.bc')[${idx}].click()`);
  await until(`!!window.__vs.state().info && window.__vs.state().info.site === 'twitch' && !window.__vs.state().info.stale`, 60000);
  await until(`(() => { const s = window.__vs.state(); const c = s.chat[s.activeSrc]; return c && (c.data || c.error); })()`, 120000, 1000);
  await wait(2500);
  await capture('11-twitch-editor');
  log('chat', await exec(`(() => { const s = window.__vs.state(); const c = s.chat[s.activeSrc]; return JSON.stringify(c.error || { peaks: c.data.peaks.length, emotes: c.data.peaks.filter(p => p.emote).length, step: c.data.step }); })()`));
  await exec(`window.__vs.setView({ start: 1800, end: 3600 }, { free: true })`);
  await wait(800);
  await capture('12-twitch-timeline');

  await exec(`window.api.setSettings({ premiere: { enabled: false } })`);
  // home with projects
  await exec(`document.querySelector('.tabs button').click()`);
  await wait(1500);
  await capture('13-home-projects');
  log('projects', await exec(`document.querySelectorAll('.pj').length`));
};
