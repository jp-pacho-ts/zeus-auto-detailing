import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { brandConfig } from "@/config/brand";
import HomePage from "@/app/page";
import { HERO_VIDEO_FILES, chooseHeroVideo } from "@/components/home/hero-video";

const html = () => renderToStaticMarkup(HomePage());
const body = () => html().replace(/<style>[\s\S]*?<\/style>/g, "");
const phone = `tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`;

test("P1-33: the header bar, footer bar, contact band, Unsplash photos and photo credit are gone", () => {
  const content = body();
  assert.doesNotMatch(content, /<header\b|<footer\b|zeus-contact-band|zeus-craft|zeus-photo-caption/);
  assert.doesNotMatch(content, /automotive\.jpg|polishing\.jpg|Photography|unsplash/i);
});

test("P1-33: the logo is present, comes before the headline, and is the only logo image", () => {
  const content = body();
  const logo = content.indexOf(`alt="${brandConfig.businessName}"`);
  assert.ok(logo >= 0, "logo image present");
  assert.ok(logo < content.indexOf("<h1"), "logo precedes the headline");
  assert.equal(content.split(`alt="${brandConfig.businessName}"`).length - 1, 1);
});

test("P1-33: the video markup is muted, looping, inline, hidden from assistive tech and loads nothing before paint", () => {
  const content = body();
  const video = content.match(/<video\b[^>]*>/);
  assert.ok(video, "a video element is rendered");
  const tag = video[0];
  for (const attr of ["muted", "loop", "playsInline", "aria-hidden=\"true\""]) {
    assert.ok(tag.includes(attr) || tag.includes(attr.toLowerCase()), `video has ${attr}`);
  }
  assert.match(tag, /preload="none"/);
  assert.doesNotMatch(tag, /\ssrc=/, "no src in the server HTML");
  const videoBlock = content.match(/<video\b[^>]*>[\s\S]*?<\/video>/);
  assert.ok(videoBlock);
  assert.doesNotMatch(videoBlock[0], /<source\b/, "the video has no source element in the server HTML");
  assert.doesNotMatch(content, /autoPlay|autoplay/, "autoplay is started by script after load, not by markup");
  assert.doesNotMatch(content, /\.mp4/, "no mp4 URL anywhere in the server HTML");
  assert.doesNotMatch(content, /<audio\b|controls/);
});

test("P1-33: the poster is a same-origin local file, so the page looks right before the video loads", () => {
  const content = html();
  assert.match(content, /\/media\/home\/hero-poster/);
  assert.doesNotMatch(content, /https?:\/\/[^"' ]+\.(?:jpg|mp4|webm)/i, "no external media");
});

test("P1-33: the overlay keeps the notice, the Call and Facebook actions and one contact line", () => {
  const content = body();
  assert.equal((content.match(/<h1\b/g) ?? []).length, 1);
  assert.match(content, /Coming soon/);
  assert.match(content, /Our new website/);
  assert.ok(content.includes(`href="${phone}"`));
  assert.ok(content.includes(`href="${brandConfig.facebookPageUrl}"`));
  // P1-47: the address is a location icon link (its spoken name carries the address), not a line of text, and the
  // phone number stays on the Call button only (P1-46).
  const location = content.match(/<a\b[^>]*aria-label="[^"]*location: [^"]*"[^>]*>/);
  assert.ok(location, "one location link in the overlay");
  assert.ok(location[0].includes(brandConfig.location));
  assert.ok(!location[0].includes(brandConfig.displayPhone));
});

test("P1-33: the media files are the encoded local assets", () => {
  assert.equal(HERO_VIDEO_FILES.desktop, "/media/home/hero-1080.mp4");
  assert.equal(HERO_VIDEO_FILES.phone, "/media/home/hero-720.mp4");
});

test("P1-33: chooseHeroVideo picks 720p for phones, 1080p for larger screens and nothing when motion or data is limited", () => {
  const base = { width: 1440, reducedMotion: false, saveData: false, effectiveType: "4g" as string | undefined };
  assert.equal(chooseHeroVideo(base), HERO_VIDEO_FILES.desktop);
  assert.equal(chooseHeroVideo({ ...base, width: 801 }), HERO_VIDEO_FILES.desktop);
  assert.equal(chooseHeroVideo({ ...base, width: 800 }), HERO_VIDEO_FILES.phone);
  assert.equal(chooseHeroVideo({ ...base, width: 390 }), HERO_VIDEO_FILES.phone);
  assert.equal(chooseHeroVideo({ ...base, reducedMotion: true }), null);
  assert.equal(chooseHeroVideo({ ...base, saveData: true }), null);
  assert.equal(chooseHeroVideo({ ...base, effectiveType: "2g" }), null);
  assert.equal(chooseHeroVideo({ ...base, effectiveType: "slow-2g" }), null);
  assert.equal(chooseHeroVideo({ ...base, effectiveType: undefined }), HERO_VIDEO_FILES.desktop, "unknown connection still plays");
  assert.equal(chooseHeroVideo({ ...base, effectiveType: "3g" }), HERO_VIDEO_FILES.desktop);
});
