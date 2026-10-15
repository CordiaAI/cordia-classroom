import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import Toggle from './Toggle';

// Shared sets are anonymous unless you opt in to your first name.
export default function SharingSettings() {
  const [value, setValue] = useState(null);
  useEffect(() => {
    apiFetch('/sharing/settings').then(data => setValue(typeof data?.show_first_name === 'boolean' ? data.show_first_name : null));
  }, []);
  if (value === null) return null;
  async function change(next) {
    setValue(next);
    const data = await apiFetch('/sharing/settings', { method: 'PUT', body: JSON.stringify({ show_first_name: next }) });
    if (typeof data?.show_first_name === 'boolean') setValue(data.show_first_name);
  }
  return (
    <section className="c-card sharing-settings" aria-labelledby="sharing-title">
      <h2 id="sharing-title" className="c-section-title">Sharing</h2>
      <Toggle label="Show my first name" checked={value} onChange={change} />
      <style jsx>{`
        .sharing-settings { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding: 16px 24px; }
        .sharing-settings h2 { margin: 0; }
      `}</style>
    </section>
  );
}
