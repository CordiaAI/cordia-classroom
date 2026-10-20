import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preload" href="/fonts/manrope.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/newsreader.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="icon" href="/cordia-classroom.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/cordia-classroom-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="theme-color" content="#39432f" />
        {/* Set the saved theme before first paint so the nav never flashes the wrong colors. */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){try{var p=location.pathname;var light=['/','/login','/signup','/reset-password'].indexOf(p)>-1||(['/pricing','/privacy','/terms','/honor-code','/mission','/instructors','/copyright'].indexOf(p)>-1&&!localStorage.getItem('authToken'));document.documentElement.setAttribute('data-theme',!light&&localStorage.getItem('theme')==='dark'?'dark':'light');}catch(e){}})();" }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
