import { ChevronDown } from 'lucide-react';
import Menu from './Menu';

// One class or "All classes", for the chat home's top bar and the composer (DESIGN-SPEC 4.1, 4.2):
// a quiet button with the class's colour dot, its code and a chevron, opening a small glass menu.
// classes: [{ id, code, name, tone }] (components/Sidebar.js sidebarClasses); value: an id or ''.
export default function ClassPicker({ classes = [], value = '', onChange, size = 'md' }) {
  const picked = classes.find(item => String(item.id) === String(value)) || null;
  const dot = tone => function ClassDot() {
    // "All classes" keeps the dot's slot, so every label starts on one line, but draws nothing.
    return <span className={'c-class-dot' + (tone ? '' : ' is-none')} style={tone ? { '--dot': `var(--cover-ink-${tone})` } : undefined} aria-hidden="true" />;
  };
  const items = [
    { key: 'all', label: 'All classes', icon: dot(0), current: !picked, onSelect: () => onChange('') },
    ...classes.map(item => ({ key: String(item.id), label: item.code, meta: item.name !== item.code ? item.name : undefined, icon: dot(item.tone), current: picked?.id === item.id, onSelect: () => onChange(String(item.id)) })),
  ];
  return (
    <Menu
      label={`Class: ${picked ? picked.code : 'All classes'}`}
      align="left"
      items={items}
      triggerClassName={`c-class-picker is-${size}`}
      trigger={<>
        {picked && <span className="c-class-dot" style={{ '--dot': `var(--cover-ink-${picked.tone})` }} aria-hidden="true" />}
        <span className="c-class-picker-label">{picked ? picked.code : 'All classes'}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </>}
    />
  );
}
