// usage: node shot.mjs <bundle> <outprefix> [keys...]   keys: "w:ms" wait, "t:text" type, "k:Enter" key
import { chromium } from 'playwright';
const [bundle, out, ...steps] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 960, height: 720 } })).newPage();
await page.goto(`http://localhost:8772/_dosref/index.html?b=${bundle}${process.env.Q || ""}`);
await page.waitForFunction(() => window.dci, null, { timeout: 60000 });
let n = 0;
const shot = async () => {
  const png = await page.evaluate(async () => { const d = await dci.screenshot(); const c = document.createElement('canvas'); c.width = d.width; c.height = d.height; c.getContext('2d').putImageData(d, 0, 0); return c.toDataURL().slice(22); });
  (await import('node:fs')).writeFileSync(`${out}_${String(n++).padStart(2, '0')}.png`, Buffer.from(png, 'base64'));
};
for (const s of steps) {
  const [op, arg] = [s[0], s.slice(2)];
  if (op === 'w') await sleep(+arg);
  else if (op === 's') await shot();
  else if (op === 't') await page.keyboard.type(arg, { delay: 80 });
  else if (op === 'k') await page.keyboard.press(arg);
}
await shot();
await browser.close();
