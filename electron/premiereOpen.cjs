// "Open in Premiere": Premiere doesn't accept an XML on the command line, so we bring the running Premiere
// window to the front and import through its own Import dialog (Ctrl+I → paste path → Enter).
// Only types into the dialog once it is really open (checks the foreground window title).
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function findPremiere() {
  const roots = [process.env.ProgramFiles || 'C:\\Program Files', process.env.ProgramW6432].filter(Boolean);
  const found = [];
  for (const r of roots) {
    const adobe = path.join(r, 'Adobe');
    if (!fs.existsSync(adobe)) continue;
    for (const d of fs.readdirSync(adobe)) {
      if (!/^Adobe Premiere Pro/i.test(d)) continue;
      const exe = path.join(adobe, d, 'Adobe Premiere Pro.exe');
      if (fs.existsSync(exe)) found.push({ exe, name: d });
    }
  }
  return found.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))[0] || null;
}

const PS = String.raw`
param([string]$xml)
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  public static string Title(IntPtr h){ var b = new StringBuilder(512); GetWindowText(h, b, 512); return b.ToString(); }
}
"@
Add-Type -AssemblyName System.Windows.Forms
$p = Get-Process 'Adobe Premiere Pro' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $p) { 'NOT_RUNNING'; exit }
if ($p.MainWindowTitle -notmatch '\.prproj') { 'NO_PROJECT'; exit }
$h = $p.MainWindowHandle
if ([W]::IsIconic($h)) { [void][W]::ShowWindow($h, 9) }
# ALT tap lets a background process take the foreground on Windows
[W]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [W]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
[void][W]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 500
if ([W]::GetForegroundWindow() -ne $h) { 'NO_FOCUS'; exit }
[System.Windows.Forms.SendKeys]::SendWait('^i')
$ok = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 150
  $t = [W]::Title([W]::GetForegroundWindow())
  if ($t -match '^(Import|Importieren)$') { $ok = $true; break }
}
if (-not $ok) { 'NO_DIALOG'; exit }
Set-Clipboard -Value $xml
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
'OK'
`;

/** Import the XML into the open Premiere project. Returns {ok, code, app}. */
function importIntoPremiere(xml) {
  return new Promise((resolve) => {
    const pr = findPremiere();
    if (!pr) return resolve({ ok: false, code: 'NOT_INSTALLED' });
    const script = path.join(require('node:os').tmpdir(), 'vodslice-premiere-import.ps1');
    fs.writeFileSync(script, '\ufeff' + PS);
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script, '-xml', xml], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      const code = String(stdout || '').trim().split(/\r?\n/).pop() || (err ? 'ERROR' : '');
      if (code === 'NOT_RUNNING') {
        // start Premiere; the user opens a project, then clicks again
        execFile(pr.exe, [], { windowsHide: false, detached: true }).unref?.();
      }
      resolve({ ok: code === 'OK', code, app: pr.name });
    });
  });
}

module.exports = { findPremiere, importIntoPremiere };
