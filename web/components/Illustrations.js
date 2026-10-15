// Drawn recreations of the real screens a student uses outside Cordia, with the exact
// thing to click circled in olive. Theme-aware (tokens), no text under 13px when scaled.
// A real screenshot can replace any of these: pass `src` to <Shot>.

const S = {
  frame: 'var(--illus-frame)', chrome: 'var(--illus-chrome)', line: 'var(--illus-line)', text: 'var(--illus-text)',
  soft: 'var(--illus-soft)', nav: 'var(--illus-canvas-nav)', navInk: 'var(--illus-canvas-nav-ink)', link: 'var(--illus-link)', mark: 'var(--illus-mark)',
};
const TEXT = { fontFamily: 'Manrope, Arial, sans-serif', fontWeight: 600 };

function Mark({ cx, cy, rx = 30, ry = 22 }) {
  return (
    <g>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" style={{ stroke: S.mark }} strokeWidth="4" />
      <ellipse className="illus-pulse" cx={cx} cy={cy} rx={rx + 6} ry={ry + 6} fill="none" style={{ stroke: S.mark }} strokeWidth="2" opacity=".45" />
    </g>
  );
}

function Browser({ url, children, height = 220 }) {
  return (
    <svg viewBox={`0 0 400 ${height}`} role="img" className="illus">
      <rect x="1" y="1" width="398" height={height - 2} rx="14" style={{ fill: S.frame, stroke: S.line }} />
      <path d={`M1 15a14 14 0 0 1 14-14h370a14 14 0 0 1 14 14v21H1z`} style={{ fill: S.chrome }} />
      {[16, 30, 44].map(x => <circle key={x} cx={x} cy="18" r="4.5" style={{ fill: S.line }} />)}
      <rect x="62" y="9" width="250" height="18" rx="9" style={{ fill: S.frame }} />
      <text x="74" y="22" fontSize="11" style={{ ...TEXT, fill: S.text }}>{url}</text>
      {children}
    </svg>
  );
}

// Canvas: the global nav on the left with Calendar circled.
export function CanvasCalendarNav() {
  return (
    <Browser url="school.instructure.com">
      <rect x="1" y="36" width="64" height="182" style={{ fill: S.nav }} />
      {['Account', 'Dashboard', 'Courses', 'Calendar', 'Inbox'].map((label, i) => (
        <g key={label}>
          <rect x="22" y={46 + i * 34} width="22" height="14" rx="4" fill="none" style={{ stroke: S.navInk }} strokeWidth="1.6" />
          <text x="33" y={74 + i * 34} fontSize="8" textAnchor="middle" style={{ ...TEXT, fill: S.navInk }}>{label}</text>
        </g>
      ))}
      <rect x="84" y="54" width="180" height="14" rx="4" style={{ fill: S.soft }} />
      <rect x="84" y="80" width="290" height="110" rx="8" style={{ fill: S.soft }} />
      <Mark cx={33} cy={160} rx={26} ry={20} />
    </Browser>
  );
}

// Canvas calendar: "Calendar Feed" at the bottom of the right sidebar, circled.
export function CanvasCalendarFeed() {
  return (
    <Browser url="school.instructure.com/calendar">
      <rect x="1" y="36" width="40" height="182" style={{ fill: S.nav }} />
      <rect x="54" y="48" width="230" height="160" rx="6" style={{ fill: S.soft }} />
      {[0, 1, 2, 3].map(r => [0, 1, 2, 3, 4, 5, 6].map(c => <rect key={`${r}${c}`} x={60 + c * 32} y={70 + r * 34} width="28" height="30" rx="3" style={{ fill: S.frame }} />))}
      <rect x="296" y="48" width="92" height="160" rx="6" style={{ fill: S.soft }} />
      <rect x="304" y="58" width="60" height="9" rx="3" style={{ fill: S.line }} />
      <rect x="304" y="74" width="74" height="9" rx="3" style={{ fill: S.line }} />
      <text x="342" y="194" fontSize="12" textAnchor="middle" style={{ ...TEXT, fill: S.link }}>Calendar Feed</text>
      <Mark cx={342} cy={190} rx={50} ry={16} />
    </Browser>
  );
}

// The feed dialog: the link ending in .ics, selected.
export function CanvasFeedLink() {
  return (
    <Browser url="school.instructure.com/calendar" height={180}>
      <rect x="60" y="56" width="280" height="104" rx="10" style={{ fill: S.frame, stroke: S.line }} />
      <text x="76" y="80" fontSize="13" style={{ ...TEXT, fill: S.text }}>Calendar Feed</text>
      <rect x="76" y="94" width="248" height="26" rx="5" style={{ fill: S.soft, stroke: S.line }} />
      <text x="84" y="111" fontSize="11" style={{ ...TEXT, fill: S.text }}>…/feeds/calendars/user_8Kc2.ics</text>
      <Mark cx={200} cy={107} rx={134} ry={20} />
    </Browser>
  );
}

// Chrome Web Store: "Add to Chrome" circled.
export function ChromeAddToChrome() {
  return (
    <Browser url="chromewebstore.google.com">
      <rect x="24" y="56" width="44" height="44" rx="10" style={{ fill: S.soft }} />
      <text x="84" y="76" fontSize="14" style={{ ...TEXT, fill: S.text }}>CordiaClassroom</text>
      <rect x="84" y="86" width="120" height="8" rx="3" style={{ fill: S.line }} />
      <rect x="276" y="62" width="104" height="30" rx="15" style={{ fill: S.link }} />
      <text x="328" y="81" fontSize="12" textAnchor="middle" style={{ ...TEXT, fill: S.frame }}>Add to Chrome</text>
      <Mark cx={328} cy={77} rx={64} ry={24} />
      <rect x="24" y="120" width="352" height="80" rx="8" style={{ fill: S.soft }} />
    </Browser>
  );
}

// Chrome toolbar: puzzle-piece menu open, pin next to CordiaClassroom circled.
export function ChromePin() {
  return (
    <Browser url="canvas.school.edu" height={200}>
      <g transform="translate(330 9)">
        <rect width="18" height="18" rx="4" style={{ fill: S.soft }} />
        <path d="M5 13V7h3a2 2 0 1 1 4 0h1v3a2 2 0 1 1 0 4" fill="none" style={{ stroke: S.text }} strokeWidth="1.4" />
      </g>
      <rect x="196" y="40" width="190" height="96" rx="10" style={{ fill: S.frame, stroke: S.line }} />
      <text x="210" y="62" fontSize="12" style={{ ...TEXT, fill: S.text }}>Extensions</text>
      <rect x="210" y="76" width="18" height="18" rx="4" style={{ fill: S.mark }} />
      <text x="236" y="90" fontSize="12" style={{ ...TEXT, fill: S.text }}>CordiaClassroom</text>
      <path d="M358 80l6 6-3 3 3 6-2 2-6-3-3 3-6-6 3-3-3-6 2-2 6 3z" fill="none" style={{ stroke: S.text }} strokeWidth="1.4" />
      <Mark cx={358} cy={88} rx={18} ry={16} />
    </Browser>
  );
}

// Extension popup on a course page: "Make study guide" circled.
export function ChromeCapture() {
  return (
    <Browser url="canvas.school.edu/courses/1/pages">
      <rect x="20" y="52" width="200" height="12" rx="4" style={{ fill: S.soft }} />
      <rect x="20" y="74" width="230" height="8" rx="3" style={{ fill: S.soft }} />
      <rect x="20" y="90" width="210" height="8" rx="3" style={{ fill: S.soft }} />
      <rect x="250" y="44" width="136" height="150" rx="12" style={{ fill: S.frame, stroke: S.line }} />
      <text x="264" y="68" fontSize="12" style={{ ...TEXT, fill: S.text }}>Cordia</text>
      <rect x="264" y="146" width="108" height="30" rx="15" style={{ fill: S.mark }} />
      <text x="318" y="165" fontSize="11" textAnchor="middle" style={{ ...TEXT, fill: S.frame }}>Make study guide</text>
      <Mark cx={318} cy={161} rx={64} ry={22} />
    </Browser>
  );
}

// Browser microphone prompt: "Allow" circled.
export function MicAllow() {
  return (
    <Browser url="classroom.cordiacode.com" height={170}>
      <rect x="20" y="40" width="220" height="104" rx="10" style={{ fill: S.frame, stroke: S.line }} />
      <text x="36" y="66" fontSize="12" style={{ ...TEXT, fill: S.text }}>Use your microphone?</text>
      <rect x="36" y="104" width="64" height="26" rx="13" style={{ fill: S.soft }} />
      <text x="68" y="121" fontSize="11" textAnchor="middle" style={{ ...TEXT, fill: S.text }}>Block</text>
      <rect x="160" y="104" width="64" height="26" rx="13" style={{ fill: S.link }} />
      <text x="192" y="121" fontSize="11" textAnchor="middle" style={{ ...TEXT, fill: S.frame }}>Allow</text>
      <Mark cx={192} cy={117} rx={42} ry={20} />
    </Browser>
  );
}
