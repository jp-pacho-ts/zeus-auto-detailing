import test from "node:test";
import assert from "node:assert/strict";

test("one hero pass cannot restart after visibility, re-entry, preference change or effect remount", async () => {
  // The controller uses real EventTarget events; no provider, media download or database is involved.
  const original = new Map<string, PropertyDescriptor | undefined>();
  const windowEvents = new EventTarget();
  const documentEvents = Object.assign(new EventTarget(), { hidden: false, readyState: "complete" });
  const preference = Object.assign(new EventTarget(), { matches: false });
  let observe: (entries: { isIntersecting: boolean }[]) => void = () => {};
  class Video extends EventTarget {
    style = { opacity: "0" }; src = ""; paused = true; plays = 0;
    canPlayType() { return "probably"; }
    closest() { return this; }
    getAttribute() { return this.src || null; }
    play() { this.plays++; this.paused = false; this.dispatchEvent(new Event("playing")); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  for (const [key, value] of Object.entries({ window: windowEvents, document: documentEvents, innerWidth: 1440, navigator: {}, matchMedia: () => preference,
    IntersectionObserver: class { constructor(callback: typeof observe) { observe = callback; } observe() { observe([{ isIntersecting: true }]); } disconnect() {} },
  })) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); }
  let clean = () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const controller = (() => { try { return require("./landing-video-pass") as { attachLandingPass?: (video: HTMLVideoElement, pass: { consumed: boolean }) => () => void }; } catch { return {}; } })();
    assert.equal(typeof controller.attachLandingPass, "function", "landing-only pass controller exists");
    const video = new Video(), pass = { consumed: false };
    clean = controller.attachLandingPass!(video as unknown as HTMLVideoElement, pass);
    assert.equal(video.plays, 1);
    assert.equal(video.style.opacity, "1");
    documentEvents.hidden = true; documentEvents.dispatchEvent(new Event("visibilitychange"));
    assert.equal(video.paused, true); assert.equal(video.style.opacity, "0");
    documentEvents.hidden = false; documentEvents.dispatchEvent(new Event("visibilitychange"));
    observe([{ isIntersecting: false }]); observe([{ isIntersecting: true }]);
    preference.matches = true; preference.dispatchEvent(new Event("change")); preference.matches = false; preference.dispatchEvent(new Event("change"));
    assert.equal(video.plays, 1);
    clean(); clean = controller.attachLandingPass!(video as unknown as HTMLVideoElement, pass);
    video.dispatchEvent(new Event("playing"));
    assert.equal(video.plays, 1); assert.equal(video.paused, true); assert.equal(video.style.opacity, "0");
    await Promise.resolve();
  } finally {
    clean(); for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});

test("phones (767 px and below) never start the pass: the whole-car still photo is the hero (P1-90)", () => {
  const original = new Map<string, PropertyDescriptor | undefined>();
  const documentEvents = Object.assign(new EventTarget(), { hidden: false, readyState: "complete" });
  class Video extends EventTarget {
    style = { opacity: "0" }; src = ""; plays = 0;
    canPlayType() { return "probably"; } closest() { return this; }
    play() { this.plays++; return Promise.resolve(); } pause() {}
  }
  for (const [key, value] of Object.entries({ window: new EventTarget(), document: documentEvents, innerWidth: 390, navigator: {}, matchMedia: () => Object.assign(new EventTarget(), { matches: false }),
    IntersectionObserver: class { constructor(private callback: (e: { isIntersecting: boolean }[]) => void) {} observe() { this.callback([{ isIntersecting: true }]); } disconnect() {} },
  })) { original.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { value, configurable: true }); }
  let clean = () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { attachLandingPass } = require("./landing-video-pass") as typeof import("./landing-video-pass");
    const video = new Video(), pass = { consumed: false };
    clean = attachLandingPass(video as unknown as HTMLVideoElement, pass);
    assert.equal(video.plays, 0);
    assert.equal(video.src, "");
    assert.equal(pass.consumed, true);
  } finally {
    clean(); for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
