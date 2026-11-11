// Mock of the TikTok / YouTube Shorts / Instagram Reels interface on top of the canvas, so you see what the
// buttons, name and caption will cover. Sizes are relative to the frame width (the apps scale with the screen).
const I = {
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 5.3 3 1.7-1.8 3.2-3 5.3-3 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z',
  comment: 'M12 3.5c5 0 9 3.4 9 7.6s-4 7.6-9 7.6c-.9 0-1.8-.1-2.6-.3L4.5 20.5l1.3-4.1C4.1 15 3 13.2 3 11.1c0-4.2 4-7.6 9-7.6Z',
  bookmark: 'M6 3h12v18l-6-4.4L6 21Z',
  share: 'M13 4.5 21.5 12 13 19.5v-4.3c-5.5 0-8.6 1.5-10.5 4.8.7-5.6 3.8-9.6 10.5-10.3Z',
  like: 'M2.5 10h4v11h-4ZM8.5 21h9.2c1 0 1.8-.7 2-1.6l1.7-7.3c.3-1.3-.7-2.6-2-2.6h-5.2l.8-3.9c.2-1-.3-2-1.2-2.4l-.6-.2L8.5 9.6Z',
  dislike: 'M21.5 14h-4V3h4ZM15.5 3H6.3c-1 0-1.8.7-2 1.6l-1.7 7.3c-.3 1.3.7 2.6 2 2.6h5.2l-.8 3.9c-.2 1 .3 2 1.2 2.4l.6.2 4.7-6.6Z',
  remix: 'M4 7h11l-3-3M20 17H9l3 3M18 7a4 4 0 0 1 0 8M6 17a4 4 0 0 1 0-8',
  send: 'M21.5 3 10 13.5M21.5 3l-7 18-4.5-7.5L2.5 9Z',
  dots: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  camera: 'M4 7h3l2-2.5h6L17 7h3v12H4ZM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  note: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3ZM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z',
  live: 'M3 6h18v12H3ZM8 10v4M12 10v4M16 10v4',
};
const STROKE = new Set(['remix', 'send', 'dots', 'search', 'camera', 'note', 'live']);

function Ico({ name, size }) {
  const stroke = STROKE.has(name);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={stroke ? 'none' : '#fff'} stroke={stroke ? '#fff' : 'none'} strokeWidth={stroke ? 2.2 : 0} strokeLinecap="round" strokeLinejoin="round">
      <path d={I[name]} />
    </svg>
  );
}

function Btn({ icon, label, fw }) {
  return (
    <div className="sz-btn">
      <Ico name={icon} size={fw * 0.085} />
      {label && <span style={{ fontSize: fw * 0.03 }}>{label}</span>}
    </div>
  );
}

export default function SafeZone({ kind, w, h }) {
  const fw = w;
  const t = (k) => ({ fontSize: fw * k });
  if (kind === 'tiktok')
    return (
      <div className="sz" style={{ width: w, height: h }}>
        <div className="sz-top" style={{ top: h * 0.025, ...t(0.038) }}>
          <span className="sz-l"><Ico name="live" size={fw * 0.06} /></span>
          <span className="sz-tabs">
            <em>Following</em> <b>For You</b>
          </span>
          <span className="sz-r"><Ico name="search" size={fw * 0.06} /></span>
        </div>
        <div className="sz-col" style={{ right: fw * 0.025, bottom: h * 0.13, gap: h * 0.022 }}>
          <div className="sz-avatar" style={{ width: fw * 0.11, height: fw * 0.11 }}>
            <i style={{ width: fw * 0.04, height: fw * 0.04, fontSize: fw * 0.035 }}>+</i>
          </div>
          <Btn icon="heart" label="248K" fw={fw} />
          <Btn icon="comment" label="1,204" fw={fw} />
          <Btn icon="bookmark" label="18K" fw={fw} />
          <Btn icon="share" label="Share" fw={fw} />
          <div className="sz-disc" style={{ width: fw * 0.1, height: fw * 0.1 }} />
        </div>
        <div className="sz-bottom" style={{ left: fw * 0.035, right: fw * 0.22, bottom: h * 0.035, ...t(0.034) }}>
          <b>@yourchannel</b>
          <p>this is where the video description goes #fyp #minecraft</p>
          <span className="sz-sound">
            <Ico name="note" size={fw * 0.035} /> original sound - yourchannel
          </span>
        </div>
      </div>
    );
  if (kind === 'shorts')
    return (
      <div className="sz" style={{ width: w, height: h }}>
        <div className="sz-top" style={{ top: h * 0.025, ...t(0.038) }}>
          <span />
          <span />
          <span className="sz-r">
            <Ico name="search" size={fw * 0.06} /> <Ico name="dots" size={fw * 0.06} />
          </span>
        </div>
        <div className="sz-col" style={{ right: fw * 0.025, bottom: h * 0.06, gap: h * 0.024 }}>
          <Btn icon="like" label="48K" fw={fw} />
          <Btn icon="dislike" label="Dislike" fw={fw} />
          <Btn icon="comment" label="1.2K" fw={fw} />
          <Btn icon="share" label="Share" fw={fw} />
          <Btn icon="remix" label="Remix" fw={fw} />
          <div className="sz-square" style={{ width: fw * 0.09, height: fw * 0.09 }} />
        </div>
        <div className="sz-bottom" style={{ left: fw * 0.035, right: fw * 0.2, bottom: h * 0.03, ...t(0.034) }}>
          <span className="sz-chan">
            <i className="sz-dot" style={{ width: fw * 0.075, height: fw * 0.075 }} />
            <b>@yourchannel</b>
            <em className="sz-sub" style={t(0.03)}>Subscribe</em>
          </span>
          <p>Short title goes here and can take two lines</p>
        </div>
      </div>
    );
  if (kind === 'reels')
    return (
      <div className="sz" style={{ width: w, height: h }}>
        <div className="sz-top" style={{ top: h * 0.025, ...t(0.05) }}>
          <b className="sz-l">Reels</b>
          <span />
          <span className="sz-r"><Ico name="camera" size={fw * 0.065} /></span>
        </div>
        <div className="sz-col" style={{ right: fw * 0.03, bottom: h * 0.06, gap: h * 0.026 }}>
          <Btn icon="heart" label="92K" fw={fw} />
          <Btn icon="comment" label="840" fw={fw} />
          <Btn icon="send" label="" fw={fw} />
          <Btn icon="dots" label="" fw={fw} />
          <div className="sz-square" style={{ width: fw * 0.08, height: fw * 0.08 }} />
        </div>
        <div className="sz-bottom" style={{ left: fw * 0.035, right: fw * 0.2, bottom: h * 0.03, ...t(0.034) }}>
          <span className="sz-chan">
            <i className="sz-dot" style={{ width: fw * 0.075, height: fw * 0.075 }} />
            <b>yourchannel</b>
            <em className="sz-follow" style={t(0.03)}>Follow</em>
          </span>
          <p>caption of the reel… more</p>
          <span className="sz-sound">
            <Ico name="note" size={fw * 0.035} /> yourchannel · Original audio
          </span>
        </div>
      </div>
    );
  return null;
}
