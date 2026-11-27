"use client";
import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import { brandConfig } from "@/config/brand";

// LE 2026-11-20: a tilted 3D map (MapLibre + OpenFreeMap "liberty", free, no key) that slowly orbits the shop.
// MapLibre loads only when the section is near; the orbit stops for good once a visitor drags, scrolls or touches
// the map, pauses off screen and never runs for reduced motion. Without WebGL (or if MapLibre fails) the Google
// embed stands in. "Get directions" stays a Google Maps link.
export const LANDING_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const [lat, lng] = brandConfig.mapCoordinates.split(",").map(Number);
const DEGREES_PER_MS = .006; // one full orbit a minute

export function LandingVisitMap() {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let disposed = false;
    let workerBlob = "";
    let teardown = () => {};
    const near = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      try {
        const { Map, Marker, setWorkerUrl } = await import("maplibre-gl");
        if (disposed) return;
        // Bundled, MapLibre cannot find its sibling worker file, so the bundler emits it as an asset. It runs from a
        // blob: URL because a blob worker inherits this page's CSP (which allows the tile host); a worker served from
        // /_next/static would get the site-wide CSP and could not fetch tiles.
        const { mapWorkerAsset } = await import("./landing-map-worker");
        const source = await fetch(mapWorkerAsset);
        if (!source.ok) throw new Error("map worker unavailable");
        workerBlob = URL.createObjectURL(new Blob([await source.text()], { type: "text/javascript" }));
        if (disposed) return;
        setWorkerUrl(workerBlob);
        const map = new Map({
          container: element, style: LANDING_MAP_STYLE, center: [lng, lat], zoom: 16.4, pitch: 60, bearing: -24, maxPitch: 72,
          cooperativeGestures: true, attributionControl: { compact: true },
        });
        const pin = document.createElement("div");
        pin.className = "landing-map-pin";
        pin.append(document.createElement("span"));
        pin.setAttribute("aria-hidden", "true");
        new Marker({ element: pin, anchor: "center" }).setLngLat([lng, lat]).addTo(map);
        let orbit = !matchMedia("(prefers-reduced-motion: reduce)").matches;
        let onScreen = true, frame = 0, last = 0;
        const turn = (now: number) => {
          if (orbit && onScreen && last) map.setBearing(map.getBearing() + (now - last) * DEGREES_PER_MS);
          last = now;
          frame = requestAnimationFrame(turn);
        };
        const stop = () => { orbit = false; };
        for (const type of ["mousedown", "touchstart", "wheel"] as const) map.on(type, stop);
        map.once("load", () => { frame = requestAnimationFrame(turn); });
        const seen = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; });
        seen.observe(element);
        teardown = () => { cancelAnimationFrame(frame); seen.disconnect(); map.remove(); };
      } catch {
        if (!disposed) setFailed(true);
      }
    }, { rootMargin: "400px 0px" });
    near.observe(element);
    return () => { disposed = true; near.disconnect(); teardown(); if (workerBlob) URL.revokeObjectURL(workerBlob); };
  }, []);
  if (failed) return <iframe src={brandConfig.mapEmbedUrl} title={`Google Maps location for ${brandConfig.businessName}`} loading="lazy" referrerPolicy="no-referrer" allowFullScreen />;
  return <div ref={box} className="landing-visit-map-canvas" role="region" aria-label={`3D map around ${brandConfig.businessName}. Use Get directions for Google Maps.`} />;
}
