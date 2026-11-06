import Head from 'next/head';
import { useRequireAuth } from '../../lib/auth';
import { pageTitle } from '../../lib/pageTitle';
import { CLASSROOMS_ON } from '../../lib/featureFlags';
import ClassroomList from '../../components/ClassroomList';

// Your classrooms: study groups and instructor classes you're in (social plan, Stage 5).
export default function ClassroomsPage() {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return (
    <div className="c-page">
      <Head><title>{pageTitle('Classrooms')}</title></Head>
      <header className="c-page-head"><h1 className="c-title">Classrooms</h1></header>
      {CLASSROOMS_ON ? <ClassroomList /> : <p className="c-card cr-off">Classrooms are coming soon.</p>}
      <style jsx>{`.cr-off { padding: 16px; margin: 0; }`}</style>
    </div>
  );
}
