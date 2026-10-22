// Small circular progress. value is 0..1.
export default function ProgressRing({ value = 0, size = 40, stroke = 4, label = true, title }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(pct * 100);
  return (
    <span className="c-ring" style={{ width: size, height: size }} role="img" aria-label={title || `${percent}% done`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="c-ring-track" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} />
        <circle className="c-ring-fill" cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct)} style={{ '--ring-full': circumference }} />
      </svg>
      {label && size >= 40 && <span aria-hidden="true">{percent}</span>}
    </span>
  );
}
