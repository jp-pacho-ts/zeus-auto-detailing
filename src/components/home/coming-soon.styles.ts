export const comingSoonStyles = `
@font-face{
  font-family:ZeusDisplay;
  src:url('/fonts/home/BarlowCondensed-ExtraBold.ttf') format('truetype');
  font-weight:800;
  font-display:swap}

@font-face{
  font-family:ZeusBody;
  src:url('/fonts/home/DMSans.ttf') format('truetype');
  font-weight:100 900;
  font-display:swap}

.zeus-coming-soon{
  --gold:#c39030;
  --paper:#f2eee7;
  --ink:#0b0b0c;
  --mute:#d6d0c6;
  background:var(--ink);
  color:var(--paper);
  font-family:ZeusBody,Arial,sans-serif;
  min-height:100svh}

.zeus-coming-soon *{
  box-sizing:border-box}
.zeus-coming-soon a{
  color:inherit;
  text-decoration:none}
.zeus-coming-soon a:focus-visible,.zeus-intro button:focus-visible{
  outline:3px solid #e1b567;
  outline-offset:5px}
.zeus-coming-soon p{
  margin:0}

/* P1-46 layout. A full-screen cinematic hero, no boxes: the picture is the page and soft fades carry the text.
   Desktop: headline, one line and the Call pill sit left, vertically centred; the social icons and address sit bottom
   left; the logo sits bottom right, centred on the icons and address beside it. The logo is first in reading order
   and is placed by the grid. */
.zeus-hero{
  position:relative;
  isolation:isolate;
  min-height:100svh;
  overflow:hidden;
  display:grid;
  grid-template-columns:minmax(0,1fr) auto;
  grid-template-rows:1fr auto;
  column-gap:32px;
  padding:max(72px,env(safe-area-inset-top)) 7% max(56px,env(safe-area-inset-bottom))}
.zeus-hero-media{
  position:absolute;
  inset:0;
  z-index:-3;
  background:var(--ink)}
.zeus-hero-poster,.zeus-hero-video{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  object-fit:cover;
  object-position:62% 55%;
  filter:contrast(1.05) saturate(.85) brightness(.95)}
.zeus-hero-video{
  opacity:0;
  transition:opacity .8s ease}
.zeus-hero-video[data-ready=true]{
  opacity:1}
/* A long fade from the left edge carries the text and keeps the car clean on the right; a soft fade at the bottom
   carries the icons and address, and one at the top keeps the picture from feeling cut off. */
.zeus-hero-shade{
  position:absolute;
  inset:0;
  z-index:-2;
  background:
    linear-gradient(90deg,#0b0b0cfa 0%,#0b0b0ce6 26%,#0b0b0c99 44%,#0b0b0c33 62%,transparent 78%),
    linear-gradient(0deg,#0b0b0cd8 0%,#0b0b0c80 16%,transparent 34%)}

.zeus-hero-body{
  grid-column:1/-1;
  grid-row:1;
  align-self:center;
  min-width:0;
  max-width:520px;
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:22px}
.zeus-coming-soon h1{
  font-family:ZeusDisplay,Impact,sans-serif;
  font-size:clamp(88px,9.6vw,150px);
  font-weight:800;
  line-height:.8;
  letter-spacing:-.02em;
  text-transform:uppercase;
  margin:0}
.zeus-coming-soon h1 span{
  color:var(--gold)}
.zeus-lede{
  font-size:1rem;
  line-height:1.6;
  color:var(--paper);
  max-width:30ch}

/* P1-56: one dark pill with two segments (Book now, Manage booking), a thin divider and a gold edge whose highlight
   travels around it. The edge is a conic gradient on an animated angle, painted in the border box behind the dark
   inner fill, so it needs no extra element and no script. */
@property --zeus-edge{
  syntax:'<angle>';
  inherits:false;
  initial-value:0deg}
@keyframes zeus-edge-spin{
  to{--zeus-edge:360deg}}
.zeus-actions{
  display:flex;
  align-items:stretch;
  width:max-content;
  max-width:100%;
  min-height:54px;
  padding:1px;
  border-radius:999px;
  background:
    linear-gradient(#100f0d,#100f0d) padding-box,
    conic-gradient(from var(--zeus-edge),#f2eee724 0deg,#f2eee724 200deg,#c58b1b 250deg,#e8b44a 295deg,#fbe3a0 330deg,#e8b44a 345deg,#f2eee724 360deg) border-box;
  border:1px solid transparent;
  box-shadow:0 10px 40px #0b0b0c80,0 0 22px #c3903024;
  animation:zeus-edge-spin 4s linear infinite}
.zeus-seg{
  position:relative;
  flex:1 1 auto;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  min-height:52px;
  min-width:0;
  padding:8px 26px;
  border-radius:999px;
  font-size:.9375rem;
  font-weight:600;
  line-height:1.25;
  text-align:center;
  color:var(--mute);
  transition:background .2s,color .2s}
.zeus-seg svg{
  width:18px;
  height:18px;
  flex:none;
  color:#e8b44a}
.zeus-seg--primary{
  color:#fbe3a0;
  background:#c3903026}
.zeus-seg + .zeus-seg::before{
  content:"";
  position:absolute;
  left:-1px;
  top:14px;
  bottom:14px;
  width:1px;
  background:#f2eee73d}
.zeus-seg:hover{
  background:#c3903040;
  color:#fff3d0}
.zeus-coming-soon a.zeus-seg:focus-visible{
  outline-offset:-4px}

/* Bottom row: three 44px icon links (Facebook, Instagram, location) side by side, with the logo centred on that row.
   The address is no longer text; the location link's name and tooltip carry it (P1-47). */
.zeus-hero-foot{
  grid-column:1;
  grid-row:2;
  /* The logo (52px) is a little taller than the 44px icons, so the row is as tall as the logo; centring both keeps them level. */
  align-self:center;
  min-width:0;
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  position:relative;
  z-index:1}
.zeus-social{
  display:flex;
  gap:12px}
.zeus-social a{
  width:44px;
  height:44px;
  border-radius:50%;
  border:1px solid #f2eee799;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  transition:background .2s,border-color .2s}
.zeus-social a:hover{
  border-color:var(--gold);
  background:#c3903033}
.zeus-social svg{
  width:20px;
  height:20px;
  display:block}
.zeus-hero-logo{
  grid-column:2;
  grid-row:2;
  align-self:center;
  justify-self:end;
  position:relative;
  z-index:1}
.zeus-coming-soon__logo{
  height:52px;
  width:auto;
  display:block}

.zeus-intro[hidden]{
  display:none}
.zeus-intro{
  position:fixed;
  inset:0;
  z-index:1000;
  display:grid;
  place-items:center;
  background:#000;
  color:#e7ded0;
  font-family:ZeusBody,Arial,sans-serif}
.zeus-intro__mark{
  width:min(65vw,330px);
  text-align:center}
.zeus-intro__mark img{
  width:100%;
  height:auto}
.zeus-intro__mark p{
  font-size:.875rem;
  margin:28px -20px 22px}
.zeus-intro__mark>span{
  display:block;
  height:2px;
  width:64px;
  background:#c39030;
  margin:auto}
.zeus-intro__skip{
  position:absolute;
  bottom:30px;
  right:5.55%;
  font-size:.875rem;
  padding:14px 20px;
  min-height:44px;
  color:#c4bbb0;
  background:transparent;
  border:0;
  cursor:pointer}

/* Phones and tablets. The headline starts at the top, sized so the word COMING spans the text column; the clear band
   between the line and the Call pill is where the car shows; Call and the icons, address and logo sit at the bottom.
   One left edge, 28px side margins. The body wrapper disappears (display:contents) so the headline, line and Call
   become grid rows of the hero. */
@media(max-width:800px){
  .zeus-hero{
    grid-template-rows:auto 1fr auto auto;
    column-gap:16px;
    padding:max(56px,env(safe-area-inset-top)) 28px max(48px,env(safe-area-inset-bottom))}
  .zeus-hero-body{
    display:contents}
  .zeus-coming-soon h1{
    grid-row:1;
    grid-column:1/-1;
    font-size:min(calc((100vw - 56px) / 2.65),168px)}
  /* .zeus-coming-soon p{margin:0} (above) outranks a lone class, so the margin needs the parent in its selector */
  .zeus-coming-soon .zeus-lede{
    grid-row:2;
    grid-column:1/-1;
    align-self:start;
    margin-top:16px;
    max-width:min(100%,440px)}
  .zeus-actions{
    grid-row:3;
    grid-column:1/-1;
    width:100%;
    margin:24px 0 10px}
  .zeus-hero-foot{
    grid-row:4}
  .zeus-social{
    gap:8px}
  .zeus-seg{
    padding:8px 14px;
    gap:6px}
  /* the logo takes what is left of the row beside the four icons (200px with 8px gaps), between 80px and 135px wide */
  .zeus-hero-logo{
    grid-row:4}
  .zeus-coming-soon__logo{
    height:auto;
    width:clamp(80px,calc(100vw - 56px - 16px - 200px),135px)}
  .zeus-hero-shade{
    background:
      linear-gradient(180deg,#0b0b0cdd 0%,#0b0b0ccc 36%,#0b0b0c8c 50%,transparent 62%),
      linear-gradient(0deg,#0b0b0cf5 0%,#0b0b0ce6 20%,#0b0b0c88 32%,transparent 44%)}
}

/* Tablets: the action pill keeps its natural width instead of spanning the whole row. */
@media(min-width:561px) and (max-width:800px){
  .zeus-actions{
    justify-self:start;
    width:min(100%,420px)}
}

/* Under 352px the logo (80px minimum) no longer fits beside the four icons, so it sits on its own row below them. */
@media(max-width:351px){
  .zeus-hero{
    grid-template-rows:auto 1fr auto auto auto}
  .zeus-hero-logo{
    grid-row:5;
    grid-column:1;
    justify-self:start;
    margin-top:14px}
  .zeus-coming-soon__logo{
    width:100px}
}

@media(max-width:340px){
  .zeus-seg{
    padding:8px;
    font-size:.875rem}
  .zeus-seg svg{
    display:none}
  .zeus-hero{
    padding-left:24px;
    padding-right:24px}
  .zeus-coming-soon h1{
    font-size:calc((100vw - 48px) / 2.65)}
}

@media(prefers-reduced-motion:reduce){
  .zeus-seg,.zeus-social a{
  transition:none}
.zeus-actions{
  animation:none;
  --zeus-edge:20deg}
.zeus-hero-video{
  transition:none}
}

`;
