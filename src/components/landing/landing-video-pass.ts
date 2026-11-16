import { chooseHeroVideo } from "@/components/home/hero-video";

// One physically short pass. Interruptions consume it; the approved terminal poster stays underneath.
export function attachLandingPass(video: HTMLVideoElement, pass: { consumed: boolean }): () => void {
  video.style.opacity = "0";
  if (pass.consumed) { video.pause(); return () => {}; }
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  let visible = false, finished = false, started = false, deadline: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    finished = true; pass.consumed = true;
    clearTimeout(deadline); video.style.opacity = "0"; video.pause();
  };
  const update = () => {
    if (finished) return;
    // P1-90: phones show the whole-car still photo instead; the pass ends on a close-up that does not show the car at 390.
    const allowed = innerWidth > 767 && chooseHeroVideo({ width: innerWidth, reducedMotion: motion.matches, saveData: !!connection?.saveData, effectiveType: connection?.effectiveType });
    if (!allowed || document.hidden || (started && !visible)) { finish(); return; }
    if (started || !visible || document.readyState !== "complete") return;
    if (!video.canPlayType('video/webm; codecs="vp9"')) { finish(); return; }
    started = true; pass.consumed = true;
    video.src = innerWidth <= 800 ? "/media/preview/hero-pass-720.webm" : "/media/preview/hero-pass.webm";
    // Defensive ceiling only; the encoded/container duration is independently verified as 4.25 seconds.
    deadline = setTimeout(finish, 4500);
    video.play().then(() => { if (finished) video.pause(); }).catch(finish);
  };
  const playing = () => { if (finished) video.pause(); else video.style.opacity = "1"; };
  const metadata = () => { if (!Number.isFinite(video.duration) || video.duration > 5) finish(); };
  const paused = () => { if (started && !finished) finish(); };
  video.addEventListener("playing", playing); video.addEventListener("pause", paused);
  video.addEventListener("ended", finish); video.addEventListener("error", finish); video.addEventListener("loadedmetadata", metadata);
  document.addEventListener("visibilitychange", update); window.addEventListener("load", update); motion.addEventListener("change", update);
  const seen = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
  seen.observe(video.closest("section") ?? video);
  update();
  return () => {
    seen.disconnect(); clearTimeout(deadline);
    document.removeEventListener("visibilitychange", update); window.removeEventListener("load", update); motion.removeEventListener("change", update);
    video.removeEventListener("playing", playing); video.removeEventListener("pause", paused);
    video.removeEventListener("ended", finish); video.removeEventListener("error", finish); video.removeEventListener("loadedmetadata", metadata);
    finished = true; video.style.opacity = "0"; video.pause();
  };
}
