import { useEffect, useRef, useState } from 'react';
import { Icon, Spinner } from './ui.jsx';

const BROWSERS = [
  { id: 'brave', name: 'Brave', color: '#fb542b' },
  { id: 'chrome', name: 'Chrome', color: '#4285f4' },
  { id: 'edge', name: 'Edge', color: '#0f9d58' },
  { id: 'firefox', name: 'Firefox', color: '#ff7139' },
  { id: 'opera', name: 'Opera', color: '#ff1b2d' },
];
const EXTENSION = 'https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc';
const EXTENSION_FF = 'https://addons.mozilla.org/firefox/addon/cookies-txt/';

/**
 * Guided YouTube / Twitch login: copies the user's own login from their browser once (browser must be closed for
 * a moment), or takes a cookies.txt exported with an extension. onDone() runs after a successful login.
 */
export default function LoginDialog({ settings, onClose, onDone }) {
  const d = settings.download;
  const [browser, setBrowser] = useState(d.loginFrom && d.loginFrom !== 'file' ? d.loginFrom : 'brave');
  const [step, setStep] = useState(d.cookiesFile ? 'status' : 'pick');
  const [res, setRes] = useState(null);
  const poll = useRef(0);
  const B = BROWSERS.find((b) => b.id === browser) || BROWSERS[0];

  const doImport = async () => {
    setStep('working');
    const r = await window.api.loginImport(browser);
    setRes(r);
    if (r.ok) setStep('done');
    else if (r.code === 'RUNNING') setStep('close');
    else if (r.code === 'NO_LOGIN') setStep('nologin');
    else if (r.code === 'ENCRYPTED') setStep('file');
    else setStep('error');
  };
  // waiting for the browser to close -> import automatically
  useEffect(() => {
    if (step !== 'close') return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const running = await window.api.loginRunning(browser);
      if (!alive) return;
      if (!running) doImport();
      else poll.current = setTimeout(tick, 1200);
    };
    poll.current = setTimeout(tick, 1200);
    return () => {
      alive = false;
      clearTimeout(poll.current);
    };
  }, [step, browser]); // eslint-disable-line

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const pickFile = async () => {
    const r = await window.api.loginFile();
    if (r.code === 'CANCELED') return;
    setRes(r);
    setStep(r.ok ? (r.code === 'NO_LOGIN' ? 'nologin-file' : 'done') : 'error');
  };

  return (
    <div className="modal-wrap" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal login">
        <div className="login-head">
          <h3>
            <Icon name="user" size={16} /> YouTube / Twitch login
          </h3>
          <button className="icon-btn sm" onClick={onClose} title="Close">
            <Icon name="x" size={14} />
          </button>
        </div>

        {step === 'status' && (
          <>
            <p className="login-ok">
              <Icon name="check" size={16} /> Signed in{d.loginFrom && d.loginFrom !== 'file' ? ` with your ${(BROWSERS.find((b) => b.id === d.loginFrom) || { name: d.loginFrom }).name} login` : ' with a cookies.txt'}
              {d.loginAt ? ` · ${new Date(d.loginAt).toLocaleDateString()}` : ''}
            </p>
            <p className="muted">If YouTube complains again, import it once more — logins expire after a while.</p>
            <div className="modal-actions">
              <button className="btn" onClick={() => window.api.loginClear().then(() => setStep('pick'))}>
                Sign out
              </button>
              <button className="btn primary" onClick={() => setStep('pick')}>
                Import again
              </button>
            </div>
          </>
        )}

        {step === 'pick' && (
          <>
            <p className="muted">Vodslice uses your own login so YouTube stops asking “are you a bot?” (also for sub-only and age-restricted videos). Only YouTube / Twitch cookies are copied — nothing else from your browser.</p>
            <div className="login-browsers">
              {BROWSERS.map((b) => (
                <button key={b.id} className={`login-br ${browser === b.id ? 'on' : ''}`} style={{ '--bc': b.color }} onClick={() => setBrowser(b.id)}>
                  <span className="lb-dot" />
                  {b.name}
                </button>
              ))}
            </div>
            <ol className="login-steps">
              <li>
                Be signed in to YouTube in <b>{B.name}</b>.
              </li>
              {browser !== 'firefox' && (
                <li>
                  Click the button — if {B.name} is still open, Vodslice asks you to close it for a moment.
                </li>
              )}
            </ol>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep('file')}>
                I have a cookies.txt
              </button>
              <button className="btn primary" onClick={doImport}>
                Use my {B.name} login
              </button>
            </div>
          </>
        )}

        {step === 'working' && (
          <p className="login-wait">
            <Spinner size={16} /> Reading your {B.name} login…
          </p>
        )}

        {step === 'close' && (
          <>
            <div className="login-big" style={{ '--bc': B.color }}>
              <Spinner size={18} />
              <div>
                <b>Close {B.name} completely</b>
                <span>Vodslice continues by itself as soon as it’s closed.</span>
              </div>
            </div>
            <ol className="login-steps">
              <li>Close every {B.name} window.</li>
              <li>
                Check the system tray (arrow next to the clock): if {B.name} is still there, right-click it → <b>Exit</b>.
              </li>
              <li>You can open {B.name} again right after — the login is copied once.</li>
            </ol>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep('file')}>
                Use cookies.txt instead
              </button>
              <button className="btn" onClick={() => setStep('pick')}>
                Back
              </button>
            </div>
          </>
        )}

        {(step === 'nologin' || step === 'nologin-file') && (
          <>
            <p className="login-warn">
              <Icon name="alert" size={15} /> {step === 'nologin' ? `No YouTube login found in ${B.name}.` : 'That cookies.txt has no YouTube login in it.'}
            </p>
            <ol className="login-steps">
              <li>
                Open{' '}
                <button className="link" onClick={() => window.api.openExternal('https://www.youtube.com')}>
                  youtube.com
                </button>{' '}
                in {step === 'nologin' ? B.name : 'your browser'} and sign in (top right).
              </li>
              <li>{step === 'nologin' ? `Close ${B.name} again, then try again.` : 'Export the cookies.txt again while you are on youtube.com.'}</li>
            </ol>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep('pick')}>
                Back
              </button>
              <button className="btn primary" onClick={step === 'nologin' ? doImport : pickFile}>
                Try again
              </button>
            </div>
          </>
        )}

        {step === 'file' && (
          <>
            {res && res.code === 'ENCRYPTED' && (
              <p className="login-warn">
                <Icon name="alert" size={15} /> {B.name} locks its cookies away from other apps. This way takes a minute:
              </p>
            )}
            <ol className="login-steps">
              <li>
                Install{' '}
                <button className="link" onClick={() => window.api.openExternal(browser === 'firefox' ? EXTENSION_FF : EXTENSION)}>
                  {browser === 'firefox' ? '“cookies.txt”' : '“Get cookies.txt LOCALLY”'}
                </button>{' '}
                in your browser.
              </li>
              <li>
                Open{' '}
                <button className="link" onClick={() => window.api.openExternal('https://www.youtube.com')}>
                  youtube.com
                </button>{' '}
                (signed in), click the extension → <b>Export</b>.
              </li>
              <li>Choose the downloaded file here:</li>
            </ol>
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep('pick')}>
                Back
              </button>
              <button className="btn primary" onClick={pickFile}>
                <Icon name="folder" size={14} /> Choose cookies.txt…
              </button>
            </div>
          </>
        )}

        {step === 'error' && (
          <>
            <p className="login-warn">
              <Icon name="alert" size={15} /> {res && res.code === 'NOT_FOUND' ? `${B.name} or its profile was not found.` : 'That did not work.'}
            </p>
            {res && res.error && <p className="login-err">{res.error}</p>}
            <div className="modal-actions">
              <button className="btn" onClick={() => setStep('pick')}>
                Back
              </button>
              <button className="btn primary" onClick={() => setStep('file')}>
                Use cookies.txt instead
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p className="login-ok big">
              <Icon name="check" size={18} /> Done — Vodslice now uses your YouTube login.
            </p>
            {browser !== 'firefox' && res && res.file && <p className="muted">You can open {B.name} again.</p>}
            <div className="modal-actions">
              <button
                className="btn primary"
                onClick={() => {
                  onClose();
                  onDone && onDone();
                }}
              >
                {onDone ? 'Load the video again' : 'Close'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
