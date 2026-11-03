import assert from "node:assert/strict";
import { test } from "node:test";
import { HERO_VIDEO_FILES } from "@/components/home/hero-video";
import { attachHeroVideo, type HeroVideoEnv } from "@/components/home/hero-video-controller";

type Listener = () => void;
// A minimal event target: dispatch(type) calls the listeners added for it.
function target() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: (type: string, listener: Listener) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener); },
    removeEventListener: (type: string, listener: Listener) => { listeners.get(type)?.delete(listener); },
    dispatch: (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener()),
    count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function setup({ hidden = false, complete = false, width = 1440, reduced = false, connection }: { hidden?: boolean; complete?: boolean; width?: number; reduced?: boolean; connection?: { saveData?: boolean; effectiveType?: string } } = {}) {
  const videoTarget = target(), documentTarget = target(), windowTarget = target(), motionTarget = target();
  const calls = { play: 0, pause: 0 };
  const video = {
    src: "",
    dataset: {} as Record<string, string | undefined>,
    getAttribute: (name: string) => (name === "src" && video.src ? video.src : null),
    play: async () => { calls.play++; },
    pause: () => { calls.pause++; },
    addEventListener: videoTarget.addEventListener,
    removeEventListener: videoTarget.removeEventListener,
  };
  const doc = { ...documentTarget, hidden, readyState: complete ? "complete" : "loading" };
  const motion = { ...motionTarget, matches: reduced };
  const scheduled: Listener[] = [];
  const env: HeroVideoEnv = {
    width: () => width,
    document: doc,
    window: windowTarget,
    motion,
    connection,
    schedule: (callback) => { scheduled.push(callback); return () => { const i = scheduled.indexOf(callback); if (i >= 0) scheduled.splice(i, 1); }; },
  };
  const detach = attachHeroVideo(video, env);
  return {
    video, calls, doc, motion, detach,
    load: () => windowTarget.dispatch("load"),
    idle: () => scheduled.splice(0).forEach((callback) => callback()),
    show: () => { doc.hidden = false; documentTarget.dispatch("visibilitychange"); },
    hide: () => { doc.hidden = true; documentTarget.dispatch("visibilitychange"); },
    setReduced: (value: boolean) => { motion.matches = value; motionTarget.dispatch("change"); },
    listeners: () => videoTarget.count() + documentTarget.count() + windowTarget.count() + motionTarget.count(),
  };
}

test("nothing is loaded before the window load event and the idle callback", () => {
  const page = setup();
  assert.equal(page.video.src, "");
  page.load();
  assert.equal(page.video.src, "", "load alone only schedules the start");
  page.idle();
  assert.equal(page.video.src, HERO_VIDEO_FILES.desktop);
  assert.equal(page.calls.play, 1);
});

test("a page that is already complete schedules the start at once, and a phone gets the 720p file", () => {
  const page = setup({ complete: true, width: 390 });
  page.idle();
  assert.equal(page.video.src, HERO_VIDEO_FILES.phone);
});

test("F1: a page opened in a hidden tab loads nothing, then starts the video when the tab is first shown", () => {
  const page = setup({ hidden: true });
  page.load();
  page.idle();
  assert.equal(page.video.src, "", "hidden: no file is requested");
  assert.equal(page.calls.play, 0);
  page.show();
  assert.equal(page.video.src, HERO_VIDEO_FILES.desktop, "visible: the file is chosen and set");
  assert.equal(page.calls.play, 1, "visible: playback starts");
});

test("F1: showing the tab before the page has finished loading waits for the load event and idle callback", () => {
  const page = setup({ hidden: true });
  page.show();
  assert.equal(page.video.src, "", "not loaded yet");
  page.load();
  page.idle();
  assert.equal(page.video.src, HERO_VIDEO_FILES.desktop);
});

test("a hidden tab pauses a playing video and showing it plays again without choosing the file twice", () => {
  const page = setup();
  page.load();
  page.idle();
  const src = page.video.src;
  page.hide();
  assert.equal(page.calls.pause, 1);
  page.show();
  assert.equal(page.video.src, src);
  assert.equal(page.calls.play, 2);
});

test("reduced motion keeps the poster only, even when the tab is shown later", () => {
  const page = setup({ hidden: true, reduced: true });
  page.load();
  page.idle();
  page.show();
  assert.equal(page.video.src, "");
  assert.equal(page.calls.play, 0);
});

test("data-saver and 2G keep the poster only, hidden or visible", () => {
  for (const connection of [{ saveData: true, effectiveType: "4g" }, { saveData: false, effectiveType: "2g" }, { saveData: false, effectiveType: "slow-2g" }]) {
    for (const hidden of [false, true]) {
      const page = setup({ hidden, connection });
      page.load();
      page.idle();
      page.show();
      assert.equal(page.video.src, "", JSON.stringify({ connection, hidden }));
      assert.equal(page.calls.play, 0);
    }
  }
});

test("turning reduced motion on pauses and shows the poster; turning it off starts the video", () => {
  const page = setup();
  page.load();
  page.idle();
  page.video.dataset.ready = "true";
  page.setReduced(true);
  assert.equal(page.calls.pause, 1);
  assert.equal(page.video.dataset.ready, undefined);
  page.setReduced(false);
  assert.equal(page.calls.play, 2);
});

test("a refused play leaves the poster showing", async () => {
  const page = setup();
  page.video.play = async () => { throw new Error("NotAllowedError"); };
  page.video.dataset.ready = "true";
  page.load();
  page.idle();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(page.video.dataset.ready, undefined);
});

test("cleanup removes every listener and cancels a pending start", () => {
  const page = setup();
  page.load();
  assert.ok(page.listeners() > 0);
  page.detach();
  assert.equal(page.listeners(), 0);
  page.idle();
  assert.equal(page.video.src, "", "a start cancelled by cleanup never runs");
  page.show();
  assert.equal(page.video.src, "");
});
