import { MONTHS, birthYears } from '../lib/age.mjs';

// Birth month and year, nothing pre-picked (a neutral age question: it doesn't hint at any age).
export default function AgeFields({ month, year, onMonth, onYear, idPrefix = 'age', disabled = false }) {
  return (
    <fieldset className="age-fields" disabled={disabled}>
      <legend className="age-legend">When were you born?</legend>
      <div className="age-row">
        <label className="age-field">
          <span>Month</span>
          <select className="c-select age-select" value={month} onChange={event => onMonth(event.target.value)} id={`${idPrefix}-month`}>
            <option value="">Month</option>
            {MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
          </select>
        </label>
        <label className="age-field">
          <span>Year</span>
          <select className="c-select age-select" value={year} onChange={event => onYear(event.target.value)} id={`${idPrefix}-year`}>
            <option value="">Year</option>
            {birthYears().map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <style jsx>{`
        .age-fields { display: grid; gap: 6px; margin: 0; padding: 0; border: 0; min-width: 0; }
        .age-legend { padding: 0; margin-bottom: 6px; font: 600 13px/1.15 var(--font-sans); color: var(--ink); }
        .age-row { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 8px; }
        .age-field { display: grid; gap: 4px; min-width: 0; }
        .age-field > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .age-select { width: 100%; height: 48px; }
      `}</style>
    </fieldset>
  );
}
