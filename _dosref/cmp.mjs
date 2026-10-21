// Compare DOSBox (js-dos) vs tools/emu on static screens. node cmp.mjs <name> step...
// steps: w:ms (real ms for DOS, virtual for emu), k:Key (Playwright name; emu gets the same key), t:text, c (compare)
import { chromium } from 'playwright'; import fs from 'node:fs';
import { boot, KEYS } from '../tools/emu/run.mjs'; import { CGA_RGB } from '../tools/emu/pc.js'; import { PNG } from './png.mjs';
const [name, ...steps] = process.argv.slice(2); fs.mkdirSync('cmp', { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 } })).newPage();
await page.goto(`http://localhost:8772/_dosref/index.html?b=${process.env.B || 'psi5'}`);
await page.waitForFunction(() => window.dci, null, { timeout: 60000 });
const { pc, run } = boot();
const near = (r, g, b) => { let best = 0, bd = 1e9; CGA_RGB.forEach((p, k) => { const q = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (q < bd) { bd = q; best = k; } }); return best; };
let n = 0, bad = 0;
const EK = { Enter: 'Enter', Escape: 'Esc', Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
for (const s of steps) { console.log("step", s, Date.now() % 100000);
  const op = s[0], arg = s.slice(2);
  if (op === 'w') { await sleep(+arg); run(+arg); }
  else if (op === 'k') { await page.keyboard.press(arg); const k = KEYS[EK[arg]] || [arg.charCodeAt(0), 0]; pc.key(k[0], k[1]); await sleep(100); run(100); }
  else if (op === 't') { for (const ch of arg) { await page.keyboard.type(ch); pc.key(ch.charCodeAt(0), 0); await sleep(100); run(100); } }
  else if (op === 'c') {
    const d = await page.evaluate(async () => { const s = await dci.screenshot(); return { w: s.width, h: s.height, d: Array.from(s.data) }; });
    const sx = d.w / 320, sy = d.h / 200, e = pc.frame(); let cnt = 0; const rgba = new Uint8Array(64000 * 4);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const i = (Math.floor(y * sy) * d.w + Math.floor(x * sx)) * 4, k = near(d.d[i], d.d[i + 1], d.d[i + 2]), j = y * 320 + x;
      const diff = k !== e[j]; cnt += diff; const p = diff ? [255, 0, 0] : CGA_RGB[k].map(v => v >> 2); rgba.set([...p, 255], j * 4);
    }
    const tag = `${name}_${String(n++).padStart(2, '0')}`;
    fs.writeFileSync(`cmp/${tag}_dos.png`, PNG.encode(320, 200, rgba)); if (cnt) bad++;
    console.log(`${tag} (${d.w}x${d.h}): ${cnt ? cnt + ' px differ' : 'identical'}`);
  }
}
await browser.close(); process.exit(bad ? 1 : 0);
