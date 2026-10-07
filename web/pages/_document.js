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
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
