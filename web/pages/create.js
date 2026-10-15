import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import { openNewSheet } from '../lib/newSheet';

// Creating happens in the New sheet. Old links land in the Library with the sheet open.
export default function CreateRedirect() {
  const router = useRouter();
  const { ready } = useRequireAuth();
  useEffect(() => {
    if (!ready || !router.isReady) return;
    const guideId = router.query.editGuideId;
    router.replace(guideId ? `/guide/${guideId}` : '/library').then(() => openNewSheet(guideId ? 'cards' : '', guideId ? { guideId } : {}));
  }, [ready, router.isReady]);
  return null;
}
