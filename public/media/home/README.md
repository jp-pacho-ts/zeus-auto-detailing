# Homepage background video

Source: the shop's own footage, supplied by the Lead Engineer as `For website tesla.mp4` (3840x2160 HEVC, 14.5 s, 37 MB). The LE confirmed on 2026-10-31 that they have the rights to use it. The source file is not in this repository.

Encoded once with the pinned `@ffmpeg-installer/win32-x64@4.1.0` (ffmpeg 20181217-f22fcd4, libx264), outside the project, with no audio and the index at the front for fast start:

- `hero-1080.mp4`: H.264 High, 1920x1080, CRF 27, preset slow. Served to screens wider than 800 px.
- `hero-720.mp4`: H.264 High, 1280x720, CRF 29, max 2.2 Mbit/s. Served to screens up to 800 px.
- `hero-poster.jpg` and `hero-poster-720.jpg`: first frame at 1920 and 1280 px wide. Shown before the video loads, and alone under reduced motion, data-saver or 2G.

Exact commands, hashes and sizes: `.team/handoffs/P1-33.md` (local, not tracked).
