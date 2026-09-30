import { STYLE_OPTIONS } from '../lib/learningStyle';

function Diagram({ branches = true }) {
  // One point with two edges; one of those points branches into two more.
  return (
    <svg viewBox="0 0 120 64" aria-hidden="true" className="style-example-diagram">
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <path d="M18 32 L58 14 M18 32 L58 50" />
        {branches && <path d="M58 14 L100 6 M58 14 L100 26" />}
      </g>
      <g fill="currentColor">
        <circle cx="18" cy="32" r="5" /><circle cx="58" cy="14" r="5" /><circle cx="58" cy="50" r="5" />
        {branches && <><circle cx="100" cy="6" r="4.5" /><circle cx="100" cy="26" r="4.5" /></>}
      </g>
    </svg>
  );
}

const Speaker = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
);
const Mic = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="1.5" width="5" height="8" rx="2.5" fill="currentColor" /><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5" stroke="currentColor" strokeWidth="1.4" fill="none" /></svg>
);
const Line = ({ width }) => <span className="style-example-line" style={{ width }} />;

function StyleExample({ id }) {
  if (id === 'visual') return <Diagram />;
  if (id === 'aural') return (
    <div className="style-example-talk">
      <span><Speaker /> <Line width="70%" /></span>
      <span className="reply"><Mic /> <Line width="55%" /></span>
    </div>
  );
  if (id === 'read_write') return (
    <div className="style-example-notes">
      <span><strong>Term</strong> <Line width="55%" /></span>
      <span>• <Line width="80%" /></span>
      <span>• <Line width="65%" /></span>
    </div>
  );
  if (id === 'kinesthetic') return (
    <div className="style-example-apply">
      <small>Example</small><Line width="85%" />
      <small>Your turn</small><Line width="60%" />
    </div>
  );
  return (
    <div className="style-example-mix">
      <Diagram branches={false} />
      <div className="style-example-apply"><small>Example</small><Line width="80%" /></div>
    </div>
  );
}

export default function LearningStylePicker({ value, onSelect, disabled = false }) {
  return (
    <div className="learning-style-options" role="radiogroup" aria-label="How you like to study">
      {STYLE_OPTIONS.map(option => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={'learning-style-option' + (value === option.id ? ' selected' : '')}
          onClick={() => onSelect(option.id)}
          disabled={disabled}
        >
          <strong>{option.label}</strong>
          <span>{option.hint}</span>
          <div className="style-example" aria-hidden="true"><StyleExample id={option.id} /></div>
          <ul className="style-uses">
            {option.uses.map(use => <li key={use}>{use}</li>)}
          </ul>
        </button>
      ))}
    </div>
  );
}
