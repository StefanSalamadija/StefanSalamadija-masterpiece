// Builds the "Days Until ___ Comes Home" printable countdown charts.
// Output: one PDF per paper size (A4, US Letter), every parent x every length,
// plus PNG previews for checking and for Etsy listing images.
//
// Run: node build.cjs

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'output');
const PREVIEW = path.join(__dirname, '..', 'preview');
const FONT = 'data:font/woff2;base64,' + fs.readFileSync(path.join(__dirname, 'fredoka.woff2')).toString('base64');

const PARENTS = ['Dad', 'Mom', 'Mum'];
const LENGTHS = [30, 60, 90, 120, 150, 180, 210, 240, 270];
const SIZES = {
  A4: { w: 210, h: 297, grid: 150 },
  Letter: { w: 215.9, h: 279.4, grid: 133 },
};

const C = {
  navy: '#1d3557', sea: '#48b5d8', seaLight: '#bfe6f2', seaPale: '#e3f4fa',
  coral: '#e76f51', red: '#e63946', sun: '#ffd166', orange: '#f4a261',
  teal: '#2a9d8f', steel: '#457b9d', mustard: '#e9c46a', sand: '#f6e2b8', green: '#8cc66d',
};

// ---------- artwork (all original SVG) ----------

function wavePath(y, amp, len, width, height) {
  let d = `M0,${y}`;
  for (let x = 0; x < width; x += len) {
    d += ` q${len / 4},${-amp} ${len / 2},0 t${len / 2},0`;
  }
  return d + ` L${width},${height} L0,${height} Z`;
}

function ship(x, y) {
  // container ship heading right; (x,y) = left end of deck line
  const colors = [C.coral, C.teal, C.orange, C.steel, C.mustard];
  const tiers = [3, 3, 2, 3, 2, 3, 3, 2];
  let boxes = '';
  tiers.forEach((t, i) => {
    for (let j = 0; j < t; j++) {
      const col = colors[(i * 2 + j) % colors.length];
      boxes += `<rect x="${x + 36 + i * 13}" y="${y - 7 - j * 7}" width="13" height="7" fill="${col}" stroke="#fff" stroke-width="0.7"/>`;
    }
  });
  return `
  <g>
    <rect x="${x + 14}" y="${y - 38}" width="10" height="11" fill="${C.coral}"/>
    <rect x="${x + 14}" y="${y - 38}" width="10" height="3" fill="${C.navy}"/>
    <rect x="${x + 6}" y="${y - 27}" width="26" height="27" fill="#fff" stroke="${C.navy}" stroke-width="1.2"/>
    <rect x="${x + 2}" y="${y - 28}" width="34" height="5" rx="1" fill="#fff" stroke="${C.navy}" stroke-width="1.2"/>
    ${[0, 1, 2, 3].map(i => `<rect x="${x + 8 + i * 6}" y="${y - 21}" width="4" height="3" fill="${C.navy}"/>`).join('')}
    ${[0, 1, 2, 3].map(i => `<rect x="${x + 8 + i * 6}" y="${y - 13}" width="4" height="3" fill="${C.seaLight}"/>`).join('')}
    ${boxes}
    <line x1="${x + 146}" y1="${y}" x2="${x + 146}" y2="${y - 16}" stroke="${C.navy}" stroke-width="1.4"/>
    <path d="M${x},${y} L${x + 150},${y} L${x + 160},${y - 5} L${x + 148},${y + 22} L${x + 8},${y + 22} L${x},${y + 8} Z" fill="${C.navy}"/>
    <path d="M${x + 3},${y + 15} L${x + 151},${y + 15} L${x + 148},${y + 22} L${x + 8},${y + 22} Z" fill="${C.red}"/>
    <circle cx="${x + 140}" cy="${y + 6}" r="2.2" fill="none" stroke="#fff" stroke-width="1"/>
  </g>`;
}

function house(x, y) {
  // (x,y) = bottom-left of walls
  return `
  <g>
    <rect x="${x}" y="${y - 22}" width="30" height="22" fill="#fff" stroke="${C.navy}" stroke-width="1.3"/>
    <path d="M${x - 5},${y - 21} L${x + 15},${y - 37} L${x + 35},${y - 21} Z" fill="${C.red}" stroke="${C.navy}" stroke-width="1.3" stroke-linejoin="round"/>
    <rect x="${x + 22}" y="${y - 36}" width="5" height="9" fill="${C.navy}"/>
    <rect x="${x + 12}" y="${y - 13}" width="7" height="13" fill="${C.orange}" stroke="${C.navy}" stroke-width="1"/>
    <rect x="${x + 3}" y="${y - 17}" width="6" height="6" fill="${C.seaLight}" stroke="${C.navy}" stroke-width="1"/>
    <rect x="${x + 22}" y="${y - 17}" width="5" height="6" fill="${C.seaLight}" stroke="${C.navy}" stroke-width="1"/>
    ${heart(x + 15, y - 50, 1.1)}
  </g>`;
}

function heart(cx, cy, s) {
  return `<path transform="translate(${cx},${cy}) scale(${s})" d="M0,6 C-9,-1 -6,-9 0,-4 C6,-9 9,-1 0,6 Z" fill="${C.coral}"/>`;
}

function scene() {
  const W = 380, H = 100;
  return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">
    <path d="M285,78 Q322,36 380,40 L380,100 L285,100 Z" fill="${C.green}"/>
    <path d="M270,84 Q300,66 380,70 L380,100 L270,100 Z" fill="${C.sand}"/>
    <g transform="translate(372,44)">
      <path d="M0,0 Q-2,-14 1,-26" stroke="#8a5a3b" stroke-width="2.2" fill="none"/>
      <path d="M1,-26 q-10,-2 -14,6 M1,-26 q10,-3 13,5 M1,-26 q-4,-8 -12,-8 M1,-26 q5,-8 12,-6" stroke="${C.teal}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </g>
    ${house(320, 62)}
    <path d="M200,60 C235,50 255,72 300,68" stroke="${C.coral}" stroke-width="1.6" stroke-dasharray="3 3.5" fill="none" stroke-linecap="round"/>
    ${ship(40, 54)}
    <path d="${wavePath(76, 3, 20, W, H)}" fill="${C.seaLight}"/>
    <path d="${wavePath(84, 3, 26, W, H)}" fill="${C.sea}" opacity="0.55"/>
    <path d="M230,30 q3,-3 6,0 q3,-3 6,0 M250,22 q2.5,-2.5 5,0 q2.5,-2.5 5,0" stroke="${C.navy}" stroke-width="1.1" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function header(parent, n) {
  return `
  <div class="sky">
    <svg class="sky-art" viewBox="0 0 380 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(345,26)">
        ${Array.from({ length: 10 }, (_, i) => `<line x1="0" y1="-17" x2="0" y2="-23" stroke="${C.sun}" stroke-width="2.4" stroke-linecap="round" transform="rotate(${i * 36})"/>`).join('')}
        <circle r="13" fill="${C.sun}"/>
      </g>
      <g fill="#fff">
        <ellipse cx="38" cy="22" rx="18" ry="7"/><ellipse cx="50" cy="17" rx="11" ry="8"/>
        <ellipse cx="300" cy="72" rx="15" ry="5"/><ellipse cx="309" cy="68" rx="9" ry="6"/>
      </g>
    </svg>
    <div class="title">
      <div class="t-small">Days until</div>
      <div class="t-big">${parent} Comes Home</div>
      <div class="t-sub">${n}-day countdown</div>
    </div>
  </div>
  <div class="fill">
    <span>My name: <i></i></span>
    <span>${parent} comes home on: <i></i></span>
  </div>`;
}

function chooseGrid(cells, W, H, gap) {
  let best = null;
  for (let cols = 3; cols <= 30; cols++) {
    const rows = Math.ceil(cells / cols);
    const size = Math.min((W - gap * (cols - 1)) / cols, (H - gap * (rows - 1)) / rows);
    const empty = rows * cols - cells;
    const score = size - empty * 0.02;
    if (!best || score > best.score) best = { cols, rows, size, score };
  }
  return best;
}

function grid(n, W, H) {
  const gap = n > 150 ? 1.2 : 1.8;
  const cells = n + 1;
  const g = chooseGrid(cells, W, H, gap);
  const s = g.size;
  let html = '';
  for (let d = n; d >= 1; d--) {
    const ten = d % 10 === 0;
    html += `<div class="cell${ten ? ' ten' : ''}${d === 1 ? ' last' : ''}"><span>${d}</span></div>`;
  }
  html += `<div class="cell home"><svg viewBox="-20 -22 40 40"><path d="M-12,-2 L0,-13 L12,-2 Z" fill="${C.red}"/><rect x="-9" y="-2" width="18" height="13" fill="#fff" stroke="${C.navy}" stroke-width="1.6"/><rect x="-2.5" y="4" width="5" height="7" fill="${C.orange}"/></svg></div>`;
  return `<div class="grid" style="
      grid-template-columns: repeat(${g.cols}, ${s}mm);
      grid-auto-rows: ${s}mm; gap: ${gap}mm;
      --s: ${s}mm;">${html}</div>`;
}

function page(parent, n, size) {
  const { w, h, grid: gridH } = SIZES[size];
  const innerW = w - 20;
  return `
  <section class="page" style="width:${w}mm;height:${h}mm">
    ${header(parent, n)}
    <div class="grid-wrap" style="height:${gridH}mm">${grid(n, innerW, gridH)}</div>
    <div class="howto">Colour one box every day, starting at your number. When every box is coloured&hellip; ${parent} is home! ${'♥'}</div>
    <div class="scene">${scene()}</div>
  </section>`;
}

const CSS = `
@font-face { font-family: 'Fredoka'; src: url(${FONT}) format('woff2'); font-weight: 300 700; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: 'Fredoka', sans-serif; color: ${C.navy}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; overflow: hidden; padding: 10mm 10mm 0; display: flex; flex-direction: column; page-break-after: always; break-after: page; }
.sky { position: relative; height: 44mm; border-radius: 6mm; background: ${C.seaPale}; overflow: hidden; flex: none; }
.sky-art { position: absolute; inset: 0; width: 100%; height: 100%; }
.title { position: relative; text-align: center; padding-top: 6mm; }
.t-small { font-size: 7mm; font-weight: 500; color: ${C.steel}; line-height: 1; }
.t-big { font-size: 15mm; font-weight: 700; line-height: 1.05; letter-spacing: -0.2mm; }
.t-sub { display: inline-block; margin-top: 1.5mm; padding: 0.6mm 4mm; border-radius: 10mm; background: ${C.coral}; color: #fff; font-size: 4.2mm; font-weight: 600; letter-spacing: 0.3mm; text-transform: uppercase; }
.fill { display: flex; justify-content: space-between; gap: 8mm; margin: 5mm 2mm 4mm; font-size: 4.6mm; font-weight: 500; flex: none; }
.fill span { display: flex; flex: 1; align-items: flex-end; gap: 2mm; white-space: nowrap; }
.fill i { flex: 1; border-bottom: 0.4mm solid ${C.navy}; height: 4mm; }
.grid-wrap { display: flex; align-items: center; justify-content: center; flex: none; }
.grid { display: grid; justify-content: center; }
.cell { border: 0.45mm solid ${C.steel}; border-radius: calc(var(--s) * 0.28); display: flex; align-items: center; justify-content: center; background: #fff; }
.cell span { font-size: calc(var(--s) * 0.4); font-weight: 600; color: ${C.steel}; opacity: 0.85; }
.cell.ten { border-color: ${C.coral}; border-width: 0.6mm; }
.cell.ten span { color: ${C.coral}; opacity: 1; }
.cell.last { border-color: ${C.teal}; border-width: 0.6mm; }
.cell.home { border: 0.6mm dashed ${C.red}; background: #fff4f2; }
.cell.home svg { width: 82%; height: 82%; }
.howto { text-align: center; font-size: 4.3mm; font-weight: 500; margin-top: 3.5mm; color: ${C.steel}; flex: none; }
.scene { flex: 1; display: flex; align-items: flex-end; margin: 0 -10mm; min-height: 0; }
.scene svg { width: 100%; height: 100%; display: block; }
`;

function doc(pages) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${pages}</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(PREVIEW, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 2 });

  for (const size of Object.keys(SIZES)) {
    const { w, h } = SIZES[size];
    const pages = PARENTS.flatMap(p => LENGTHS.map(n => page(p, n, size))).join('');
    const pg = await ctx.newPage();
    await pg.setContent(doc(pages), { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.pdf({ path: path.join(OUT, `Days-Until-Home-Countdown-${size}.pdf`), width: `${w}mm`, height: `${h}mm`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    await pg.close();
  }

  // PNG previews of selected pages (A4)
  const picks = [['Dad', 30], ['Dad', 90], ['Mom', 180], ['Dad', 270]];
  for (const [p, n] of picks) {
    const pg = await ctx.newPage();
    const pxW = Math.round(210 / 25.4 * 96), pxH = Math.round(297 / 25.4 * 96);
    await pg.setViewportSize({ width: pxW, height: pxH });
    await pg.setContent(doc(page(p, n, 'A4')), { waitUntil: 'load' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.screenshot({ path: path.join(PREVIEW, `${p}-${n}.png`), clip: { x: 0, y: 0, width: pxW, height: pxH } });
    await pg.close();
  }
  await browser.close();
  console.log('done');
})();
