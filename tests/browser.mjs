// Browser smoke tests. They load the app in a real browser and fail on any
// console error, page error or failed request.
//
//   npm install --no-save puppeteer-core
//   node tests/browser.mjs
//
// The browser binary is expected in the puppeteer cache. Override the URL with
// BASE=http://localhost:8080.

import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:8080';
const problems = [];

function findChrome() {
  const cache = path.join(os.homedir(), '.cache/puppeteer/chrome');
  if (!fs.existsSync(cache)) {
    console.error('No hay binario de Chrome en el cache de puppeteer.');
    console.error('Instálalo con:  npx puppeteer browsers install chrome');
    process.exit(2);
  }
  const dir = fs.readdirSync(cache).sort().pop();
  return path.join(cache, dir, 'chrome-linux64', 'chrome');
}

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pushops-smoke-')),
  protocolTimeout: 60000,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

page.on('console', (msg) => {
  if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
});
page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
page.on('response', (res) => {
  if (res.url().startsWith(BASE) && res.status() >= 400 && !res.url().includes('favicon')) {
    problems.push(`HTTP ${res.status()}: ${res.url().replace(BASE, '')}`);
  }
});

/* ------------------------------ vistas ------------------------------ */

console.log(`→ cargando ${BASE}`);
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 45000 });
await new Promise((r) => setTimeout(r, 2500));

for (const view of ['counter', 'stats', 'friends', 'groups', 'profile']) {
  await page.evaluate((v) => { location.hash = `#/${v}`; }, view);
  await new Promise((r) => setTimeout(r, 1400));
  const children = await page.evaluate(
    () => document.getElementById('view')?.children.length ?? 0,
  );
  console.log(`→ #/${view}: ${children} nodo(s)`);
  if (children === 0) problems.push(`la vista ${view} se ha quedado vacía`);
}

/* --------------------------- selector de cámara --------------------------- */

await page.evaluate(() => { location.hash = '#/counter'; });
await new Promise((r) => setTimeout(r, 1200));

const guide = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('.segmented__item')].map((e) => e.textContent.trim()),
  hint: document.querySelector('.field__hint')?.textContent ?? '',
}));
console.log(`→ selector de cámara: ${JSON.stringify(guide.labels)}`);
if (!guide.labels.includes('Frontal') || !guide.labels.includes('Trasera')) {
  problems.push('el selector de cámara no muestra Frontal/Trasera');
}

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.segmented__item')]
    .find((b) => b.textContent.trim() === 'Trasera');
  btn?.click();
});
await new Promise((r) => setTimeout(r, 600));
const after = await page.evaluate(() => ({
  hint: document.querySelector('.field__hint')?.textContent ?? '',
  active: document.querySelector('.segmented__item.is-active')?.textContent.trim() ?? null,
}));
console.log(`→ opción activa tras cambiar: ${after.active}`);
if (after.active !== 'Trasera') problems.push(`la opción activa debería ser Trasera, es ${after.active}`);
if (after.hint === guide.hint) problems.push('cambiar de cámara no actualiza la explicación');

/* ---------------------------- cambio de modo ---------------------------- */

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('modo lateral'));
  btn?.click();
});
await new Promise((r) => setTimeout(r, 800));
const mode = await page.evaluate(() => ({
  title: document.querySelector('.guide__title')?.textContent ?? '',
  hint: document.querySelector('.field__hint')?.textContent ?? '',
}));
console.log(`→ tras cambiar de modo: ${JSON.stringify(mode)}`);
if (!mode.title.includes('al lado')) problems.push('cambiar de modo no actualiza la guía');
if (!mode.hint.includes('pantalla abajo')) {
  problems.push('en modo lateral la cámara por defecto debería ser la trasera');
}

/* --------------------- el POST de una serie con decimales --------------------- */

console.log('→ guardando una serie con marcas de tiempo decimales');
const saved = await page.evaluate(async () => {
  const api = await import('/js/api.js');
  const now = Date.now();
  try {
    const res = await api.api.post('/api/workouts', {
      clientId: `smoke_${now}_2_0`,
      variant: 'standard',
      mode: 'suelo',
      startedAt: now - 30000,
      endedAt: now,
      localDate: new Date().toISOString().slice(0, 10),
      reps: [
        { tMs: 12345.678, durationMs: 2100.5, fillMax: 0.84, elbowMin: 58.2, ok: true, conf: 0.57 },
        { tMs: 14700.123, durationMs: 2100.9, fillMax: 0.81, elbowMin: 60.4, ok: true, conf: 0.55 },
      ],
      meta: { fps: 18 },
    });
    return { ok: true, valid: res.repsValid, points: res.points };
  } catch (err) {
    return { ok: false, status: err.status, message: err.message };
  }
});
console.log(`   resultado: ${JSON.stringify(saved)}`);
if (!saved.ok) problems.push(`el POST de la serie falló: ${JSON.stringify(saved)}`);
if (saved.ok && saved.valid !== 2) problems.push(`se esperaban 2 reps válidas, llegaron ${saved.valid}`);

const history = await page.evaluate(async () => {
  const api = await import('/js/api.js');
  const res = await api.api.get('/api/me/workouts?limit=3');
  return res.workouts?.map((w) => ({ id: w.id, valid: w.repsValid })) ?? [];
});
console.log(`   historial: ${JSON.stringify(history)}`);
if (!history.length) problems.push('la serie no aparece en el historial');

/* --------------------------------- fin --------------------------------- */

await browser.close();

if (problems.length) {
  console.log(`\n✗ ${problems.length} problema(s):`);
  for (const p of problems) console.log(`   - ${p}`);
  process.exit(1);
}
console.log('\n✓ smoke test sin errores');
