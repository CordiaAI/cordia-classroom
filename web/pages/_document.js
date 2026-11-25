import { Html, Head, Main, NextScript } from 'next/document';
import { bootScript } from '../lib/themeBoot.mjs';
import { shellBootScript } from '../lib/newShell.mjs';
import { pageDefault } from '../lib/server/newShell.mjs';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preload" href="/fonts/quicksand.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/newsreader.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="icon" href="/cordia-classroom.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/cordia-classroom-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#39432f" />
        {/* Set the saved look (light/dark and Make it yours) before first paint so nothing flashes the default.
            Which public pages stay light is one list, shared with lib/theme.js (lib/themeBoot.mjs LIGHT_SIGNED_OUT). */}
        <script dangerouslySetInnerHTML={{ __html: bootScript() }} />
        {/* The new app shell's switch (lib/newShell.mjs), before first paint so neither shell flashes:
            the device's answer for the signed-in account, and two booleans from the server's environment. */}
        <script dangerouslySetInnerHTML={{ __html: shellBootScript(pageDefault()) }} />
      </Head>
      <body>
        {/* The time-of-day sky's layers (styles/tokens.css .c-sky): drawn only while <html data-sky> is set. Outside
            React, so it is in the first HTML and never re-renders. */}
        <div className="c-sky" aria-hidden="true"><div className="c-sky-night" /></div>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
