import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import NotesIndex from '../components/smartnotes/NotesIndex';
import SmartNotesEditor from '../components/smartnotes/SmartNotesEditor';
import { useRequireAuth } from '../lib/auth';

// /smartnotes lists notes; /smartnotes?id=… opens one.
export default function SmartNotesPage({ timerState, setTimerState }) {
  const router = useRouter();
  const { ready } = useRequireAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !router.isReady || !ready) return null;
  if (!router.query.id) return <NotesIndex timerState={timerState} setTimerState={setTimerState} />;
  return <SmartNotesEditor />;
}
