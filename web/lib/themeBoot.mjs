// The script pages/_document.js runs before first paint, so the saved look is on <html> before
// anything is drawn and no page flashes the default. It reads the device cache lib/theme.js keeps
// (localStorage "cordiaLook", written by themeSettings.bootCache) and does no maths: a custom
// accent's variables are already in the cache. It is a string so a test can run it.
//
// Public pages stay the Cordia default in light whatever was saved: the same list that keeps them
// light today decides it. Pricing is light and default for everyone, signed in or not (lib/theme.js LIGHT_ONLY).
export const LOOK_KEY = 'cordiaLook';

export function bootScript(lightSignedOut) {
  return '(function(){try{'
    + 'var d=document.documentElement,ls=localStorage,p=location.pathname;'
    + "var light=['/','/login','/signup','/pricing','/reset-password'].indexOf(p)>-1||((" + JSON.stringify(lightSignedOut) + ".indexOf(p)>-1||p.indexOf('/guides/')===0)&&!ls.getItem('authToken'));"
    + "var c=null;try{c=JSON.parse(ls.getItem('" + LOOK_KEY + "')||'null')}catch(e){}"
    // Another account's cache (a shared browser): the Cordia default in Light, not the previous account's look, and
    // not the old light/dark key either (shared too). lib/theme.js applies the same rule after first paint.
    + "var me=ls.getItem('userId')||'',other=!!(c&&typeof c.u==='string'&&c.u&&me&&c.u!==me);if(other)c=null;"
    // Appearance: the saved look, else the old light/dark choice, else Light. An account that is new (lib/theme.js)
    // gets Match device written into the cache as soon as the account is known, so only then does this follow
    // the device: with no cache and no account yet, an existing student never flashes dark.
    + "var ap=c&&c.ap;if(ap!=='light'&&ap!=='dark'&&ap!=='system'){var t=other?null:ls.getItem('theme');ap=t==='dark'||t==='light'?t:'light'}"
    + "var dark=!light&&(ap==='dark'||(ap==='system'&&!!window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches));"
    + "d.setAttribute('data-theme',dark?'dark':'light');"
    + 'if(!light&&c){'
    + "var a=c.a||{};for(var k in a){if(/^data-[a-z]+$/.test(k)&&typeof a[k]==='string')d.setAttribute(k,a[k])}"
    + "var v=c.v||{};for(var n in v){if(/^--ca-[a-z-]+$/.test(n)&&typeof v[n]==='string')d.style.setProperty(n,v[n])}"
    + "var f=c.f||[];for(var i=0;i<f.length;i++){if(typeof f[i]==='string'&&f[i].indexOf('/fonts/')===0){var l=document.createElement('link');l.rel='preload';l.as='font';l.type='font/woff2';l.crossOrigin='anonymous';l.href=f[i];document.head.appendChild(l)}}"
    + '}'
    + "d.setAttribute('data-side',ls.getItem('cordiaSide')==='collapsed'?'collapsed':'open');"
    + '}catch(e){}})();';
}
