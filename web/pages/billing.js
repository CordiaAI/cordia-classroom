import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => {
    const query = router.query;
    if (!router.isReady) return;
    const params = new URLSearchParams({ section: 'plan' });
    if (query.billing) params.set('billing', query.billing);
    if (query.success === 'true') params.set('billing', 'success');
    if (query.cancelled === 'true') params.set('billing', 'cancelled');
    const qs = params.toString();
    router.replace('/settings?' + qs);
  }, [router.isReady, router.query]);

  return null;
}
