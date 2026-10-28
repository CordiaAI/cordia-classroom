import { useEffect, useState } from 'react';

// Rows or cards, one choice for every list (Library, a class's material), kept in this browser.
const KEY = 'cordiaLibraryView';

export function useListView() {
  const [view, setView] = useState('rows');
  useEffect(() => {
    try { if (localStorage.getItem(KEY) === 'cards') setView('cards'); } catch { /* storage blocked */ }
  }, []);
  function choose(next) {
    setView(next);
    try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
  }
  return [view, choose];
}
