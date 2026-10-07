import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useRequireAuth } from '../lib/auth';
import { apiErrorMessage, apiFetch, cacheUserIdentity, getUserEmail, getUserName } from '../lib/api';
import { FEATURE_COPY, FREE_SUMMARY, METERED, PRICES, PRO_BENEFITS, PRO_NAME, resetLabel } from '../lib/plans';
import FeedbackModal from '../components/FeedbackModal';
import LearningStylePicker from '../components/LearningStylePicker';
import { useLearningStyle } from '../lib/learningStyle';
import ExplanationPreference from '../components/ExplanationPreference';
import StudyInsights from '../components/StudyInsights';

export default function SettingsPage() {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState('account');
  const [profileName, setProfileName] = useState('');

  // /settings?section=learning opens a section directly (e.g. from the dashboard insights card).
  useEffect(() => {
    if (router.isReady && router.query.section) setActiveSection(String(router.query.section));
  }, [router.isReady, router.query.section]);
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

  // Feedback modal
  const [showFeedback, setShowFeedback] = useState(false);

  // Study style
  const { learningStyle, saveStyle } = useLearningStyle();
  const [savingStyle, setSavingStyle] = useState(false);

  async function chooseStyle(style) {
    setSavingStyle(true);
    const data = await saveStyle(style);
    setSavingStyle(false);
    setMessage(data?.enabled ? 'Study style saved.' : apiErrorMessage(data?.detail, 'Could not save your study style.'));
  }

  useEffect(() => {
    if (!ready) return;
    setEmail(getUserEmail() || '');
    setProfileName(getUserName() || '');
    apiFetch('/auth/me').then(identity => {
      if (!identity?.user_id) return;
      cacheUserIdentity(identity);
      setEmail(identity.email || '');
      setProfileName(identity.name || '');
    });
    const saved = localStorage.getItem('theme') || 'light';
    setTheme(saved);

    if (router.query.billing === 'success') {
      setActiveSection('subscription');
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
      setMessage('Could not open billing management. Please try again.');
      setManaging(false);
    }
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('theme', next);
    document.documentElement.setAttribute('data-theme', next);
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
    { key: 'account', label: 'Profile' },
    { key: 'learning', label: 'Learning' },
    { key: 'appearance', label: 'Appearance' },
    { key: 'subscription', label: 'Subscription' },
  ];

  return (
    <>
      <div className="settings-page">
        <header className="profile-window-heading"><h2>My profile</h2><p>Make this space your own.</p></header>

        <div className="settings-tabs">
          {sections.map(s => (
            <button
              key={s.key}
              className={'settings-tab' + (activeSection === s.key ? ' active' : '')}
              onClick={() => setActiveSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>

        {message && <div className="settings-message">{message}</div>}

        {/* Subscription Section */}
        {activeSection === 'subscription' && (
          <div className="settings-section">
            {loading ? (
              <div className="settings-loading">Loading...</div>
            ) : (
              <>
                <div className="billing-current-plan">
                  <div className="plan-badge" data-plan={isPlus ? 'plus' : 'free'}>
                    {onTrial ? `${PRO_NAME} · trial` : isPlus ? PRO_NAME : 'Free'}
                  </div>
                  <div className="plan-usage">
                    {METERED.map(feature => {
                      const item = status?.features?.[feature];
                      if (!item) return null;
                      const pct = item.limit ? Math.min(100, (item.used / item.limit) * 100) : 0;
                      return (
                        <div key={feature}>
                          <span>{item.used} of {item.limit} {FEATURE_COPY[feature].label} used this month</span>
                          <div className="usage-bar">
                            <div className="usage-bar-fill" style={{ width: pct + '%', background: pct >= 100 ? 'var(--error)' : 'var(--accent)' }} />
                          </div>
                        </div>
                      );
                    })}
                    {status?.resets_at && <span className="plan-resets">Resets {resetLabel(status.resets_at)}</span>}
                  </div>
                  {onTrial && status?.trial_ends_at && (
                    <div className="plan-renews">Trial ends {new Date(status.trial_ends_at).toLocaleDateString()}. You will not be charged unless you subscribe.</div>
                  )}
                  {isPlus && !onTrial && status?.period_end && (
                    <div className="plan-renews">
                      {status.cancel_at_period_end ? 'Access ends' : 'Renews'} {new Date(status.period_end).toLocaleDateString()}
                    </div>
                  )}
                  {status?.past_due && (
                    <div className="plan-renews plan-warning">Your last payment failed. Update your card to keep Pro.</div>
                  )}
                </div>

                <div className="billing-plans">
                  <div className={'plan-card' + (!isPlus ? ' plan-card-current' : '')}>
                    <div className="plan-name">Free</div>
                    <div className="plan-price">$0 <span>/month</span></div>
                    <ul className="plan-features">
                      {FREE_SUMMARY.map(item => <li key={item}>{item}</li>)}
                    </ul>
                    {!isPlus && <div className="plan-current-label">Current plan</div>}
                  </div>

                  <div className={'plan-card plan-card-pro' + (isPlus ? ' plan-card-current' : '')}>
                    <div className="plan-name">{PRO_NAME}</div>
                    {(!isPlus || onTrial) && (
                      <div className="billing-toggle" aria-label="Billing interval">
                        {Object.entries(PRICES).map(([key, option]) => (
                          <button key={key} className={billingInterval === key ? 'active' : ''} onClick={() => setBillingInterval(key)}>
                            {option.label}{option.note ? ` · ${option.note.toLowerCase()}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="plan-price">
                      {selected.price}
                      <span>/{selected.per}</span>
                    </div>
                    <ul className="plan-features">
                      {PRO_BENEFITS.map(item => <li key={item}>{item}</li>)}
                      <li>Cancel anytime · secure billing through Stripe</li>
                    </ul>
                    {isPlus && !onTrial ? (
                      <div className="plan-actions">
                        <div className="plan-current-label">Current plan</div>
                        <button className="btn-manage" onClick={handleManageBilling} disabled={managing}>
                          {managing ? 'Opening...' : 'Manage billing'}
                        </button>
                      </div>
                    ) : (
                      <div className="plan-actions">
                        <button className="btn-upgrade" onClick={handleUpgrade} disabled={upgrading}>
                          {upgrading ? 'Opening secure checkout...' : `${onTrial ? 'Subscribe' : 'Choose Pro'} · ${selected.price}/${selected.per}`}
                        </button>
                        {status?.trial_available && (
                          <button className="btn-manage" onClick={handleStartTrial} disabled={upgrading}>
                            Try Pro free for 7 days · no card
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

        {/* Appearance Section */}
        {activeSection === 'appearance' && (
          <div className="settings-section">
            <div className="settings-row">
              <div>
                <div className="settings-label">Theme</div>
                <div className="settings-desc">Switch between dark and light mode</div>
              </div>
              <button className="theme-toggle" onClick={toggleTheme}>
                {theme === 'dark' ? 'Dark' : 'Light'}
              </button>
            </div>
          </div>
        )}

        {activeSection === 'learning' && (
          <div className="settings-section">
            <ExplanationPreference />
          </div>
        )}

        {activeSection === 'learning' && (
          <div className="settings-section">
            <StudyInsights />
          </div>
        )}

        {activeSection === 'learning' && learningStyle?.enabled && (
          <div className="settings-section">
            <div className="settings-label">How do you like to study?</div>
            <div className="settings-desc">
              Guides and Tutor start with this. Every study tool stays available whatever you pick.
            </div>
            <LearningStylePicker value={learningStyle.style} onSelect={chooseStyle} disabled={savingStyle} />
            {learningStyle.style && (
              <button type="button" className="btn-outline" onClick={() => chooseStyle(null)} disabled={savingStyle}>
                Use Classroom's standard view
              </button>
            )}
          </div>
        )}

        {/* Account Section */}
        {activeSection === 'account' && (
          <div className="settings-section">
            <div className="profile-identity">
              <div className="profile-portrait" aria-hidden="true">{profileName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase()}</div>
              <div><span>Name</span><strong>{profileName || 'Your account'}</strong><span>Email</span><strong>{email || 'Not available'}</strong></div>
              <button type="button" className="btn-outline" onClick={() => setActiveSection('subscription')}>Manage plan</button>
            </div>
            <div className="profile-preferences"><h3>Learning preferences</h3><ExplanationPreference /></div>
            <div className="settings-row">
              <div>
                <div className="settings-label">Send Feedback</div>
                <div className="settings-desc">Report a bug or suggest a feature</div>
              </div>
              <button className="btn-feedback" onClick={() => setShowFeedback(true)}>
                Send Feedback
              </button>
            </div>
            <div className="settings-links">
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
              <a href="/honor-code">Honor Code</a>
            </div>
          </div>
        )}
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}

      <style jsx>{`
        .settings-page { width: min(920px, 100%); margin: 0 auto; }
        h2 { margin-bottom: 24px; font-size: clamp(2.4rem, 4vw, 3.5rem); font-weight: 700; letter-spacing: -0.055em; }
        .settings-tabs { display: inline-flex; gap: 4px; margin-bottom: 22px; padding: 4px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); box-shadow: var(--shadow-sm); }
        .settings-tab { background: none; border: none; color: var(--text-muted); font-size: 0.86rem; padding: 9px 15px; cursor: pointer; border-radius: 10px; font-weight: 600; }
        .settings-tab:hover { color: var(--text-primary); background: var(--bg-hover); }
        .settings-tab.active { color: var(--olive-hover); background: var(--accent-glow); }
        .settings-message { background: var(--accent-glow); border: 1px solid var(--line); border-radius: 14px; padding: 13px 16px; margin-bottom: 22px; color: var(--text-primary); }
        .settings-loading { color: var(--text-muted); }
        .settings-section { padding: 28px; animation: fadeIn 0.2s ease; }
        .settings-row { display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 18px 0; border-bottom: 1px solid var(--border-subtle); }
        .settings-label { font-weight: 600; font-size: 0.95rem; color: var(--text-primary); }
        .settings-desc { font-size: 0.85rem; color: var(--text-muted); margin-top: 2px; }
        .theme-toggle { padding: 9px 18px; border-radius: 999px; border: 1px solid var(--border-default); background: var(--surface); color: var(--text-primary); box-shadow: var(--shadow-sm); cursor: pointer; font-size: 0.86rem; font-weight: 600; }
        .theme-toggle:hover { border-color: var(--accent); transform: translateY(-1px); }
        .btn-feedback { padding: 9px 18px; border-radius: 999px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; font-size: 0.86rem; font-weight: 600; }
        .btn-feedback:hover { background: var(--accent-glow); }
        .settings-links { display: flex; gap: 16px; padding-top: 24px; margin-top: 8px; }
        .settings-links a { font-size: 0.85rem; color: var(--text-muted); }
        .settings-links a:hover { color: var(--accent); }

        /* Billing styles (from billing page) */
        .billing-current-plan { background: var(--bg-tertiary); border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px; margin-bottom: 24px; }
        .plan-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-weight: 700; font-size: 0.9rem; background: var(--bg-tertiary); color: var(--text-muted); margin-bottom: 12px; }
        .plan-badge[data-plan="plus"] { background: var(--accent); color: #fff; }
        .plan-usage { font-size: 0.95rem; color: var(--text-secondary); }
        .plan-usage span { display: block; margin-top: 8px; }
        .usage-bar { height: 8px; background: var(--bg-tertiary); border-radius: 4px; margin-top: 8px; overflow: hidden; }
        .usage-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
        .plan-renews { font-size: 0.85rem; color: var(--text-muted); margin-top: 8px; }
        .billing-plans { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .plan-card { min-width: 0; border: 1px solid var(--border-default); border-radius: 18px; padding: 24px; background: var(--surface); box-shadow: var(--shadow-sm); }
        .plan-card-pro { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
        .plan-card-current { box-shadow: 0 0 0 3px var(--accent-glow); }
        .plan-name { font-size: 1.1rem; font-weight: 700; margin-bottom: 4px; color: var(--text-primary); }
        .plan-price { font-size: 2rem; font-weight: 800; margin-bottom: 16px; color: var(--text-primary); }
        .plan-price span { font-size: 1rem; font-weight: 400; color: var(--text-muted); }
        .billing-toggle { display: flex; gap: 6px; padding: 4px; margin: 12px 0; background: var(--bg-tertiary); border-radius: 10px; }
        .billing-toggle button { flex: 1; border: 0; border-radius: 7px; padding: 8px 10px; background: transparent; color: var(--text-muted); cursor: pointer; }
        .billing-toggle button.active { background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 2px 8px rgba(0, 0, 0, .12); }
        .plan-features { list-style: none !important; list-style-type: none !important; padding: 0 !important; margin: 0 0 20px; }
        .plan-features li { list-style: none; list-style-type: none; padding: 6px 0; font-size: 0.9rem; color: var(--text-secondary); display: flex; align-items: baseline; gap: 6px; }
        .plan-features li::before { content: "✓"; color: var(--accent); font-weight: 700; flex-shrink: 0; }
        .plan-current-label { color: var(--accent); font-weight: 600; font-size: 0.9rem; margin-bottom: 8px; }
        .btn-upgrade { width: 100%; padding: 12px; background: var(--ink); color: #fff; border: none; border-radius: 12px; box-shadow: 0 8px 20px rgba(17, 18, 15, .16); font-size: .92rem; font-weight: 650; cursor: pointer; }
        .btn-upgrade:hover { background: #2a2c27; transform: translateY(-1px); }
        .btn-upgrade:disabled { opacity: 0.6; cursor: default; }
        .btn-manage { padding: 10px 16px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--surface); color: var(--text-primary); box-shadow: var(--shadow-sm); cursor: pointer; }
        .btn-manage:disabled { opacity: 0.6; cursor: default; }
        @media (max-width: 600px) { .settings-section { padding: 20px; } .settings-tabs { display: grid; grid-template-columns: repeat(3, 1fr); width: 100%; } .settings-tab { padding-inline: 8px; } .settings-row { align-items: flex-start; flex-direction: column; } .billing-plans { grid-template-columns: 1fr; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>
    </>
  );
}
