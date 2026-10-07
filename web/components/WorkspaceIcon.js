const paths = {
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  study: 'M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1Zm0 0v15',
  notes: 'M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7M9 16h7',
  flashcards: 'M7 3h13v14H7zM4 7H2v14h13v-2',
  practice: 'm8 12 3 3 5-6M5 3h14v18H5z',
  calendar: 'M4 5h16v16H4zM8 2v6M16 2v6M4 10h16',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21v-2a8 8 0 0 1 16 0v2',
  tutor: 'M4 5h16v12H9l-5 4V5Zm4 5h8M8 13h5',
  chevron: 'm14 6-6 6 6 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
};

export default function WorkspaceIcon({ name, className = '' }) {
  return <svg className={className} viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.study} /></svg>;
}
