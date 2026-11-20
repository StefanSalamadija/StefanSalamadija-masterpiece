// Builds Etsy listing images (2400x1800, 4:3) from the preview PNGs.
// Run after build.cjs: node mockups.cjs
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const P = path.join(__dirname, '..', 'preview');
const OUT = path.join(__dirname, '..', 'listing-images');
const img = f => 'data:image/png;base64,' + fs.readFileSync(path.join(P, f)).toString('base64');
const FONT = 'data:font/woff2;base64,' + fs.readFileSync(path.join(__dirname, 'fredoka.woff2')).toString('base64');

const base = `
@font-face { font-family: 'Fredoka'; src: url(${FONT}) format('woff2'); font-weight: 300 700; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { width: 2400px; height: 1800px; overflow: hidden; font-family: 'Fredoka'; color: #1d3557;
  background: radial-gradient(circle at 75% 40%, #fdf6ec, #f3e6d3); position: relative; }
.sheet { position: absolute; background: #fff; box-shadow: 0 30px 60px rgba(29,53,87,.22), 0 6px 14px rgba(29,53,87,.12); }
.sheet img { display: block; width: 100%; }
h1 { font-size: 120px; line-height: 1.02; font-weight: 700; letter-spacing: -1px; }
.tag { display: inline-block; background: #e76f51; color: #fff; border-radius: 60px; padding: 14px 40px; font-size: 44px; font-weight: 600; }
ul { list-style: none; font-size: 52px; font-weight: 500; line-height: 1.75; }
li::before { content: '\\2713'; color: #2a9d8f; font-weight: 700; margin-right: 22px; }
`;

const hero = `
<div style="position:absolute;left:130px;top:230px;width:1000px">
  <div class="tag">Printable &middot; Instant download</div>
  <h1 style="margin:50px 0 30px">Days Until<br>Dad Comes Home</h1>
  <p style="font-size:54px;color:#457b9d;font-weight:500;margin-bottom:50px">A countdown chart for seafarer &amp; travelling families</p>
  <ul>
    <li>9 lengths: 30 to 270 days</li>
    <li>Dad, Mom &amp; Mum versions</li>
    <li>A4 + US Letter, 27 pages each</li>
  </ul>
</div>
<div class="sheet" style="left:1300px;top:110px;width:1000px;transform:rotate(3deg)"><img src="${img('Dad-90.png')}"></div>`;

const fan = `
<div style="position:absolute;top:90px;width:100%;text-align:center">
  <h1 style="font-size:104px">Every contract length included</h1>
  <p style="font-size:54px;color:#457b9d;font-weight:500;margin-top:20px">Print the one you need. Start colouring at your number.</p>
</div>
<div class="sheet" style="left:230px;top:470px;width:700px;transform:rotate(-6deg)"><img src="${img('Dad-30.png')}"></div>
<div class="sheet" style="left:1470px;top:470px;width:700px;transform:rotate(6deg)"><img src="${img('Dad-270.png')}"></div>
<div class="sheet" style="left:850px;top:420px;width:700px;z-index:2"><img src="${img('Mom-180.png')}"></div>
<div style="position:absolute;left:0;right:0;bottom:90px;text-align:center;z-index:3">
  <span class="tag" style="font-size:52px;padding:20px 60px;box-shadow:0 10px 30px rgba(0,0,0,.15)">30 &middot; 60 &middot; 90 &middot; 120 &middot; 150 &middot; 180 &middot; 210 &middot; 240 &middot; 270 days</span>
</div>`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 2400, height: 1800 } });
  for (const [name, body] of [['01-hero', hero], ['02-all-lengths', fan]]) {
    await pg.setContent(`<!doctype html><html><head><style>${base}</style></head><body>${body}</body></html>`);
    await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: path.join(OUT, name + '.png') });
  }
  await b.close();
  console.log('done');
})();
