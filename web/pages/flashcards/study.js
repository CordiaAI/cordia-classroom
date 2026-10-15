import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Cards live inside the guide now.
export default function FlashcardStudy() {
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    router.replace(router.query.guideId ? `/guide/${router.query.guideId}?tab=cards` : '/library?tab=cards');
  }, [router.isReady]);
  return null;
}
