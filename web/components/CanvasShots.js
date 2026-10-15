// Drawn copies of the three Canvas screens a student uses to find their calendar feed,
// with the exact spot to click circled in olive. Colors follow the theme.
const TEXT = { fontFamily: 'Manrope, Arial, sans-serif', fontWeight: 600 };

function Mark({ cx, cy, rx = 30, ry = 22 }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" className="shot-mark" strokeWidth="4" />;
}

function Browser({ url, children, height = 220, label }) {
  return (
    <svg viewBox={`0 0 400 ${height}`} role="img" aria-label={label} className="canvas-shot">
      <rect x="1" y="1" width="398" height={height - 2} rx="14" className="shot-frame shot-edge" />
      <path d="M1 15a14 14 0 0 1 14-14h370a14 14 0 0 1 14 14v21H1z" className="shot-chrome" />
      {[16, 30, 44].map(x => <circle key={x} cx={x} cy="18" r="4.5" className="shot-line-fill" />)}
      <rect x="62" y="9" width="250" height="18" rx="9" className="shot-frame" />
      <text x="74" y="22" fontSize="11" style={TEXT} className="shot-text">{url}</text>
      {children}
      <style jsx global>{`
        .canvas-shot { display: block; width: 100%; height: auto; }
        .canvas-shot .shot-frame { fill: #FFFFFF; }
        .canvas-shot .shot-edge { stroke: rgba(34, 49, 41, 0.18); }
        .canvas-shot .shot-chrome { fill: #EEF1EC; }
        .canvas-shot .shot-line-fill { fill: rgba(34, 49, 41, 0.2); }
        .canvas-shot .shot-soft { fill: #F1F3EF; }
        .canvas-shot .shot-nav { fill: #394B58; }
        .canvas-shot .shot-nav-ink { fill: #FFFFFF; stroke: #FFFFFF; }
        .canvas-shot .shot-text { fill: #171B18; }
        .canvas-shot .shot-link { fill: #0B6BC2; }
        .canvas-shot .shot-mark { stroke: #536149; }
        [data-theme='dark'] .canvas-shot .shot-frame { fill: #2F3238; }
        [data-theme='dark'] .canvas-shot .shot-edge { stroke: rgba(255, 255, 255, 0.16); }
        [data-theme='dark'] .canvas-shot .shot-chrome { fill: #24272C; }
        [data-theme='dark'] .canvas-shot .shot-line-fill { fill: rgba(255, 255, 255, 0.22); }
        [data-theme='dark'] .canvas-shot .shot-soft { fill: #3A3E45; }
        [data-theme='dark'] .canvas-shot .shot-nav { fill: #1E2A33; }
        [data-theme='dark'] .canvas-shot .shot-text { fill: #FFFFFF; }
        [data-theme='dark'] .canvas-shot .shot-link { fill: #8CC4FF; }
        [data-theme='dark'] .canvas-shot .shot-mark { stroke: #C3CFB6; }
      `}</style>
    </svg>
  );
}

// Canvas: the left navigation with Calendar circled.
export function CanvasCalendarNav() {
  return (
    <Browser url="school.instructure.com" label="Canvas with Calendar circled in the left menu">
      <rect x="1" y="36" width="64" height="182" className="shot-nav" />
      {['Account', 'Dashboard', 'Courses', 'Calendar', 'Inbox'].map((label, i) => (
        <g key={label}>
          <rect x="22" y={46 + i * 34} width="22" height="14" rx="4" fill="none" className="shot-nav-ink" strokeWidth="1.6" style={{ fill: 'none' }} />
          <text x="33" y={74 + i * 34} fontSize="8" textAnchor="middle" style={{ ...TEXT, stroke: 'none' }} className="shot-nav-ink">{label}</text>
        </g>
      ))}
      <rect x="84" y="54" width="180" height="14" rx="4" className="shot-soft" />
      <rect x="84" y="80" width="290" height="110" rx="8" className="shot-soft" />
      <Mark cx={33} cy={160} rx={26} ry={20} />
    </Browser>
  );
}

// Canvas calendar: "Calendar Feed" at the bottom of the right sidebar, circled.
export function CanvasCalendarFeed() {
  return (
    <Browser url="school.instructure.com/calendar" label="Canvas Calendar with Calendar Feed circled in the right sidebar">
      <rect x="1" y="36" width="40" height="182" className="shot-nav" />
      <rect x="54" y="48" width="230" height="160" rx="6" className="shot-soft" />
      {[0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5, 6].map(c => <rect key={`${r}${c}`} x={60 + c * 32} y={70 + r * 34} width="28" height="30" rx="3" className="shot-frame" />))}
      <rect x="296" y="48" width="92" height="160" rx="6" className="shot-soft" />
      <rect x="304" y="58" width="60" height="9" rx="3" className="shot-line-fill" />
      <rect x="304" y="74" width="74" height="9" rx="3" className="shot-line-fill" />
      <text x="342" y="194" fontSize="12" textAnchor="middle" style={TEXT} className="shot-link">Calendar Feed</text>
      <Mark cx={342} cy={190} rx={50} ry={16} />
    </Browser>
  );
}

// The feed window: the link ending in .ics, circled.
export function CanvasFeedLink() {
  return (
    <Browser url="school.instructure.com/calendar" height={180} label="Calendar Feed window with the link ending in .ics circled">
      <rect x="60" y="56" width="280" height="104" rx="10" className="shot-frame shot-edge" />
      <text x="76" y="80" fontSize="13" style={TEXT} className="shot-text">Calendar Feed</text>
      <rect x="76" y="94" width="248" height="26" rx="5" className="shot-soft shot-edge" />
      <text x="84" y="111" fontSize="11" style={TEXT} className="shot-text">…/feeds/calendars/user_8Kc2.ics</text>
      <Mark cx={200} cy={107} rx={134} ry={20} />
    </Browser>
  );
}
