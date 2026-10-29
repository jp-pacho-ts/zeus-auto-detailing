// P1-26 F2: the homepage is statically rendered, so only the browser knows whether this tab has seen the intro.
// This inline script runs before first paint. For a fresh, motion-allowed tab it adds a <style> to <head> that shows
// the black curtain from the first frame and keeps the content hidden, unfocusable and unclickable until HomeIntro
// takes over. (A <style> in <head>, not an attribute on React-rendered <html>, so hydration has nothing to mismatch.)
// Escape or a click on the curtain releases the page even before the app script loads. If the app script never
// runs, the style's own animation releases the page after 4s. It needs CSP script-src 'unsafe-inline'
// (src/config/security-headers.mjs); the homepage browser check fails if the curtain stops showing.
export const HOME_INTRO_SESSION_KEY = "zeus.home.intro.v1";
export const HOME_INTRO_PREPAINT_ID = "zeus-home-intro-prepaint";
export const HOME_INTRO_PENDING_STYLE_ID = "zeus-home-intro-pending";
// HomeIntro does not start the intro this late: the CSS fallback is about to release the page.
export const HOME_INTRO_LATEST_START_MS = 3500;

// The head style comes before the page's own <style>, so the curtain selector outranks `.zeus-intro[hidden]`.
export const HOME_INTRO_PENDING_CSS =
  "[data-home-curtain].zeus-intro[hidden]{display:grid;animation:zeus-intro-release 0s 4s forwards}" +
  ".zeus-intro__mark{visibility:hidden}" +
  "[data-home-content]{visibility:hidden;animation:zeus-content-release 0s 4s forwards}" +
  "@keyframes zeus-intro-release{to{visibility:hidden}}" +
  "@keyframes zeus-content-release{to{visibility:visible}}";

export const HOME_INTRO_PREPAINT =
  "(function(){try{" +
  `if(sessionStorage.getItem("${HOME_INTRO_SESSION_KEY}")||matchMedia("(prefers-reduced-motion: reduce)").matches)return;` +
  'var s=document.createElement("style");' +
  `s.id="${HOME_INTRO_PENDING_STYLE_ID}";` +
  `s.textContent="${HOME_INTRO_PENDING_CSS}";` +
  "document.head.appendChild(s);" +
  "var release=function(){" +
  "s.remove();" +
  'removeEventListener("keydown",key,true);removeEventListener("click",click,true)};' +
  // A skip before the app script loads counts as seen, so a reload doesn't replay the intro.
  `var skip=function(){try{sessionStorage.setItem("${HOME_INTRO_SESSION_KEY}","seen")}catch(e){}release()};` +
  'var key=function(e){if(e.key==="Escape")skip()};' +
  'var click=function(e){var t=e.target;if(t&&t.closest&&t.closest("[data-home-curtain]"))skip()};' +
  'addEventListener("keydown",key,true);addEventListener("click",click,true);' +
  "window.__zeusHomeIntroRelease=release" +
  "}catch(e){}})()";
