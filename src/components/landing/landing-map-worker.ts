// Loaded only in the browser (dynamic import from landing-visit-map): `import.meta` here would make the server-side
// test loader treat the map component as an ES module. The bundler emits MapLibre's worker as a same-origin asset.
export const mapWorkerAsset = new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href;
