import { LayoutGrid, List } from 'lucide-react';

// The Rows / Cards switch beside a list: the app's shared segmented control, with icons.
export default function ViewToggle({ view, onChange }) {
  return (
    <div className="c-seg c-seg--icons" role="group" aria-label="View">
      <button type="button" className={view === 'rows' ? 'is-active' : ''} aria-pressed={view === 'rows'} aria-label="Rows" title="Rows" onClick={() => onChange('rows')}><List size={18} strokeWidth={2} aria-hidden="true" /></button>
      <button type="button" className={view === 'cards' ? 'is-active' : ''} aria-pressed={view === 'cards'} aria-label="Cards" title="Cards" onClick={() => onChange('cards')}><LayoutGrid size={18} strokeWidth={2} aria-hidden="true" /></button>
    </div>
  );
}
