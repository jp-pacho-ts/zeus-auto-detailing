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

/* Full-screen hero: the video (over its poster) is the background, the logo sits centered at the top and the
   notice and actions are an overlay at the bottom. No header or footer bars. */
.zeus-hero{
  position:relative;
  isolation:isolate;
  min-height:100svh;
  overflow:hidden;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  align-items:stretch}
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
  object-position:50% 55%;
  filter:contrast(1.05) saturate(.85) brightness(.95)}
.zeus-hero-video{
  opacity:0;
  transition:opacity .8s ease}
.zeus-hero-video[data-ready=true]{
  opacity:1}
/* The shade keeps text readable over a bright, moving picture: an even tint, a strong left and bottom fade where the
   copy sits, and a soft top fade behind the logo. */
.zeus-hero-shade{
  position:absolute;
  inset:0;
  z-index:-2;
  background:
    linear-gradient(180deg,#0b0b0c99 0%,#0b0b0c40 18%,transparent 34%),
    linear-gradient(0deg,#0b0b0cf0 0%,#0b0b0ccc 30%,#0b0b0c60 58%,transparent 80%),
    linear-gradient(90deg,#0b0b0ce6 0%,#0b0b0cb0 38%,#0b0b0c40 65%,transparent 85%)}

.zeus-hero-logo{
  padding:36px 5.55% 0;
  display:flex;
  justify-content:center}
.zeus-coming-soon__logo{
  width:280px;
  height:auto;
  display:block}

.zeus-hero-copy{
  padding:32px 5.55% 44px;
  position:relative;
  z-index:1;
  max-width:950px}
.zeus-kicker{
  display:flex;
  align-items:center;
  gap:17px;
  font-size:.75rem;
  font-weight:700;
  letter-spacing:.14em;
  color:#e1c183}
.zeus-kicker:before{
  content:'';
  height:2px;
  width:32px;
  background:var(--gold)}
.zeus-pretitle{
  margin:24px 0 16px!important;
  font-size:.75rem;
  letter-spacing:.13em;
  color:#d6d0c6;
  text-transform:uppercase}

.zeus-coming-soon h1{
  font-family:ZeusDisplay,Impact,sans-serif;
  font-size:clamp(88px,min(13.4vw,20svh),200px);
  font-weight:800;
  line-height:.77;
  letter-spacing:-.035em;
  text-transform:uppercase;
  margin:0 0 32px}
.zeus-coming-soon h1 span{
  color:var(--gold)}
.zeus-description{
  display:flex;
  gap:30px;
  max-width:620px}
.zeus-description p{
  font-size:.875rem;
  line-height:1.8;
  max-width:310px;
  color:#d6d0c6}
.zeus-description p:first-child{
  flex:0 0 245px;
  color:var(--paper)}
.zeus-actions{
  display:flex;
  gap:27px;
  align-items:center;
  flex-wrap:wrap;
  margin-top:24px}
.zeus-coming-soon__call{
  background:var(--gold);
  color:var(--ink)!important;
  min-height:70px;
  min-width:235px;
  padding:14px 23px;
  display:flex;
  flex-direction:column;
  gap:5px}
.zeus-coming-soon__call span{
  font-size:.75rem;
  font-weight:700}
.zeus-coming-soon__call strong{
  font-size:1rem}
.zeus-facebook{
  display:flex;
  gap:12px;
  align-items:center;
  font-size:.8125rem;
  min-height:44px}
.zeus-actions a{
  transition:transform .2s,background .2s}
.zeus-actions a:hover{
  transform:translateY(-2px)}
.zeus-coming-soon__call:hover{
  background:#e1ab47}
.zeus-contact-line{
  margin-top:18px!important;
  font-size:.8125rem;
  color:#d6d0c6;
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:0 6px}
.zeus-contact-line a{
  min-height:44px;
  display:inline-flex;
  align-items:center;
  border-bottom:1px solid transparent}
.zeus-contact-line a:hover{
  border-bottom-color:var(--gold)}

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

@media(max-width:1100px){
  .zeus-description{
  flex-direction:column;
  gap:8px;
  max-width:365px}
.zeus-description p:first-child{
  flex:auto}
}

@media(max-width:800px){
  .zeus-hero-logo{
  padding:28px 5% 0}
.zeus-coming-soon__logo{
  width:200px}
.zeus-hero-copy{
  padding:28px 5% 32px;
  max-width:650px}
.zeus-pretitle{
  margin-top:20px!important}
.zeus-coming-soon h1{
  font-size:clamp(88px,22vw,170px);
  margin-bottom:26px}
.zeus-hero-shade{
  background:
    linear-gradient(180deg,#0b0b0cb0 0%,#0b0b0c50 18%,transparent 32%),
    linear-gradient(0deg,#0b0b0cf5 0%,#0b0b0ce6 45%,#0b0b0cb0 70%,#0b0b0c55 100%)}
}

@media(max-width:380px){
  .zeus-coming-soon__logo{
  width:170px}
}

@media(prefers-reduced-motion:reduce){
  .zeus-actions a{
  transition:none}
.zeus-hero-video{
  transition:none}
}

`;
