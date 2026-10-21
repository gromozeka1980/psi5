import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
const b = await chromium.launch(), p = await b.newPage();
await p.goto(pathToFileURL(process.argv[2]).href, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: process.argv[3], format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close(); console.log('ok');
