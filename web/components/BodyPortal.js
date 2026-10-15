import { createPortal } from 'react-dom';

// Sheets and dialogs render at the end of <body>. Inside the glass top bar or a glass card,
// backdrop-filter would trap their fixed scrim inside that box (Help showed no scrim).
export default function BodyPortal({ children }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
