export default function Logo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d4ff3f" />
          <stop offset="1" stopColor="#7cf5c4" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#15181d" stroke="#2a2f37" />
      <path d="M11 8.5v15l12.5-7.5z" fill="url(#lg)" />
      <path d="M7 21.5 25 10" stroke="#15181d" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
