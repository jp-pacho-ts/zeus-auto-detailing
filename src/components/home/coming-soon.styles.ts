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

.zeus-home-header{
  height:100px;
  padding:0 5.55%;
  display:flex;
  justify-content:space-between;
  align-items:center;
  border-bottom:1px solid #ffffff24}
.zeus-coming-soon__logo{
  width:170px;
  height:auto;
  display:block}
.zeus-home-header>div{
  display:flex;
  align-items:center;
  gap:44px;
  font-size:.75rem;
  font-weight:600}
.zeus-home-city{
  color:#b0aaa1}
.zeus-home-header a{
  min-height:44px;
  display:flex;
  align-items:center;
  gap:18px}
.zeus-home-header>div>a{
  border-bottom:1px solid var(--gold)}

.zeus-hero{
  position:relative;
  isolation:isolate;
  min-height:690px;
  overflow:hidden}
.zeus-hero-photo{
  position:absolute;
  inset:0 0 0 29%;
  z-index:-2}
.zeus-hero-photo img{
  object-fit:cover;
  object-position:47% 55%;
  filter:contrast(1.1) saturate(.6) brightness(.83)}
.zeus-hero-photo:after{
  content:'';
  position:absolute;
  inset:0;
  background:linear-gradient(90deg,#0b0b0c 0%,#0b0b0cdb 10%,#0b0b0c60 35%,transparent 70%),linear-gradient(0deg,#0b0b0ce5,transparent 25%)}

.zeus-hero-copy{
  padding:42px 5.55% 55px;
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
  color:#d7b472}
.zeus-kicker:before{
  content:'';
  height:2px;
  width:32px;
  background:var(--gold)}
.zeus-pretitle{
  margin:45px 0 23px!important;
  font-size:.75rem;
  letter-spacing:.13em;
  color:#bcb5ab;
  text-transform:uppercase}

.zeus-coming-soon h1{
  font-family:ZeusDisplay,Impact,sans-serif;
  font-size:clamp(120px,13.4vw,200px);
  font-weight:800;
  line-height:.77;
  letter-spacing:-.035em;
  text-transform:uppercase;
  margin:0 0 40px}
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
  color:#bcb5ab}
.zeus-description p:first-child{
  flex:0 0 245px;
  color:var(--paper)}
.zeus-actions{
  display:flex;
  gap:27px;
  align-items:center;
  flex-wrap:wrap;
  margin-top:28px}
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
.zeus-photo-caption{
  position:absolute;
  right:5.55%;
  top:30px;
  color:#c0beb9;
  font-size:.6875rem;
  letter-spacing:.08em}
.zeus-craft{
  position:absolute;
  right:5.55%;
  bottom:30px;
  width:280px;
  margin:0}
.zeus-craft img{
  width:100%;
  height:158px;
  object-fit:cover;
  filter:saturate(.58) contrast(1.15)}
.zeus-craft figcaption{
  font-size:.6875rem;
  margin-top:10px;
  color:#d4cec3;
  display:flex;
  justify-content:space-between;
  gap:15px}
.zeus-craft figcaption span{
  color:#d2aa61}

.zeus-contact-band{
  background:var(--gold);
  color:var(--ink);
  padding:28px 5.55%;
  display:grid;
  grid-template-columns:1.3fr 1fr .65fr;
  gap:30px;
  align-items:center}
.zeus-contact-band>div{
  display:flex;
  flex-direction:column;
  gap:10px}
.zeus-contact-band span,.zeus-contact-band p{
  font-size:.75rem}
.zeus-contact-band a{
  font-size:.875rem;
  font-weight:700;
  min-height:30px;
  display:flex;
  align-items:center}
.zeus-contact-band strong{
  font-family:ZeusDisplay,Impact,sans-serif;
  text-transform:uppercase;
  font-size:1.25rem}
.zeus-coming-soon__footer{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
  padding:15px 5.55%;
  font-size:.6875rem;
  color:#aaa49b}
.zeus-coming-soon__footer a{
  padding-block:10px}

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

@media(min-width:1600px){
  .zeus-hero{
  min-height:760px}
.zeus-hero-copy{
  padding-top:60px}
.zeus-craft{
  width:320px}
}

@media(max-width:1100px){
  .zeus-description{
  flex-direction:column;
  gap:8px;
  max-width:365px}
.zeus-description p:first-child{
  flex:auto}
.zeus-craft{
  width:225px}
.zeus-photo-caption{
  font-size:.625rem}
.zeus-hero{
  min-height:730px}
}

@media(max-width:800px){
  .zeus-home-header{
  height:87px;
  padding:0 5%}
.zeus-coming-soon__logo{
  width:138px}
.zeus-home-city{
  display:none}
.zeus-home-header>div{
  font-size:.75rem}
.zeus-hero{
  min-height:1010px}
.zeus-hero-photo{
  inset:0 0 30%}
.zeus-hero-photo img{
  object-position:55% center}
.zeus-hero-photo:after{
  background:linear-gradient(0deg,#0b0b0c 0%,#0b0b0cee 20%,#0b0b0c40 85%)}
.zeus-hero-copy{
  padding:245px 5% 195px;
  max-width:650px}
.zeus-pretitle{
  margin-top:35px!important}
.zeus-coming-soon h1{
  font-size:clamp(100px,22vw,170px);
  margin-bottom:32px}
.zeus-photo-caption{
  right:5%;
  top:22px;
  left:5%;
  text-align:right}
.zeus-craft{
  width:180px;
  right:5%;
  bottom:24px}
.zeus-craft img{
  height:100px}
.zeus-craft figcaption{
  flex-direction:column;
  gap:4px}
.zeus-contact-band{
  grid-template-columns:1fr 1fr;
  padding:28px 5%;
  gap:24px}
.zeus-contact-band>div:nth-child(2){
  grid-row:2;
  grid-column:1/-1}
.zeus-coming-soon__footer{
  flex-wrap:wrap;
  padding:15px 5%}
.zeus-coming-soon__footer>span:nth-child(2){
  display:none}
}

@media(max-width:380px){
  .zeus-home-header>div>a{
  gap:5px}
.zeus-coming-soon__logo{
  width:115px}
.zeus-hero-copy{
  padding-top:220px}
.zeus-hero{
  min-height:1120px}
}

@media(prefers-reduced-motion:reduce){
  .zeus-actions a{
  transition:none}
}

`;
