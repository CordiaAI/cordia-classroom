// The script pages/_document.js runs before first paint, so the saved look is on <html> before
// anything is drawn and no page flashes the default. It reads the device cache lib/theme.js keeps
// (localStorage "cordiaLook", written by themeSettings.bootCache) and does no maths: a custom
// accent's variables are already in the cache. It is a string so a test can run it.
//
// The cache is one small value per account, under "cordiaLook:<user id>" (the id is in the key, never in the
// value), so a shared browser holds each account's look apart and the next account to sign in can only find its
// own. A cache written before that (one shared "cordiaLook") is read once for the account that has none yet,
// unless it names another account; lib/theme.js moves it to the account's own key and removes it.
//
// Public pages stay the Cordia default in light whatever was saved: LIGHT_ONLY and LIGHT_SIGNED_OUT below decide
// it, here and in lib/theme.js alike. Pricing is light and default for everyone, signed in or not.
import { USE_CASES, useCasePath } from './useCases/index.mjs';
import { COMPARISONS, comparisonPath } from './comparisons/index.mjs';

export const LOOK_KEY = 'cordiaLook';
// Public pages that still use the student's own text size (it is for reading, not looks): the Cordia default in
// light in every other way.
export const KEEPS_SIZE = ['/pricing'];
// The device cache of one account ('' when nobody is signed in).
export const lookKeyFor = id => (id ? LOOK_KEY + ':' + id : '');

// Pages that are always the Cordia default in light, signed in or not.
export const LIGHT_ONLY = ['/', '/login', '/signup', '/pricing', '/reset-password'];
// Public reading pages that are the Cordia default in light for a signed-out visitor and follow the account's look
// when signed in, plus every guide under /guides/ (GUIDES_PREFIX, which also covers the /guides/[slug] route pattern
// lib/theme.js is given). The one list both the first-paint script and lib/theme.js read, so a page can never get
// the student's look (or the sky) from one and the default from the other.
export const LIGHT_SIGNED_OUT = ['/privacy', '/terms', '/honor-code', '/mission', '/instructors', '/copyright', '/connect/claude', '/guides', ...USE_CASES.map(useCasePath), ...COMPARISONS.map(comparisonPath)];
export const GUIDES_PREFIX = '/guides/';
export const lightWhenSignedOut = path => LIGHT_SIGNED_OUT.includes(path) || path.startsWith(GUIDES_PREFIX);

export function bootScript(lightSignedOut = LIGHT_SIGNED_OUT) {
  return '(function(){try{'
    + 'var d=document.documentElement,ls=localStorage,p=location.pathname;'
    + 'var light=' + JSON.stringify(LIGHT_ONLY) + ".indexOf(p)>-1||((" + JSON.stringify(lightSignedOut) + ".indexOf(p)>-1||p.indexOf('" + GUIDES_PREFIX + "')===0)&&!ls.getItem('authToken'));"
    + "var me=ls.getItem('userId')||'',c=null,other=false;"
    // Another account's look on this browser: its own key, or the shared cache from before the keys when that names
    // another account. It is never painted, and it makes the old light/dark key (shared too) untrusted, so the next
    // account sees the Cordia default in Light, not the previous account's look. lib/theme.js applies the same rule.
    + "if(me){var raw=ls.getItem('" + LOOK_KEY + ":'+me),old=raw===null;if(old)raw=ls.getItem('" + LOOK_KEY + "');"
    + "try{c=JSON.parse(raw||'null')}catch(e){}"
    + "if(old&&c&&typeof c.u==='string'&&c.u&&c.u!==me){c=null;other=true}"
    + "for(var j=0;j<ls.length;j++){var k=ls.key(j);if(k&&k.indexOf('" + LOOK_KEY + ":')===0&&k!=='" + LOOK_KEY + ":'+me){other=true;break}}}"
    // Appearance: the saved look, else the old light/dark choice, else Light. An account that is new (lib/theme.js)
    // gets Match device written into the cache as soon as the account is known, so only then does this follow
    // the device: with no cache and no account yet, an existing student never flashes dark.
    + "var ap=c&&c.ap;if(ap!=='light'&&ap!=='dark'&&ap!=='system'){var t=other?null:ls.getItem('theme');ap=t==='dark'||t==='light'?t:'light'}"
    // The time-of-day sky (lib/skyTime.mjs, the same hours as skyPeriod): only off a public page, only when the saved
    // settings allow it (`k`; a cache from before it existed is read from its settings; with no cache it is the
    // default, on), and not when the device asks for less transparency or cannot frost. Set here, before first paint,
    // so the right sky is the first one drawn; at night it turns a Match device page dark.
    + "var sky=null,s=c&&c.s||{};"
    + "var sk=c?(typeof c.k==='number'?c.k===1:(s.bg||'clouds')==='clouds'&&(s.look||'none')==='none'&&s.glass!=='solid'&&s.skyTime!==false):true;"
    + "if(!light&&sk){var rt=!!window.matchMedia&&matchMedia('(prefers-reduced-transparency: reduce)').matches;"
    + "var fr=!window.CSS||!CSS.supports||CSS.supports('backdrop-filter','blur(1px)')||CSS.supports('-webkit-backdrop-filter','blur(1px)');"
    + "if(!rt&&fr){var h=new Date().getHours();sky=h>=20||h<6?'night':h>=17?'evening':h>=11?'day':'morning';d.setAttribute('data-sky',sky)}}"
    + "var dark=!light&&(ap==='dark'||(ap==='system'&&(sky==='night'||!!window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)));"
    + "d.setAttribute('data-theme',dark?'dark':'light');"
    // A public page that keeps the student's text size.
    + "if(light&&c&&" + JSON.stringify(KEEPS_SIZE) + ".indexOf(p)>-1&&c.a&&/^[a-z]+$/.test(c.a['data-size']||''))d.setAttribute('data-size',c.a['data-size']);"
    + 'if(!light&&c){'
    + "var a=c.a||{};for(var k in a){if(/^data-[a-z]+$/.test(k)&&typeof a[k]==='string')d.setAttribute(k,a[k])}"
    + "var v=c.v||{};for(var n in v){if(/^--ca-[a-z-]+$/.test(n)&&typeof v[n]==='string')d.style.setProperty(n,v[n])}"
    + "var f=c.f||[];for(var i=0;i<f.length;i++){if(typeof f[i]==='string'&&f[i].indexOf('/fonts/')===0){var l=document.createElement('link');l.rel='preload';l.as='font';l.type='font/woff2';l.crossOrigin='anonymous';l.href=f[i];document.head.appendChild(l)}}"
    + '}'
    + "d.setAttribute('data-side',ls.getItem('cordiaSide')==='collapsed'?'collapsed':'open');"
    + '}catch(e){}})();';
}
