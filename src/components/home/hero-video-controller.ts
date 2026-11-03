import { chooseHeroVideo } from "./hero-video";

// The lifecycle of the background video, with the browser objects injected so it is tested without a browser.
// Rules: nothing loads before the window load event; the file is chosen by chooseHeroVideo (reduced motion, data-saver
// and 2G keep the poster only); a hidden tab loads nothing and starts the video when it becomes visible.

export type VideoLike = {
  src: string;
  dataset: Record<string, string | undefined>;
  getAttribute(name: string): string | null;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
type Target = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
export type HeroVideoEnv = {
  width: () => number;
  document: Target & { hidden: boolean; readyState: string };
  window: Target;
  motion: Target & { matches: boolean };
  connection?: { saveData?: boolean; effectiveType?: string };
  /** Runs the callback when the browser is idle (or soon); returns a function that cancels it. */
  schedule: (callback: () => void) => () => void;
};

export function attachHeroVideo(video: VideoLike, env: HeroVideoEnv): () => void {
  let loaded = false;
  let disposed = false;
  let cancelSchedule: (() => void) | undefined;
  const showPoster = () => { delete video.dataset.ready; };
  const playing = () => { video.dataset.ready = "true"; };
  const stop = () => {
    video.pause();
    showPoster();
  };
  // Safe to call any number of times: it picks the file only once, and every gate is re-evaluated on each call.
  const start = () => {
    if (disposed || env.document.hidden) return;
    const file = chooseHeroVideo({
      width: env.width(),
      reducedMotion: env.motion.matches,
      saveData: env.connection?.saveData === true,
      effectiveType: env.connection?.effectiveType,
    });
    if (!file) return;
    if (!video.getAttribute("src")) video.src = file;
    // A refused or failed play leaves the poster in place; there is nothing to retry.
    video.play().catch(showPoster);
  };
  const onLoad = () => {
    loaded = true;
    cancelSchedule = env.schedule(start);
  };
  const onMotion = () => (env.motion.matches ? stop() : loaded && start());
  // Opening in a background tab sets no src, so becoming visible must start the video, not only resume one.
  const onVisibility = () => (env.document.hidden ? video.pause() : loaded && start());
  video.addEventListener("playing", playing);
  video.addEventListener("error", showPoster);
  env.motion.addEventListener("change", onMotion);
  env.document.addEventListener("visibilitychange", onVisibility);
  if (env.document.readyState === "complete") onLoad();
  else env.window.addEventListener("load", onLoad);
  return () => {
    disposed = true;
    cancelSchedule?.();
    env.window.removeEventListener("load", onLoad);
    env.document.removeEventListener("visibilitychange", onVisibility);
    env.motion.removeEventListener("change", onMotion);
    video.removeEventListener("playing", playing);
    video.removeEventListener("error", showPoster);
    video.pause();
  };
}
