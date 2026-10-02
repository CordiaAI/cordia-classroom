import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { apiErrorMessage, apiFetch, getToken, LIMIT_EVENT, UPGRADE_EVENT } from '../lib/api';
import { FEATURE_COPY, FREE_SUMMARY, PRICES, PRO_BENEFITS, PRO_NAME, resetLabel } from '../lib/plans';

// One upgrade window for the whole app. It opens when:
//   - any API call returns 402 limit_reached (lib/api.js fires LIMIT_EVENT)
//   - any button calls openUpgrade()                (UPGRADE_EVENT)
//   - a 7-day trial has ended and the student hasn't been asked yet (on load)
// It also confirms a Checkout that returned to a page other than Settings.
export default function UpgradeModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('limit'); // limit | upgrade | trial_ended
  const [limit, setLimit] = useState(null);
  const [status, setStatus] = useState(null);
  const [interval, setPlanInterval] = useState('monthly');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const loadStatus = useCallback(async () => {
    const data = await apiFetch('/billing/status');
    if (data?.plan) setStatus(data);
    return data;
  }, []);

  const show = useCallback((nextMode, detail) => {
    setMode(nextMode);
    setLimit(detail || null);
    setError('');
    setOpen(true);
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const onLimit = event => show('limit', event.detail);
    const onUpgrade = event => show(event.detail?.feature ? 'limit' : 'upgrade', event.detail?.feature ? event.detail : null);
    window.addEventListener(LIMIT_EVENT, onLimit);
    window.addEventListener(UPGRADE_EVENT, onUpgrade);
    return () => {
      window.removeEventListener(LIMIT_EVENT, onLimit);
      window.removeEventListener(UPGRADE_EVENT, onUpgrade);
    };
  }, [show]);

  // After login / on load: ask once when a trial has ended. Never auto-subscribes.
  useEffect(() => {
    if (!getToken()) return;
    loadStatus().then(data => {
      if (data?.trial_ended_prompt) show('trial_ended');
    });
  }, [loadStatus, show]);

  // Deep link from the extension or emails: any page + ?upgrade=1 opens the window.
  useEffect(() => {
    if (router.isReady && router.query.upgrade === '1' && getToken()) show('upgrade');
  }, [router.isReady, router.query.upgrade, show]);

  // Checkout can return to the page the student was on; confirm it here (Settings does its own).
  useEffect(() => {
    if (!router.isReady || router.pathname === '/settings') return;
    const { billing, session_id: sessionId, ...rest } = router.query;
    if (billing !== 'success' && billing !== 'cancelled') return;
    const clean = () => router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    if (billing === 'cancelled' || typeof sessionId !== 'string') {
      clean();
      return;
    }
    apiFetch('/billing/confirm-checkout', { method: 'POST', body: JSON.stringify({ session_id: sessionId }) })
      .then(data => {
        setToast(data?.plan === 'classroom_plus' ? `${PRO_NAME} is active. Try that again.` : 'We are still confirming your payment. Refresh in a minute.');
        if (data?.plan) setStatus(data);
        clean();
      });
  }, [router.isReady, router.query, router.pathname]);

  function close() {
    if (mode === 'trial_ended') apiFetch('/billing/trial-prompt-seen', { method: 'POST' });
    setOpen(false);
  }

  async function checkout() {
    setBusy('checkout');
    setError('');
    const data = await apiFetch('/billing/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ interval, return_path: router.asPath.split('?')[0] }),
    });
    if (data?.url) {
      if (mode === 'trial_ended') apiFetch('/billing/trial-prompt-seen', { method: 'POST' });
      window.location.href = data.url;
      return;
    }
    setError(apiErrorMessage(data?.detail, 'Checkout could not open. Please try again.'));
    setBusy('');
  }

  async function startTrial() {
    setBusy('trial');
    setError('');
    const data = await apiFetch('/billing/start-trial', { method: 'POST' });
    if (data?.plan === 'classroom_plus') {
      setStatus(data);
      setOpen(false);
      setToast(`Your 7-day ${PRO_NAME} trial has started. No card needed. It ends on its own.`);
    } else {
      setError(apiErrorMessage(data?.detail, 'The trial could not start. Please try again.'));
    }
    setBusy('');
  }

  const copy = limit?.feature ? FEATURE_COPY[limit.feature] : null;
  const isPro = status?.plan === 'classroom_plus';
  const onTrial = Boolean(status?.on_trial);
  const canTrial = Boolean(status?.trial_available) && mode !== 'trial_ended';
  const price = PRICES[interval];

  let title = `Upgrade to ${PRO_NAME}`;
  let body = 'Get more out of every class.';
  if (mode === 'trial_ended') {
    title = 'Your Pro trial has ended';
    body = 'You are back on the free plan. Nothing was charged. Want to keep Pro?';
  } else if (mode === 'limit') {
    title = copy?.title || "You've reached a free limit";
    const resets = resetLabel(limit?.resets_at);
    body = isPro && !onTrial
      ? `You've reached this month's fair-use limit for ${copy?.label || 'this feature'}. It resets ${resets}.`
      : `${limit?.message || ''}${resets ? ` Your free plan resets ${resets}.` : ''}`.trim();
  }

  return (
    <>
      {toast && (
        <div className="upgrade-toast" role="status" onClick={() => setToast('')}>{toast}</div>
      )}
      {open && (
        <div className="upgrade-overlay" onClick={close}>
          <div className="upgrade-dialog" role="dialog" aria-modal="true" aria-labelledby="upgrade-title" onClick={e => e.stopPropagation()}>
            <button className="upgrade-close" aria-label="Close" onClick={close}>×</button>
            <h3 id="upgrade-title">{title}</h3>
            <p className="upgrade-body">{body}</p>
            {copy?.pro && !(isPro && !onTrial) && <p className="upgrade-highlight">With Pro: {copy.pro}.</p>}

            {!(isPro && !onTrial) && (
              <>
                <ul className="upgrade-benefits">
                  {PRO_BENEFITS.map(item => <li key={item}>{item}</li>)}
                </ul>
                <div className="upgrade-intervals" role="radiogroup" aria-label="Billing">
                  {Object.entries(PRICES).map(([key, option]) => (
                    <button
                      key={key}
                      role="radio"
                      aria-checked={interval === key}
                      className={interval === key ? 'active' : ''}
                      onClick={() => setPlanInterval(key)}
                    >
                      <strong>{option.price}</strong> / {option.per}
                      {option.note && <span>{option.note}</span>}
                    </button>
                  ))}
                </div>
                {error && <div className="upgrade-error">{error}</div>}
                <div className="upgrade-actions">
                  <button className="btn-upgrade" onClick={checkout} disabled={Boolean(busy)}>
                    {busy === 'checkout' ? 'Opening secure checkout...' : `Get Pro · ${price.price}/${price.per}`}
                  </button>
                  {canTrial && (
                    <button className="btn-outline" onClick={startTrial} disabled={Boolean(busy)}>
                      {busy === 'trial' ? 'Starting...' : 'Try Pro free for 7 days · no card'}
                    </button>
                  )}
                  <button className="upgrade-later" onClick={close}>Not now</button>
                </div>
                <p className="upgrade-fineprint">Have a promo code? Add it at checkout. Cancel anytime.</p>
              </>
            )}

            {mode === 'upgrade' && !isPro && (
              <details className="upgrade-free">
                <summary>What's in Free</summary>
                <ul>{FREE_SUMMARY.map(item => <li key={item}>{item}</li>)}</ul>
              </details>
            )}
          </div>
        </div>
      )}
      <style jsx>{`
        .upgrade-overlay { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; z-index: 2000; padding: 16px; }
        .upgrade-dialog { position: relative; width: 100%; max-width: 440px; max-height: 92vh; overflow-y: auto; background: var(--bg-card, #fff); color: var(--text-primary); border-radius: 16px; padding: 28px 24px 20px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25); }
        .upgrade-close { position: absolute; top: 10px; right: 14px; border: none; background: none; font-size: 1.6rem; line-height: 1; cursor: pointer; color: var(--text-muted); }
        h3 { margin: 0 0 8px; font-size: 1.3rem; }
        .upgrade-body { margin: 0 0 10px; color: var(--text-secondary, var(--text-muted)); }
        .upgrade-highlight { margin: 0 0 12px; font-weight: 600; }
        .upgrade-benefits { margin: 0 0 16px; padding-left: 18px; }
        .upgrade-benefits li { margin: 4px 0; }
        .upgrade-intervals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
        .upgrade-intervals button { border: 1.5px solid var(--border, #d0d5dd); background: transparent; border-radius: 10px; padding: 10px; cursor: pointer; color: inherit; text-align: left; }
        .upgrade-intervals button.active { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent); }
        .upgrade-intervals span { display: block; font-size: 0.8rem; color: var(--accent); margin-top: 2px; }
        .upgrade-actions { display: flex; flex-direction: column; gap: 8px; }
        .upgrade-actions .btn-upgrade { width: 100%; padding: 12px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-weight: 700; cursor: pointer; }
        .upgrade-actions .btn-outline { width: 100%; padding: 11px; }
        .upgrade-later { border: none; background: none; color: var(--text-muted); cursor: pointer; padding: 6px; }
        .upgrade-error { color: var(--error); margin-bottom: 10px; }
        .upgrade-fineprint { margin: 10px 0 0; font-size: 0.8rem; color: var(--text-muted); text-align: center; }
        .upgrade-free { margin-top: 12px; font-size: 0.9rem; }
        .upgrade-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 2100; background: var(--text-primary, #111); color: var(--bg-card, #fff); padding: 12px 18px; border-radius: 10px; max-width: 90vw; cursor: pointer; }
      `}</style>
    </>
  );
}
