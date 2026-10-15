import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Card sets now live in Library → Cards.
export default function FlashcardsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/library?tab=cards'); }, [router]);
  return null;
}
