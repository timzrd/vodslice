import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import BoxEditor from './BoxEditor.jsx';
import { Spinner } from './ui.jsx';

function attach(el, src, hlsList) {
  if (!el || !src) return;
  if (src.type === 'hls' && Hls.isSupported()) {
    const h = new Hls({
      maxBufferLength: 12,
      maxMaxBufferLength: 30,
      backBufferLength: 10,
      startLevel: -1,
      enableWorker: true,
      // route IP-bound YouTube segment URLs through the main-process proxy
      xhrSetup: (xhr, url) => {
        if (/googlevideo\.com/.test(url) && !url.startsWith('vsproxy:')) xhr.open('GET', `vsproxy://media/?u=${encodeURIComponent(url)}`, true);
      },
    });
    h.loadSource(src.url);
    h.attachMedia(el);
    hlsList.push(h);
  } else {
    el.src = src.url;
  }
}

const Player = forwardRef(function Player({ info, facecam, onFacecamRect, crop, onCropRect, editBoxes, aspectLock, onTime, onPlayState, volume = 1, muted = false, rate = 1, initialTime, children }, ref) {
  const wrap = useRef(null);
  const video = useRef(null);
  const audio = useRef(null);
  const hlsList = useRef([]);
  const rangeEnd = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [err, setErr] = useState(null);
  const aspect = info && info.width && info.height ? info.width / info.height : 16 / 9;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      let w = W;
      let h = w / aspect;
      if (h > H) {
        h = H;
        w = h * aspect;
      }
      setSize({ w: Math.floor(w), h: Math.floor(h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  // Source setup
  useEffect(() => {
    hlsList.current.forEach((h) => h.destroy());
    hlsList.current = [];
    setReady(false);
    setErr(null);
    const v = video.current;
    const a = audio.current;
    if (v) {
      v.removeAttribute('src');
      v.load();
    }
    if (a) {
      a.removeAttribute('src');
      a.load();
    }
    if (!info || !info.preview) return;
    attach(v, info.preview, hlsList.current);
    if (info.preview.audio) attach(a, info.preview.audio, hlsList.current);
    for (const h of hlsList.current)
      h.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) {
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
          else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) h.recoverMediaError();
          else setErr('Preview failed to load');
        }
      });
    const t0 = initialTime != null ? initialTime : info.startHint;
    if (t0) v.currentTime = t0;
    return () => {
      hlsList.current.forEach((h) => h.destroy());
      hlsList.current = [];
    };
  }, [info && info.cacheId]); // eslint-disable-line

  // Volume: squared curve so the lower steps are actually usable; applied to video and separate audio.
  useEffect(() => {
    const gain = Math.max(0, Math.min(1, volume)) ** 2;
    for (const el of [video.current, audio.current]) {
      if (!el) continue;
      el.volume = gain;
      el.muted = muted;
    }
  }, [volume, muted, info && info.cacheId]);

  useEffect(() => {
    for (const el of [video.current, audio.current]) if (el) el.playbackRate = rate;
  }, [rate, info && info.cacheId]);

  // Keep separate audio in sync, report time smoothly
  useEffect(() => {
    const v = video.current;
    const a = audio.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      onTime && onTime(v.currentTime);
      if (rangeEnd.current != null && v.currentTime >= rangeEnd.current) {
        v.pause();
        rangeEnd.current = null;
      }
      if (info && info.preview && info.preview.audio && a && !v.paused && Math.abs(a.currentTime - v.currentTime) > 0.3) a.currentTime = v.currentTime;
      raf = requestAnimationFrame(tick);
    };
    const hasA = () => info && info.preview && info.preview.audio;
    const onPlay = () => {
      if (hasA()) {
        a.currentTime = v.currentTime;
        a.play().catch(() => {});
      }
      onPlayState && onPlayState(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      if (hasA()) a.pause();
      onPlayState && onPlayState(false);
      cancelAnimationFrame(raf);
      onTime && onTime(v.currentTime);
    };
    const onSeeked = () => {
      if (hasA()) a.currentTime = v.currentTime;
      onTime && onTime(v.currentTime);
    };
    const onVol = () => {
      if (a) {
        a.volume = v.volume;
        a.muted = v.muted;
      }
    };
    const onCan = () => {
      setReady(true);
      setBuffering(false);
    };
    const onWait = () => setBuffering(true);
    const onErr = () => !hlsList.current.length && setErr('Preview not available');
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('seeking', onSeeked);
    v.addEventListener('volumechange', onVol);
    v.addEventListener('loadeddata', onCan);
    v.addEventListener('canplay', onCan);
    v.addEventListener('playing', onCan);
    v.addEventListener('waiting', onWait);
    v.addEventListener('error', onErr);
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('seeking', onSeeked);
      v.removeEventListener('volumechange', onVol);
      v.removeEventListener('loadeddata', onCan);
      v.removeEventListener('canplay', onCan);
      v.removeEventListener('playing', onCan);
      v.removeEventListener('waiting', onWait);
      v.removeEventListener('error', onErr);
    };
  }, [info, onTime, onPlayState]);

  useImperativeHandle(ref, () => ({
    seek(t) {
      const v = video.current;
      if (!v) return;
      rangeEnd.current = null;
      v.currentTime = Math.max(0, Math.min(info ? info.duration : 1e9, t));
      onTime && onTime(v.currentTime);
    },
    nudge(d) {
      this.seek((video.current ? video.current.currentTime : 0) + d);
    },
    toggle() {
      const v = video.current;
      if (!v) return;
      rangeEnd.current = null;
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    },
    pause() {
      video.current && video.current.pause();
    },
    playRange(s, e) {
      const v = video.current;
      if (!v) return;
      v.currentTime = s;
      rangeEnd.current = e;
      v.play().catch(() => {});
    },
    get time() {
      return video.current ? video.current.currentTime : 0;
    },
    get paused() {
      return video.current ? video.current.paused : true;
    },
  }));


  return (
    <div className="player" ref={wrap}>
      <div className="stage" style={{ width: size.w, height: size.h }}>
        {info && info.thumbnail && !ready && <img className="poster" src={info.thumbnail} alt="" />}
        <video
          ref={video}
          className="video"
          playsInline
          preload="auto"
          onClick={() => {
            const v = video.current;
            rangeEnd.current = null;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
        />
        <audio ref={audio} preload="auto" />
        {crop && crop.enabled && crop.rect && (
          <BoxEditor
            rect={crop.rect}
            stage={size}
            onChange={onCropRect}
            label={crop.premiere ? 'GAMEPLAY · PREMIERE' : `CROP ${crop.label || ''}`}
            srcW={info ? info.width : 1920}
            srcH={info ? info.height : 1080}
            aspectLock={crop.aspect}
            tone="crop"
            magnet
          />
        )}
        {facecam && facecam.enabled && facecam.rect && (
          <BoxEditor
            rect={facecam.rect}
            stage={size}
            onChange={onFacecamRect}
            label="FACECAM"
            srcW={info ? info.width : 1920}
            srcH={info ? info.height : 1080}
            editable={editBoxes}
            aspectLock={aspectLock}
            tone={facecam.confidence === 'low' ? 'warn' : 'accent'}
            shade={!(crop && crop.enabled)}
          />
        )}
        {(buffering || (!ready && info && info.preview)) && !err && (
          <div className="stage-badge">
            <Spinner /> {ready ? 'Buffering' : 'Loading preview'}
          </div>
        )}
        {err && <div className="stage-badge warn">{err}</div>}
        {children}
      </div>
    </div>
  );
});

export default Player;
