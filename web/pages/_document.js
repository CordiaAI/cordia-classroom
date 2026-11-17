import { Html, Head, Main, NextScript } from 'next/document';
import { USE_CASES, useCasePath } from '../lib/useCases/index.mjs';
import { COMPARISONS, comparisonPath } from '../lib/comparisons/index.mjs';
import { bootScript } from '../lib/themeBoot.mjs';

// Public reading pages that stay light, and the Cordia default look, for signed-out visitors (lib/theme.js has the same rule),
// plus every guide under /guides/.
const LIGHT_SIGNED_OUT = ['/pricing', '/privacy', '/terms', '/honor-code', '/mission', '/instructors', '/copyright', '/guides', ...USE_CASES.map(useCasePath), ...COMPARISONS.map(comparisonPath)];

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
        {/* Set the saved look (light/dark and Make it yours) before first paint so nothing flashes the default. */}
        <script dangerouslySetInnerHTML={{ __html: bootScript(LIGHT_SIGNED_OUT) }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
