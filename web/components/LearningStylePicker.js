import { STYLE_OPTIONS } from '../lib/learningStyle';

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
        </button>
      ))}
    </div>
  );
}
