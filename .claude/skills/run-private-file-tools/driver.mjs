/**
 * Driver for private-file-tools.
 *
 * Usage:
 *   node .claude/skills/run-private-file-tools/driver.mjs [--port 4321] [--out ./screenshots]
 *
 * Commands (passed after --):
 *   screenshot <slug>   Take a full-page screenshot of /<slug> (or / for home)
 *   smoke               Screenshot every page, report any JS errors
 *   interact <slug> <action>
 *                       Run a named interaction on a page (see INTERACTIONS below)
 *
 * The dev server must be running first:
 *   npm run dev -- --port 4321
 *
 * Screenshots land in --out (default: .claude/skills/run-private-file-tools/screenshots/).
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

// --- CLI arg parsing ---
const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx !== -1 ? args[portIdx + 1] : '4321';
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? args[outIdx + 1] : path.join(__dir, 'screenshots');
const cmdIdx = args.indexOf('--');
const [command, ...cmdArgs] = cmdIdx !== -1 ? args.slice(cmdIdx + 1) : ['smoke'];

const BASE = `http://localhost:${PORT}`;

fs.mkdirSync(OUT, { recursive: true });

// --- Named interactions ---
const INTERACTIONS = {
  /** Switch the encrypt tool to Decrypt mode and back */
  'encrypt-mode-switch': async (page) => {
    await page.locator('#card-decrypt').click();
    await page.waitForTimeout(300);
    const decryptVisible = await page.locator('#decrypt-zone').isVisible();
    console.log(`  decrypt-zone visible: ${decryptVisible}`);
    await page.locator('#card-encrypt').click();
    await page.waitForTimeout(200);
    console.log(`  switched back to encrypt mode`);
  },
  /** Toggle password visibility on the encrypt page */
  'encrypt-pw-toggle': async (page) => {
    const pw = page.locator('#password-input');
    await pw.fill('hunter2');
    const before = await pw.getAttribute('type');
    await page.locator('#password-toggle').click();
    const after = await pw.getAttribute('type');
    console.log(`  password field: ${before} → ${after}`);
  },
  /** Switch Compress PDF to Rasterize mode */
  'pdf-rasterize': async (page) => {
    await page.locator('#card-rasterize').click();
    await page.waitForTimeout(200);
    const warning = await page.locator('text=Text will not be selectable').isVisible();
    console.log(`  rasterize warning visible: ${warning}`);
  },
};

// --- Helpers ---
async function screenshot(page, slug) {
  const url = `${BASE}/${slug === '/' || slug === '' ? '' : slug}`;
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(e.message));
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(400);
  const name = (slug === '/' || slug === '') ? 'home' : slug.replace(/\//g, '-');
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return { url, status: res.status(), jsErrors, file };
}

// --- Commands ---
async function runSmoke(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const pages = ['/', 'heic-to-jpg', 'remove-photo-metadata', 'compress-pdf', 'encrypt-file', 'about', 'privacy'];
  let allOk = true;
  for (const slug of pages) {
    const r = await screenshot(page, slug);
    const ok = r.status === 200 && r.jsErrors.length === 0;
    if (!ok) allOk = false;
    console.log(`${ok ? '✅' : '❌'} /${slug === '/' ? '' : slug} → HTTP ${r.status}${r.jsErrors.length ? ' JS_ERRORS: ' + r.jsErrors.join('; ') : ''}`);
    console.log(`   screenshot: ${r.file}`);
  }
  await ctx.close();
  return allOk;
}

async function runScreenshot(browser, slug) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const r = await screenshot(page, slug);
  console.log(`HTTP ${r.status} → ${r.file}`);
  if (r.jsErrors.length) console.log('JS errors:', r.jsErrors);
  await ctx.close();
}

async function runInteract(browser, slug, action) {
  if (!INTERACTIONS[action]) {
    console.error(`Unknown action: ${action}`);
    console.error(`Available: ${Object.keys(INTERACTIONS).join(', ')}`);
    process.exit(1);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await INTERACTIONS[action](page);
  const file = path.join(OUT, `interact-${action}.png`);
  await page.screenshot({ path: file });
  console.log(`screenshot: ${file}`);
  await ctx.close();
}

// --- Main ---
const browser = await chromium.launch({ headless: true });

try {
  if (command === 'smoke') {
    const ok = await runSmoke(browser);
    process.exitCode = ok ? 0 : 1;
  } else if (command === 'screenshot') {
    await runScreenshot(browser, cmdArgs[0] ?? '/');
  } else if (command === 'interact') {
    await runInteract(browser, cmdArgs[0], cmdArgs[1]);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
