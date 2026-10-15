import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Sheets render on <body> so a transformed or blurred ancestor can't clip them.
export default function BodyPortal({ children }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}
