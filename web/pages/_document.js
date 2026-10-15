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
        {/* Set the theme before first paint so dark mode never flashes light. */}
        <script dangerouslySetInnerHTML={{ __html: "(function(){try{var p=location.pathname;var pub=['/','/login','/signup','/pricing','/reset-password'].indexOf(p)>-1;var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',!pub&&d?'dark':'light');}catch(e){}})();" }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
