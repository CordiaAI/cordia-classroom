import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { apiFetch } from '../../lib/api';
import { useRequireAuth } from '../../lib/auth';
import { ArrowLeft } from 'lucide-react';
import NCLEXQuizMode from '../../components/NCLEXQuizMode';

export default function NCLEXPage() {
  const router = useRouter();
  const { guideId } = router.query;
  const { ready } = useRequireAuth();
  const [questions, setQuestions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (ready && guideId) loadNCLEX();
  }, [ready, guideId]);

  async function loadNCLEX() {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/nclex/' + guideId + '/generate');
      if (data?.questions?.length) {
        setQuestions(data.questions);
      } else {
        setError('NCLEX questions could not be written for this guide.');
      }
    } catch {
      setError('Failed to load NCLEX questions.');
    }
    setLoading(false);
  }

  const head = (
    <header className="c-page-head">
      <div className="c-row">
        <button type="button" className="c-icon-btn" onClick={() => router.push('/guide/' + guideId)} aria-label="Back to guide"><ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        <h1 className="c-title">NCLEX</h1>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="c-page" aria-busy="true">
        {head}
        <div className="c-skeleton" style={{ height: 280, borderRadius: 20 }} />
        <span className="c-meta" role="status">Writing questions…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="c-page">
        {head}
        <p className="retain-action-error" role="alert">{error}</p>
        <button type="button" className="c-btn c-btn--primary" onClick={loadNCLEX}>Retry</button>
      </div>
    );
  }

  return (
    <div className="c-page">
      {head}
      <NCLEXQuizMode questions={questions} guideId={guideId} />
    </div>
  );
}
