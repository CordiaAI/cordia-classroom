import { openUpgrade } from '../lib/api';
import { listTypes } from '../lib/printQuiz.mjs';
import { resetLabel } from '../lib/plans';

// "Extra matching terms need an AI quiz, and this month's are used up. Resets Dec 1. Upgrade" for the types
// the student asked for but has no AI quiz left to write. Upgrade opens the plans window, and is left out
// when no plan gives more (the backend's upgrade_tier is null on the top plan); the date is when the plan's
// AI quizzes come back (the backend's resets_at).
export default function UsedUpNote({ types, resetsAt, upgradeTier, className }) {
  if (!types?.length) return null;
  const resets = resetLabel(resetsAt);
  return (
    <p className={className}>
      {listTypes(types).replace(/^./, letter => letter.toUpperCase())} need an AI quiz, and this month&rsquo;s are used up.
      {resets ? ` Resets ${resets}.` : ''}
      {upgradeTier !== null && <>{' '}<button type="button" className="used-up-upgrade" onClick={() => openUpgrade({ feature: 'ai_quiz', upgrade_tier: upgradeTier })}>Upgrade</button></>}
      <style jsx>{`
        .used-up-upgrade { min-height: 0; padding: 0; border: 0; background: none; color: var(--upgrade-link, var(--olive-ink)); font: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; border-radius: var(--r-input); }
      `}</style>
    </p>
  );
}
