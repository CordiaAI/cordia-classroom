import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { MessageCircle } from 'lucide-react';
import { SectionLoader } from '../CordiaLoader';
import { assistantApi } from '../../lib/assistant';
import { walkthroughEvent } from '../../lib/walkthrough';
import { PhoneStep, ProfileStep, SurveyStep } from './AssistantSetup';
import AssistantPersonality from './AssistantPersonality';
import AssistantSchedule from './AssistantSchedule';
import AssistantData from './AssistantData';
import AssistantUses from './AssistantUses';

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true };
const TABS = [
  { key: 'uses', label: 'Helps with' },
  { key: 'personality', label: 'Personality' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'data', label: 'Your data' },
];

function formatNumber(e164) {
  const d = String(e164 || '').replace(/^\+1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}

// Settings → Assistant: Cordia's texting assistant. Everything here is read from and saved to the
// Assistant (lib/assistant.js); its personalities, apps and consent wording come from its catalog.
export default function AssistantSettings({ onOpenPlan }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState(null);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('uses');
  const [toastText, setToastText] = useState('');
  const toastTimer = useRef(null);

  const toast = useCallback(text => {
    clearTimeout(toastTimer.current);
    setToastText(text);
    toastTimer.current = setTimeout(() => setToastText(''), 2500);
  }, []);

  const load = useCallback(async () => {
    const [cat, who] = await Promise.all([catalog ? { ok: true, data: catalog } : assistantApi('/catalog'), assistantApi('/me')]);
    if (!cat.ok || !who.ok) { setError(who.data?.error || cat.data?.error || "The Assistant didn't load. Refresh to try again."); return; }
    setError('');
    setCatalog(cat.data);
    setMe(who.data);
    if (who.data?.stage === 'active') walkthroughEvent('assistant-ready');
  }, [catalog]);

  useEffect(() => { load(); }, []);

  // Coming back from connecting an app. Apps are connected in Settings › Connectors now; this
  // still answers a sign-in that started from the Assistant's own link.
  useEffect(() => {
    if (!router.isReady) return;
    const { connected, connection } = router.query;
    if (!connected && !connection) return;
    toast(connected ? 'Connected' : "That app didn't connect. Try again.");
    const { connected: _c, connection: _f, provider: _p, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
  }, [router.isReady]);

  const setView = useCallback(view => setMe(current => ({ ...current, stage: 'active', settings: view })), []);

  // Saves one settings change; true when it stuck. Errors go to `onError`, or a toast.
  const save = useCallback(async (patch, onError) => {
    const out = await assistantApi('/settings', { method: 'PATCH', json: patch });
    if (out.ok) { setView(out.data); return true; }
    (onError || toast)(out.data.error || "That didn't save. Try again.");
    return false;
  }, [setView, toast]);

  if (error) return <div className="c-card asst-card" role="alert"><p>{error}</p><button type="button" className="c-btn c-btn--secondary" onClick={load}>Try again</button></div>;
  if (!me || !catalog) return <SectionLoader height={200} label="Loading the Assistant" />;

  const view = me.settings;
  const plan = view?.user.classroom;

  return (
    <div className="c-stack asst" data-spot="assistant">
      {me.stage === 'setup' && <PhoneStep onDone={load} />}
      {me.stage === 'onboarding' && me.onboarding.next === 'profile' && <ProfileStep catalog={catalog} phoneLast4={me.phone_last4} onDone={load} />}
      {me.stage === 'onboarding' && me.onboarding.next === 'survey' && (
        <SurveyStep key={me.onboarding.stage} items={me.onboarding.items} stage={me.onboarding.stage} onDone={load} />
      )}

      {me.stage === 'active' && (
        <>
          <div className="c-card asst-row">
            <span className="asst-row-label">
              <MessageCircle {...ICON} />
              <span className="asst-app-text">
                <strong className="asst-row-title">Texting from {formatNumber(catalog.sms_number)}</strong>
                <span className="c-meta">
                  To your number ending in {view.user.phone_last4} ·{' '}
                  {plan.unlimited ? (plan.onTrial ? 'Unlimited during your Pro trial' : 'Unlimited with Pro') : `Free plan: ${plan.free_daily} texts a day`}
                </span>
              </span>
            </span>
            <div className="asst-actions">
              {!plan.unlimited && <button type="button" className="c-btn c-btn--secondary" onClick={onOpenPlan}>{plan.trialAvailable ? 'Start Pro trial' : 'Get Pro'}</button>}
              <a className="c-btn c-btn--primary" href={`sms:${catalog.sms_number}`}>Text {view.identity.assistant_name}</a>
            </div>
          </div>

          <div className="c-seg asst-tabs" role="tablist" aria-label="Assistant settings">
            {TABS.map(item => (
              <button key={item.key} type="button" role="tab" id={`asst-tab-${item.key}`} aria-selected={tab === item.key} aria-controls={`asst-panel-${item.key}`} tabIndex={tab === item.key ? 0 : -1} onClick={() => setTab(item.key)}>
                {item.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`asst-panel-${tab}`} aria-labelledby={`asst-tab-${tab}`}>
            {tab === 'uses' && <AssistantUses view={view} catalog={catalog} save={save} />}
            {tab === 'personality' && <AssistantPersonality view={view} catalog={catalog} save={save} reload={load} toast={toast} />}
            {tab === 'schedule' && <AssistantSchedule view={view} catalog={catalog} save={save} toast={toast} />}
            {tab === 'data' && <AssistantData view={view} setView={setView} toast={toast} onDeleted={() => { toast('Assistant deleted'); setMe({ stage: 'setup' }); setTab('uses'); }} />}
          </div>
        </>
      )}

      {toastText && <div className="c-toast" role="status"><span>{toastText}</span></div>}
    </div>
  );
}
