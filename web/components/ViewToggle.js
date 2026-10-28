import { LayoutGrid, List } from 'lucide-react';

// The Rows / Cards switch beside a list.
export default function ViewToggle({ view, onChange }) {
  return (
    <div className="c-viewtoggle" role="group" aria-label="View">
      <button type="button" className="c-icon-btn" aria-pressed={view === 'rows'} aria-label="Rows" title="Rows" onClick={() => onChange('rows')}><List size={20} strokeWidth={1.75} aria-hidden="true" /></button>
      <button type="button" className="c-icon-btn" aria-pressed={view === 'cards'} aria-label="Cards" title="Cards" onClick={() => onChange('cards')}><LayoutGrid size={20} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>
  );
}
