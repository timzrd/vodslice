// Drives the real app window (off-screen) and saves screenshots.
//   PowerShell:
//     $env:VODSLICE_TEST_SCRIPT = "$PWD\scripts\dev\ui-test-example.cjs"
//     $env:VODSLICE_TEST_OUT = "$env:TEMP"
//     .\node_modules\electron\dist\electron.exe .
// NOTE: shares %APPDATA%\Vodslice\settings.json with the installed app — back it up before, restore after.
// ctx: { main, mini, createMini, wait(ms), exec(js, win?), capture(name, win?), engine, store }
module.exports = async (ctx) => {
  const { wait, exec, capture, main } = ctx;
  for (let i = 0; i < 50 && !(await exec('!!window.__vs')); i++) await wait(200);
  await exec(`window.__vs.load("https://www.youtube.com/watch?v=BMmCVdm0w84&t=5460")`);
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    if (await exec(`!!document.querySelector('.tseg')`)) break;
  }
  await wait(2500);
  console.log('[test] state', await exec('JSON.stringify({ clips: window.__vs.state().clips.length, playhead: window.__vs.state().playhead })'));
  await capture('vodslice-editor');

  // real mouse input example: drag the end handle of the selected segment 100 px to the right
  const r = JSON.parse(await exec(`JSON.stringify(document.querySelector('.tseg.active .seg-h.r').getBoundingClientRect())`));
  const x = Math.round(r.x + r.width / 2);
  const y = Math.round(r.y + r.height / 2);
  main.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 10; i++) {
    main.webContents.sendInputEvent({ type: 'mouseMove', x: x + i * 10, y, button: 'left', modifiers: ['leftButtonDown'] });
    await wait(30);
  }
  main.webContents.sendInputEvent({ type: 'mouseUp', x: x + 100, y, button: 'left', clickCount: 1 });
  await wait(500);
  console.log('[test] segment', await exec('JSON.stringify(window.__vs.state().clips[0].segments[0])'));
  await capture('vodslice-after-drag');
};
