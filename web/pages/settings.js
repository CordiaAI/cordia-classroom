import { useState, useEffect } from 'react';
import { SectionLoader } from '../components/CordiaLoader';
import { setThemePreference } from '../lib/theme';
import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import Link from 'next/link';
import { apiErrorMessage, apiFetch, cacheUserIdentity, clearAuth, getUserEmail, getUserName, openUpgrade } from '../lib/api';
import { EXTENSION_STORE_URL } from '../lib/extension';
import { FEATURE_COPY, FREE_SUMMARY, METERED, PRICES, PRO_BENEFITS, PRO_LIMITS, resetLabel } from '../lib/plans';
import LearningStylePicker from '../components/LearningStylePicker';
import { useLearningStyle } from '../lib/learningStyle';
import ExplanationPreference from '../components/ExplanationPreference';
import { CalendarDays, Check, CreditCard, LogOut, Moon, Puzzle, Sun, Trash2 } from 'lucide-react';
import BodyPortal from '../components/BodyPortal';
import CanvasSettings from '../components/CanvasSettings';
import SharingSettings from '../components/SharingSettings';
import PhoneSettings from '../components/PhoneSettings';
import LearnCordia from '../components/LearnCordia';
import ConnectorsSettings from '../components/ConnectorsSettings';
import useScrollerTabs from '../lib/useScrollerTabs';
import { canvasStatus } from '../lib/canvas';

export default function SettingsPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState('account');
  const tabsRef = useScrollerTabs(activeSection);
  const [profileName, setProfileName] = useState('');

  // /settings?section=study opens a tab directly. Old links land on the tab that now
  // holds them; the grove moved to Progress.
  const SECTION_ALIASES = { subscription: 'plan', profile: 'account', learning: 'study', canvas: 'connectors', connections: 'connectors' };
  useEffect(() => {
    if (!router.isReady || !router.query.section) return;
    const section = String(router.query.section);
    if (section === 'grove') { router.replace('/progress'); return; }
    const key = SECTION_ALIASES[section] || section;
    setActiveSection(['account', 'study', 'appearance', 'plan', 'connectors', 'learn'].includes(key) ? key : 'account');
  }, [router.isReady, router.query.section]);

  // Picking a tab updates the address, so Back and shared links land on it.
  function pickSection(key) {
    setActiveSection(key);
    router.replace({ pathname: '/settings', query: key === 'account' ? {} : { section: key } }, undefined, { shallow: true });
  }
  const [canvasReady, setCanvasReady] = useState(false);
  const [extensionInstalled, setExtensionInstalled] = useState(false);
  const [deleting, setDeleting] = useState(null); // null | { text, busy, error }
  useEffect(() => {
    if (!ready) return;
    canvasStatus().then(data => setCanvasReady(Boolean(data)));
    setExtensionInstalled(document.documentElement.getAttribute('data-asai-extension') === 'ready');
  }, [ready]);
  const [email, setEmail] = useState('');

  // Billing state
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [managing, setManaging] = useState(false);
  const [billingInterval, setBillingInterval] = useState('monthly');
  const [message, setMessage] = useState('');

  // Theme state
  const [theme, setTheme] = useState('light');

  // Study style
  const { learningStyle, saveStyle } = useLearningStyle();
  const [savingStyle, setSavingStyle] = useState(false);

  async function chooseStyle(style) {
    setSavingStyle(true);
    const data = await saveStyle(style);
    setSavingStyle(false);
    setMessage(data?.enabled ? 'Saved.' : apiErrorMessage(data?.detail, 'Could not save that.'));
  }

  useEffect(() => {
    if (!ready) return;
    setEmail(getUserEmail() || '');
    setProfileName(getUserName() || '');
    apiFetch('/auth/me').then(identity => {
      if (!identity?.user_id) return;
      cacheUserIdentity(identity);
      setEmail(identity.email || getUserEmail() || '');
      setProfileName(identity.name || '');
    });
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);

    if (router.query.billing === 'success') {
      setActiveSection('plan');
      const sessionId = typeof router.query.session_id === 'string' ? router.query.session_id : '';
      if (sessionId) {
        setMessage('Confirming your CordiaClassroom Pro subscription...');
        confirmCheckout(sessionId);
      } else {
        setMessage('Checkout returned without a confirmation reference. Checking your plan...');
        loadStatus();
      }
    } else {
      if (router.query.billing === 'cancelled') setMessage('Checkout cancelled. Your plan did not change.');
      loadStatus();
    }
  }, [ready, router.query]);

  async function confirmCheckout(sessionId) {
    setLoading(true);
    const data = await apiFetch('/billing/confirm-checkout', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (data?.plan === 'classroom_plus') {
      setStatus(data);
      if (PRICES[data.billing_interval]) setBillingInterval(data.billing_interval);
      setMessage('CordiaClassroom Pro is active.');
      router.replace('/settings?section=subscription', undefined, { shallow: true });
    } else {
      setMessage(apiErrorMessage(data?.detail, 'We could not confirm this Checkout session. Please contact support.'));
      await loadStatus();
    }
    setLoading(false);
  }

  async function loadStatus() {
    setLoading(true);
    const data = await apiFetch('/billing/status');
    if (data) {
      setStatus(data);
      if (PRICES[data.billing_interval]) setBillingInterval(data.billing_interval);
    }
    setLoading(false);
  }

  async function handleUpgrade() {
    setUpgrading(true);
    const data = await apiFetch('/billing/create-checkout-session', {
      method: 'POST',
      body: JSON.stringify({ interval: billingInterval }),
    });
    if (data?.url) {
      window.location.href = data.url;
    } else {
      setMessage(apiErrorMessage(data?.detail, 'Failed to start checkout. Please try again.'));
      setUpgrading(false);
    }
  }

  async function handleManageBilling() {
    setManaging(true);
    const data = await apiFetch('/billing/create-portal-session', { method: 'POST' });
    if (data?.url) {
      window.location.href = data.url;
    } else {
      setMessage(apiErrorMessage(data?.detail, 'Could not open billing management. Please try again.'));
      setManaging(false);
    }
  }

  function setAppearance(next) {
    setTheme(next);
    setThemePreference(next);
  }

  async function deleteAccount(event) {
    event.preventDefault();
    if (deleting.text !== 'DELETE' || deleting.busy) return;
    setDeleting(current => ({ ...current, busy: true, error: '' }));
    const data = await apiFetch('/auth/account', { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE' }) });
    if (data?.deleted) {
      clearAuth();
      router.replace('/?deleted=1');
    } else {
      setDeleting(current => ({ ...current, busy: false, error: apiErrorMessage(data?.detail, 'Your account could not be deleted. Try again or email support@cordiaai.io.') }));
    }
  }

  if (!ready) return null;

  const isPlus = status?.plan === 'classroom_plus';
  const onTrial = Boolean(status?.on_trial);
  const selected = PRICES[billingInterval] || PRICES.monthly;

  async function handleStartTrial() {
    setUpgrading(true);
    const data = await apiFetch('/billing/start-trial', { method: 'POST' });
    if (data?.plan === 'classroom_plus') {
      setStatus(data);
      setMessage('Your 7-day Pro trial has started. No card needed, and it ends on its own.');
    } else {
      setMessage(apiErrorMessage(data?.detail, 'The trial could not start. Please try again.'));
    }
    setUpgrading(false);
  }

  const sections = [
    { key: 'account', label: 'Account' },
    { key: 'study', label: 'Study' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'plan', label: 'Plan & billing' },
    { key: 'connectors', label: 'Connectors' },
    { key: 'learn', label: 'Learn Cordia' },
  ];
  const initials = (profileName || email.split('@')[0] || '').split(/[\s._-]+/).filter(part => /^[a-z]/i.test(part)).slice(0, 2).map(part => part[0]).join('').toUpperCase();

  function onTabKey(event) {
    const index = sections.findIndex(section => section.key === activeSection);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = sections[(next + sections.length) % sections.length];
    pickSection(target.key);
    document.getElementById(`tab-${target.key}`)?.focus();
  }

  return (
    <>
      <div className="c-page profile-page">
        <header className="c-page-head"><h1 className="c-title">Settings</h1></header>

        <div ref={tabsRef} className="c-seg is-scroller profile-tabs" role="tablist" aria-label="Settings" onKeyDown={onTabKey}>
          {sections.map(section => (
            <button
              key={section.key}
              id={`tab-${section.key}`}
              type="button"
              role="tab"
              aria-selected={activeSection === section.key}
              aria-controls={`panel-${section.key}`}
              tabIndex={activeSection === section.key ? 0 : -1}
              onClick={() => pickSection(section.key)}
            >
              {section.label}
            </button>
          ))}
        </div>

        {message && <div className="profile-message" role="status">{message}</div>}

        {activeSection === 'plan' && (
          <div className="profile-section" role="tabpanel" id="panel-plan" aria-labelledby="tab-plan">
            {loading ? (
              <SectionLoader height={160} label="Loading your plan" />
            ) : (
              <>
                <div className="c-card billing-current-plan">
                  <div className="plan-badge" data-plan={isPlus ? 'plus' : 'free'}>
                    {onTrial ? 'Pro trial' : isPlus ? 'Pro' : 'Free'}
                  </div>
                  <div className="plan-usage">
                    {METERED.map(feature => {
                      const item = status?.features?.[feature];
                      if (!item) return null;
                      const pct = item.limit ? Math.min(100, (item.used / item.limit) * 100) : 0;
                      return (
                        <div key={feature} className="plan-usage-row">
                          <span className="plan-usage-label">{FEATURE_COPY[feature].label}</span>
                          <span className="c-meta">{item.used} / {item.limit}{!isPlus && PRO_LIMITS[feature] ? ` · Pro ${PRO_LIMITS[feature].toLocaleString()} a month` : ''}</span>
                          <div className="c-bar"><span style={{ width: pct + '%', background: pct >= 100 ? 'var(--error)' : undefined }} /></div>
                        </div>
                      );
                    })}
                    {status?.resets_at && <span className="c-meta">Resets {resetLabel(status.resets_at)}</span>}
                  </div>
                  {onTrial && status?.trial_ends_at && <span className="c-meta">Trial ends {new Date(status.trial_ends_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>}
                  {isPlus && !onTrial && status?.period_end && (
                    <span className="c-meta">{status.cancel_at_period_end ? 'Ends' : 'Renews'} {new Date(status.period_end).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                  )}
                  {status?.past_due && <div className="plan-warning" role="alert">Payment failed. Update your card.</div>}
                </div>

                <div className="billing-plans">
                  <div className={'c-card plan-card' + (!isPlus ? ' plan-card-current' : '')}>
                    <h2 className="c-section-title">Free</h2>
                    <div className="plan-price">$0 <span>/month</span></div>
                    <ul className="plan-features">
                      {FREE_SUMMARY.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}
                    </ul>
                    {!isPlus && <span className="plan-current-label">Current</span>}
                  </div>

                  <div className={'c-card plan-card plan-card-pro' + (isPlus ? ' plan-card-current' : '')}>
                    <h2 className="c-section-title">Pro</h2>
                    {(!isPlus || onTrial) && (
                      <div className="c-seg billing-toggle" role="group" aria-label="Billing interval">
                        {Object.entries(PRICES).map(([key, option]) => (
                          <button key={key} type="button" className={billingInterval === key ? 'is-active' : ''} aria-pressed={billingInterval === key} onClick={() => setBillingInterval(key)}>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="plan-price">
                      {selected.price}
                      <span>/{selected.per}</span>
                    </div>
                    {selected.note && <span className="c-meta">{selected.note}</span>}
                    <ul className="plan-features">
                      {PRO_BENEFITS.map(item => <li key={item}><Check size={18} strokeWidth={2} aria-hidden="true" />{item}</li>)}
                    </ul>
                    {isPlus && !onTrial ? (
                      <div className="plan-actions">
                        <span className="plan-current-label">Current</span>
                        <button type="button" className="c-btn c-btn--secondary" onClick={handleManageBilling} disabled={managing}>
                          <CreditCard size={20} strokeWidth={1.75} aria-hidden="true" />{managing ? 'Opening…' : 'Manage'}
                        </button>
                      </div>
                    ) : (
                      <div className="plan-actions">
                        {status?.trial_available ? (
                          <>
                            <button type="button" className="c-btn c-btn--primary" onClick={() => openUpgrade()} disabled={upgrading}>Start trial</button>
                            <button type="button" className="c-btn c-btn--secondary" onClick={handleUpgrade} disabled={upgrading}>
                              {upgrading ? 'Opening…' : 'Subscribe'}
                            </button>
                          </>
                        ) : (
                          <button type="button" className="c-btn c-btn--primary" onClick={handleUpgrade} disabled={upgrading}>
                            {upgrading ? 'Opening…' : onTrial ? 'Subscribe' : 'Choose Pro'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeSection === 'learn' && (
          <div className="profile-section" role="tabpanel" id="panel-learn" aria-labelledby="tab-learn">
            <LearnCordia />
          </div>
        )}

        {activeSection === 'connectors' && (
          <div className="profile-section c-stack" role="tabpanel" id="panel-connectors" aria-labelledby="tab-connectors">
            <ConnectorsSettings />
            {canvasReady && <CanvasSettings school={typeof window !== 'undefined' ? localStorage.getItem('cordiaSchool') || '' : ''} />}
            {/* Canvas settings already offer the calendar link; without them, link to it here. */}
            {!canvasReady && (
              <div className="c-card settings-row">
                <span className="settings-row-label"><CalendarDays size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">Calendar link</span></span>
                <Link href="/canvas?tab=calendar" className="c-btn c-btn--secondary">Open Calendar</Link>
              </div>
            )}
            <div className="c-card settings-row">
              <span className="settings-row-label"><Puzzle size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">Chrome extension</span></span>
              {extensionInstalled
                ? <span className="c-meta">Installed</span>
                : <a className="c-btn c-btn--secondary" href={EXTENSION_STORE_URL} target="_blank" rel="noopener noreferrer">Get extension</a>}
            </div>
            {canvasReady && <SharingSettings />}
          </div>
        )}

        {activeSection === 'appearance' && (
          <div className="profile-section" role="tabpanel" id="panel-appearance" aria-labelledby="tab-appearance">
            <div className="c-card settings-row">
              <span className="c-section-title">Theme</span>
              <div className="c-seg" role="group" aria-label="Theme">
                <button type="button" className={theme !== 'dark' ? 'is-active' : ''} aria-pressed={theme !== 'dark'} onClick={() => setAppearance('light')}><Sun size={18} strokeWidth={1.75} aria-hidden="true" /> Light</button>
                <button type="button" className={theme === 'dark' ? 'is-active' : ''} aria-pressed={theme === 'dark'} onClick={() => setAppearance('dark')}><Moon size={18} strokeWidth={1.75} aria-hidden="true" /> Dark</button>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'study' && (
          <div className="profile-section c-stack" role="tabpanel" id="panel-study" aria-labelledby="tab-study">
            <div className="c-card settings-card"><ExplanationPreference /></div>
            {learningStyle?.enabled && (
              <div className="c-card settings-card">
                <h2 className="c-section-title">Explain things to me with…</h2>
                <p className="c-meta settings-note">Sets which Explain view opens first. Every view is always one tap away.</p>
                <LearningStylePicker value={learningStyle.style} onSelect={chooseStyle} disabled={savingStyle} />
                {learningStyle.style && (
                  <button type="button" className="c-btn c-btn--quiet" onClick={() => chooseStyle(null)} disabled={savingStyle}>Use standard</button>
                )}
              </div>
            )}
          </div>
        )}

        {activeSection === 'account' && (
          <div className="profile-section c-stack" role="tabpanel" id="panel-account" aria-labelledby="tab-account">
            <div className="c-card me-card">
              <div className="me-avatar" aria-hidden="true">{initials}</div>
              <div className="me-names">
                <strong>{profileName || 'Your account'}</strong>
                <span className="c-meta">{email}</span>
              </div>
              <button type="button" className="c-btn c-btn--secondary" onClick={() => { clearAuth(); router.push('/'); }}><LogOut size={20} strokeWidth={1.75} aria-hidden="true" />Sign out</button>
            </div>
            <PhoneSettings />
            <div className="c-card settings-row">
              <span className="settings-row-label"><Trash2 size={20} strokeWidth={1.75} aria-hidden="true" /><span className="c-section-title">Delete account</span></span>
              <button type="button" className="c-btn c-btn--secondary settings-danger" onClick={() => setDeleting({ text: '', busy: false, error: '' })}>Delete account</button>
            </div>
            <nav className="settings-links" aria-label="Policies">
              <a href="/privacy">Privacy</a>
              <a href="/terms">Terms</a>
              <a href="/honor-code">Honor code</a>
            </nav>
          </div>
        )}
      </div>

      {deleting && (
        <BodyPortal>
          <div className="c-scrim" onClick={() => !deleting.busy && setDeleting(null)}>
            <form className="c-sheet delete-sheet" role="dialog" aria-modal="true" aria-labelledby="delete-title" onSubmit={deleteAccount} onClick={event => event.stopPropagation()}>
              <h2 id="delete-title" className="c-title">Delete your account?</h2>
              <p>This permanently deletes your study guides, notes, flashcards, lectures, classes, progress and Canvas connection, and cancels a paid plan. Sets you shared with a class are removed too. It can’t be undone.</p>
              <label className="c-field">
                <span>Type DELETE to confirm</span>
                <input className="c-input" value={deleting.text} onChange={event => setDeleting(current => ({ ...current, text: event.target.value }))} autoComplete="off" autoFocus />
              </label>
              {deleting.error && <p className="delete-error" role="alert">{deleting.error}</p>}
              <div className="delete-actions">
                <button type="button" className="c-btn c-btn--secondary" onClick={() => setDeleting(null)} disabled={deleting.busy}>Cancel</button>
                <button type="submit" className="c-btn c-btn--primary delete-confirm" disabled={deleting.text !== 'DELETE' || deleting.busy}>{deleting.busy ? 'Deleting…' : 'Delete account'}</button>
              </div>
            </form>
          </div>
        </BodyPortal>
      )}

      <style jsx>{`
        .delete-sheet { display: grid; gap: 16px; width: min(480px, 100%); }
        .delete-sheet p { margin: 0; }
        .delete-error { color: var(--error); font-weight: 600; }
        .delete-actions { display: flex; justify-content: flex-end; gap: 8px; }
        :global(.delete-confirm:not(:disabled)) { background: var(--error) !important; border-color: var(--error) !important; color: var(--on-olive) !important; }
        :global(.settings-danger) { color: var(--error) !important; }
        .profile-page { width: min(var(--page-max), 100%); margin: 0 auto; }
        .profile-tabs { justify-self: start; max-width: 100%; overflow-x: auto; }
        .profile-message { padding: 14px 18px; border-radius:var(--r-card); background: var(--olive-tint); font-weight:600; }
        .profile-section { animation: fadeIn 0.2s ease; }
        .settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; flex-wrap: wrap; }
        .settings-row .c-seg button { display: inline-flex; align-items: center; gap: 6px; }
        .settings-row-label { display: inline-flex; align-items: center; gap: 10px; }
        .settings-row-label :global(.lucide) { color: var(--olive-ink); }
        .settings-note { margin: -4px 0 0; }
        .settings-card { display: grid; gap: 12px; padding: 20px; }
        .settings-links { display: flex; gap: 20px; font:600 13px/1 var(--font-sans); }
        .me-card { display: flex; align-items: center; gap: 16px; padding: 20px; }
        .me-avatar { display: grid; place-items: center; width: 56px; height: 56px; flex: 0 0 auto; border-radius:50%; background: var(--olive); color: var(--on-olive); font:600 20px/1 var(--font-sans); }
        .me-names { display: grid; gap: 2px; flex: 1; min-width: 0; }
        .me-names > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .me-names strong { font:600 20px/1.15 var(--font-sans); }
        .billing-current-plan { display: grid; gap: 12px; padding: 20px; margin-bottom: 16px; }
        .plan-badge { justify-self: start; padding: 6px 14px; border-radius:var(--r-pill); background: var(--card-sunk); font-weight:600; }
        .plan-badge[data-plan="plus"] { background: var(--olive); color: var(--on-olive); }
        .plan-usage { display: grid; gap: 10px; }
        .plan-usage-row { display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; }
        .plan-usage-row .c-bar { grid-column: 1 / -1; }
        .plan-usage-label { text-transform: capitalize; font-weight:600; }
        .plan-warning { color: var(--error); font-weight:600; }
        .billing-plans { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .plan-card { display: grid; gap: 12px; align-content: start; min-width: 0; padding: 24px; }
        .plan-card-current { box-shadow: 0 0 0 2px var(--olive); }
        .plan-price { font:600 28px/1 var(--font-sans); }
        .plan-price span { font-size: 15px; font-weight:500; }
        .billing-toggle { justify-self: start; }
        .plan-features { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .plan-features li { display: flex; gap: 8px; align-items: flex-start; }
        .plan-features :global(.lucide) { color: var(--olive-ink); margin-top: 2px; }
        .plan-current-label { color: var(--olive-ink); font-weight:600; }
        .plan-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        @media (max-width: 767px) { .billing-plans { grid-template-columns: 1fr; } .me-card { flex-wrap: wrap; } .me-names { flex: 1 1 0; min-width: 0; } .me-card > :global(.c-btn) { width: 100%; } .settings-row > :global(.c-btn) { width: 100%; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}
