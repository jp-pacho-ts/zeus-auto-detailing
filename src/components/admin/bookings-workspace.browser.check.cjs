/* eslint-disable @typescript-eslint/no-require-imports */
// Source-app navigation regression on an owned synthetic loopback fixture only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {test}=require('node:test');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
test('Bookings contains customers/calendar/history; Bay board contains Kanban/setup; legacy and roles work', {timeout:180000},async()=>{
 const upstream=new URL(process.env.P120_BROWSER_ORIGIN),origin=new URL(process.env.P120_APP_ORIGIN).origin;
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(upstream.hostname));assert.equal(upstream.origin,process.env.P120_BROWSER_ORIGIN);assert.equal(upstream.username+upstream.password,'');
 const fx=JSON.parse(fs.readFileSync(process.env.P127_FIXTURE,'utf8')),out=process.env.P127_EVIDENCE;assert.ok(out);fs.mkdirSync(out,{recursive:true});
 const before=process.env.P127_BEFORE==='1',results={source:process.env.P127_SOURCE,mode:before?'before capture':'regression',checks:[],errors:[],widths:[]};
 const browser=await chromium.launch({headless:true,executablePath:process.env.P120_CHROME_EXECUTABLE});
 async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.route('**/*',async route=>{const req=route.request();if(!req.url().startsWith(origin+'/'))return route.abort();const response=await route.fetch({url:req.url().replace(origin,upstream.origin),headers:{...req.headers(),'x-forwarded-for':'198.51.100.137'},maxRedirects:0});await route.fulfill({response});});return ctx;}
 async function login(ctx,role){const p=await ctx.newPage();p.on('pageerror',e=>results.errors.push(e.message));await p.goto(origin+'/admin/login',{waitUntil:'networkidle'});await p.getByLabel('Staff Email or ID').fill(role==='ADMIN'?fx.adminEmail:fx.detailerEmail);await p.getByLabel('Password',{exact:true}).fill(role==='ADMIN'?fx.adminPassword:fx.detailerPassword);await p.getByRole('button',{name:/sign in/i}).click();await p.getByRole('heading',{name:'Bookings',exact:true}).waitFor();return p;}
 async function nav(p,name){const menu=p.locator('button[aria-controls=admin-nav]');if(await menu.isVisible()&&await menu.getAttribute('aria-expanded')==='false')await menu.click();await p.getByRole('navigation',{name:'Shop Operations Navigation'}).getByRole('button',{name,exact:true}).click();await p.getByRole('heading',{name,exact:true}).waitFor();}
 async function shot(p,name){await p.screenshot({path:path.join(out,name+'.png'),fullPage:true});}
 try{
  const ctx=await context(),p=await login(ctx,'ADMIN');const fixtureDay=fx.bookings[0].day;
  if(before){
   await p.getByLabel('Board day').waitFor();await p.getByLabel('Board day').fill(fixtureDay);await p.locator('section[aria-label$=" row"] article').first().waitFor();await shot(p,'1440-bookings-before');
   await nav(p,'Bay Calendar');await p.getByLabel('Queue day').waitFor();await p.getByLabel('Queue day').fill(fixtureDay);await p.getByRole('button',{name:fx.bookings[0].ref,exact:true}).waitFor();await p.getByText(/\d+ Bays Operating/).waitFor();await shot(p,'1440-calendar-day-list-before');
   await p.getByRole('group',{name:'Calendar sections'}).getByRole('button',{name:'Booking calendar',exact:true}).click();await p.getByRole('group',{name:'Calendar view'}).waitFor();await p.waitForFunction(()=>!document.body.textContent.includes('Loading shop data...'));await shot(p,'1440-calendar-before');
   await p.setViewportSize({width:390,height:900});await shot(p,'390-calendar-before');results.checks.push('fresh old-source captures of duplicate destinations and nested calendar');await ctx.close();return;
  }
  const views=p.getByRole('group',{name:'Bookings view'}),navigation=p.getByRole('navigation',{name:'Shop Operations Navigation'});
  assert.equal(await navigation.getByRole('button',{name:'Bay Calendar',exact:true}).count(),0);
  assert.equal(await navigation.getByRole('button',{name:'Bay board',exact:true}).count(),1);
  await p.getByLabel('Queue day').waitFor();assert.equal(await p.getByLabel('Board day').count(),0);
  assert.equal(await views.getByRole('button',{name:'Bookings',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await p.getByRole('heading',{name:'Customer booking history',exact:true}).count(),0);
  await p.getByLabel('Queue day').fill(fixtureDay);await p.getByRole('button',{name:fx.bookings[0].ref,exact:true}).waitFor();
  for(const [width,height]of [[390,900],[768,1000],[1280,900],[1440,1000]]){
   await p.setViewportSize({width,height});const overflow=await p.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,view:innerHeight}));assert.ok(overflow.scroll<=overflow.width);assert.ok(overflow.height<=overflow.view);results.widths.push({width,height,...overflow});await shot(p,width+'-bookings-after');
  }
  await views.getByRole('button',{name:'Calendar',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('group',{name:'Calendar view'}).waitFor();assert.equal(await p.evaluate(()=>document.activeElement.id),'bookings-view-CALENDAR');
  assert.equal(await p.getByRole('group',{name:'Bay board sections'}).count(),0);assert.equal(await p.getByLabel('Queue day').count(),0);
  await p.getByRole('button',{name:'Next month',exact:true}).click();await p.getByRole('button',{name:'Previous month',exact:true}).click();
  // The app localizes date labels; target its labelled date toggles rather than guessing an English date order.
  const dayButton=p.locator('button[aria-label][aria-pressed]').first();
  assert.match(await dayButton.getAttribute('aria-label'),/\d{4}/);
  await dayButton.click();await p.getByRole('region',{name:/^Bookings on /}).waitFor();await shot(p,'1440-calendar-after');
  await p.setViewportSize({width:390,height:900});await shot(p,'390-calendar-after');
  await views.getByRole('button',{name:'History',exact:true}).click();await p.getByRole('heading',{name:'Customer booking history',exact:true}).waitFor();assert.equal(await p.getByLabel('Queue day').count(),0);assert.equal(await p.getByRole('button',{name:'Search bookings',exact:true}).count(),0);assert.equal(await p.evaluate(()=>document.activeElement.id),'bookings-view-HISTORY');await shot(p,'390-history-after');
  await nav(p,'Bay board');await p.getByLabel('Board day').waitFor();assert.equal(await views.count(),0);await p.getByLabel('Board day').fill(fixtureDay);await p.locator('section[aria-label$=" row"] article').first().waitFor();
  await shot(p,'390-bay-board-after');await p.setViewportSize({width:1440,height:1000});await shot(p,'1440-bay-board-after');
  const sections=p.getByRole('group',{name:'Bay board sections'});await sections.getByRole('button',{name:'Bays',exact:true}).click();assert.equal(await p.evaluate(()=>document.activeElement.id),'bay-section-BAYS');await p.getByRole('heading',{name:'Add a bay',exact:true}).waitFor();await shot(p,'1440-bays-after');
  await sections.getByRole('button',{name:'Opening hours',exact:true}).click();await p.getByRole('heading',{name:/opening hours/i}).waitFor();assert.equal(await p.evaluate(()=>document.activeElement.id),'bay-section-HOURS');
  await p.goto(origin+'/admin/calendar',{waitUntil:'networkidle'});await p.getByRole('heading',{name:'Bookings',exact:true}).waitFor();await p.getByRole('group',{name:'Calendar view'}).waitFor();assert.equal(await p.locator('#bookings-view-CALENDAR').getAttribute('aria-pressed'),'true');
  await p.reload({waitUntil:'networkidle'});assert.equal(await p.locator('#bookings-view-CALENDAR').getAttribute('aria-pressed'),'true');
  results.checks.push('customer bookings/calendar/history separated from Bay board; keyboard focus, legacy calendar reload, bay/hour access');await ctx.close();
  const staffCtx=await context(),staff=await login(staffCtx,'DETAILER');assert.equal(await staff.getByRole('group',{name:'Bookings view'}).getByRole('button',{name:'History',exact:true}).count(),0);await nav(staff,'Bay board');await staff.getByLabel('Board day').waitFor();await staff.getByLabel('Board day').fill(fixtureDay);await staff.locator('section[aria-label$=" row"] article').first().waitFor();assert.equal(await staff.getByRole('group',{name:'Bay board sections'}).getByRole('button',{name:'Bays',exact:true}).count(),0);assert.equal(await staff.getByRole('button',{name:'Move car',exact:true}).count(),0);assert.equal(await staff.locator('article[draggable="true"]').count(),0);await staffCtx.close();results.checks.push('DETAILER retains read-only board, no private history/bay/hour/move controls');
  assert.deepEqual(results.errors,[]);
 }finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));await browser.close();}
});
