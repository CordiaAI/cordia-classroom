import { useEffect } from 'react';
import { useRouter } from 'next/router';

// The calendar lives inside Canvas now; old links land there.
export default function CalendarRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/canvas?tab=calendar'); }, [router]);
  return null;
}
