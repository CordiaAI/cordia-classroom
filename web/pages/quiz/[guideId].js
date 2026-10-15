import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Quiz lives inside the guide now.
export default function QuizRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (router.isReady) router.replace(`/guide/${router.query.guideId}?tab=quiz`);
  }, [router.isReady]);
  return null;
}
