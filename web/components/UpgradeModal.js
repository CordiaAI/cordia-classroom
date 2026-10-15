import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Check, X } from 'lucide-react';
import { Sheet } from './Overlay';
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
  const trialEnds = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  let title = `Upgrade to ${PRO_NAME}`;
  let body = '';
  if (mode === 'trial_ended') {
    title = 'Your Pro trial has ended';
    body = 'You are back on the free plan. Nothing was charged. Want to keep Pro?';
  } else if (mode === 'limit' && isPro && limit?.plan === 'free') {
    // The limit was hit under the free plan, but the status check just found (or
    // reconnected) the student's Pro subscription.
    title = `Your ${PRO_NAME} plan is active`;
    body = 'We found your subscription and connected it to this account. Close this and try that again.';
  } else if (mode === 'limit') {
    title = copy?.title || "You've reached a free limit";
    const resets = resetLabel(limit?.resets_at);
    body = isPro && !onTrial
      ? `You've reached this month's fair-use limit for ${copy?.label || 'this feature'}. It resets ${resets}.`
      : resets ? `Resets ${resets}.` : '';
  }

  return (
    <>
      {toast && (
        <div className="c-toast" role="status">
          <span>{toast}</span>
          <button type="button" className="c-btn c-btn--quiet" onClick={() => setToast('')}>Close</button>
        </div>
      )}
      <Sheet open={open} onClose={close} labelledBy="upgrade-title" className="upgrade-sheet">
        <header className="c-sheet-head">
          <h2 id="upgrade-title" className="upgrade-title">{title}</h2>
          <button type="button" className="c-icon-btn" aria-label="Close" title="Close" onClick={close}><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        {body && <p className="upgrade-body">{body}</p>}

        {!(isPro && !onTrial) && (
          <>
            <ul className="upgrade-benefits">
              {(copy?.pro ? [copy.pro, ...PRO_BENEFITS.filter(item => item !== copy.pro)] : PRO_BENEFITS).map(item => (
                <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>
              ))}
            </ul>
            <div className="upgrade-intervals" role="radiogroup" aria-label="Billing">
              {Object.entries(PRICES).map(([key, option]) => (
                <button key={key} type="button" role="radio" aria-checked={interval === key} className={interval === key ? 'is-active' : ''} onClick={() => setPlanInterval(key)}>
                  <span className="upgrade-price"><strong>{option.price}</strong> / {option.per}</span>
                  {option.note && <span className="upgrade-save">{option.note}</span>}
                </button>
              ))}
            </div>
            {error && <p className="upgrade-error" role="alert">{error}</p>}
            {canTrial && <p className="upgrade-terms">Trial ends {trialEnds}. No card. It never turns into a charge.</p>}
            <div className="upgrade-actions">
              {canTrial && (
                <button type="button" className="c-btn c-btn--block upgrade-trial" onClick={startTrial} disabled={Boolean(busy)}>
                  {busy === 'trial' ? 'Starting…' : 'Start my free 7-day trial'}
                </button>
              )}
              <button type="button" className={'c-btn c-btn--block ' + (canTrial ? 'c-btn--secondary' : 'upgrade-trial')} onClick={checkout} disabled={Boolean(busy)}>
                {busy === 'checkout' ? 'Opening checkout…' : `${canTrial ? 'Subscribe' : 'Get Pro'} · ${price.price}/${price.per}`}
              </button>
              <button type="button" className="c-btn c-btn--secondary c-btn--block" onClick={close}>Not now</button>
            </div>
          </>
        )}

        {mode === 'upgrade' && !isPro && (
          <details className="upgrade-free">
            <summary>What's in Free</summary>
            <ul>{FREE_SUMMARY.map(item => <li key={item}>{item}</li>)}</ul>
          </details>
        )}
      </Sheet>
      <style jsx global>{`
        .upgrade-sheet { width: min(460px, 100%); display: grid; gap: 16px; color: var(--ink); }
        .upgrade-sheet .c-sheet-head { margin-bottom: 0; align-items: flex-start; }
        .upgrade-title { margin: 0; font: 500 28px/1.15 var(--font-display); color: var(--ink); }
        .upgrade-body { margin: 0; font: 500 15px/1.5 var(--font-sans); color: var(--ink); }
        .upgrade-benefits { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .upgrade-benefits li { display: flex; gap: 10px; align-items: flex-start; font: 500 15px/1.4 var(--font-sans); color: var(--ink); }
        .upgrade-benefits .lucide { color: var(--olive-ink); margin-top: 1px; }
        .upgrade-intervals { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .upgrade-intervals button { display: grid; gap: 4px; min-height: 64px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--ink); text-align: left; cursor: pointer; font: 500 15px/1.2 var(--font-sans); }
        .upgrade-intervals button.is-active { border: 2px solid var(--olive-ink); }
        .upgrade-price strong { font-weight: 700; font-variant-numeric: tabular-nums; }
        .upgrade-save { font: 700 13px/1 var(--font-sans); color: var(--olive-ink); }
        .upgrade-terms { margin: 0; font: 500 13px/1.45 var(--font-sans); color: var(--ink); }
        .upgrade-actions { display: grid; gap: 8px; }
        .upgrade-trial { background: var(--olive); border-color: var(--olive); color: var(--on-olive); }
        .upgrade-trial:hover:not(:disabled) { background: var(--olive-press); border-color: var(--olive-press); }
        .upgrade-error { margin: 0; color: var(--error); font: 600 15px/1.4 var(--font-sans); }
        .upgrade-free { font: 500 15px/1.4 var(--font-sans); color: var(--ink); }
        .upgrade-free summary { cursor: pointer; font-weight: 600; min-height: 40px; display: flex; align-items: center; }
      `}</style>
    </>
  );
}
