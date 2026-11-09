// The Chrome Web Store review line shown after "Enjoying Cordia?" is answered
// (components/ReviewPrompt.js, components/StoreReviewLine.js). Chrome Web Store policy: no
// incentive, and the ask is never shown only to happy users, so it doesn't depend on the rating.
import { EXTENSION_STORE_URL } from './extension.js';

export const STORE_REVIEWS_URL = `${EXTENSION_STORE_URL}/reviews`;
export const STORE_LINE = 'Using the Chrome extension? A review on the Chrome Web Store helps other students decide.';

// Whether to show the line. There is deliberately no rating here: any answer counts the same.
//   answered          the student picked a rating (any rating)
//   shownAt           when the line was shown before on this account (0 or missing: never)
//   extensionInstalled the extension announced itself on the page (lib/extensionBridge.js)
//   signedIn          a signed-in student, never a visitor
//   onFocusScreen     a study screen in focus mode (lib/featureReleases.js FOCUS_ROUTES)
//   sessionFinished   that screen's session is over (the finish card is showing)
export function storeLineDue({ answered, shownAt, extensionInstalled, signedIn, onFocusScreen, sessionFinished }) {
  if (!answered || shownAt || !extensionInstalled || !signedIn) return false;
  return !(onFocusScreen && !sessionFinished);
}
