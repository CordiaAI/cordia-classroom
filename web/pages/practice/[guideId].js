import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Practice lives inside the guide now.
export default function PracticeRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (router.isReady) router.replace(`/guide/${router.query.guideId}?tab=practice`);
  }, [router.isReady]);
  return null;
}
