const { test, expect } = require('@playwright/test');
const path = require('node:path');
const manifest = require('../fixtures/spin360/manifest.json');
const frames = manifest.frames.map((name) => '/spin-test/' + name);
const fixture = { id: '900001', name: 'Kanonik Test Elbisesi', price: '100', status: 'active', stock: 4,
  images: ['/photo-test/one.webp', '/photo-test/two.webp'], colors: [], sizes: [], variants: [],
  details: { spin360: { frameCount: 12, poster: frames[0], frames } } };
async function setup(page, { spin = true, broken = -1, delay = 0 } = {}) {
  const requests = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (/\/products\/900001$/.test(url.pathname)) body = { ...fixture, details: spin ? fixture.details : {} };
    else if (/\/(products|categories|collections)$/.test(url.pathname)) body = [];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/photo-test/*', (route) => route.fulfill({ path: path.join(__dirname, '../fixtures/spin360', manifest.frames[0]), contentType: 'image/webp' }));
  await page.route('**/spin-test/*', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const index = manifest.frames.indexOf(name);
    requests.push(index);
    if (index === broken || broken === -2 || (broken === -3 && index !== 0)) return route.fulfill({ status: 404, body: '' });
    if (delay && index !== 0) await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill({ path: path.join(__dirname, '../fixtures/spin360', name), contentType: 'image/webp' });
  });
  await page.goto('/urun?id=900001');
  await expect(page.locator('#detailProductTitle')).toHaveText(fixture.name);
  const consent = page.getByRole('button', { name: 'Yalnızca Zorunlu', exact: true });
  if (await consent.isVisible()) await consent.click();
  return requests;
}

for (const [width, height] of [[390,844],[412,915],[430,932],[768,1000],[1440,1000]]) {
  test(`${width}: optional native viewer, lazy frames, keyboard, drag and fullscreen`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const requests = await setup(page);
    const control = page.getByRole('button', { name: '360° Gör', exact: true });
    await expect(control).toBeVisible();
    expect(requests).toEqual([0]);
    await expect(page.locator('#detailMainMedia > img')).toBeVisible();
    await control.click();
    const viewer = page.locator('#detailMainMedia .spin360-viewer');
    await expect(viewer).toBeFocused();
    await expect(viewer).toHaveAttribute('aria-label', /Kanonik Test Elbisesi 360 derece/);
    await expect.poll(() => new Set(requests).size).toBe(12);
    await viewer.press('ArrowLeft');
    await expect(viewer).toHaveAttribute('data-frame', '11');
    await viewer.press('ArrowRight');
    await expect(viewer).toHaveAttribute('data-frame', '0');
    const box = await viewer.boundingBox();
    const dragY = (Math.max(box.y, 100) + Math.min(box.y + box.height, height - 180)) / 2;
    await page.mouse.move(box.x + box.width * .7, dragY);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .3, dragY, { steps: 8 });
    await page.mouse.up();
    await expect(viewer).not.toHaveAttribute('data-frame', '0');
    const angle = await viewer.getAttribute('data-frame');
    await page.waitForTimeout(150);
    await expect(viewer).toHaveAttribute('data-frame', angle);
    await expect(page.locator('#galleryCounter')).toHaveText('1 / 2');
    expect(await viewer.evaluate(el => getComputedStyle(el).touchAction)).toBe('pan-y');
    await page.getByRole('button', { name: '360° Tam ekran' }).click();
    const fullscreen = page.locator('#imageLightbox .spin360-viewer');
    await expect(fullscreen).toBeVisible();
    const modalBox = await fullscreen.boundingBox();
    expect(modalBox.width).toBeGreaterThan(width * .9);
    expect(modalBox.height).toBeGreaterThan(height * .9);
    await fullscreen.press('ArrowRight');
    await fullscreen.press('Escape');
    await expect(page.locator('#imageLightbox')).not.toHaveClass(/open/);
    await expect(viewer).toBeVisible();
    await page.getByRole('button', { name: 'Fotoğrafa dön' }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page.locator('#detailMainMedia > img')).toBeVisible();
    await page.locator('#detailMainMedia').click();
    await expect(page.locator('#imageLightboxImg')).toBeVisible();
    await page.locator('#imageLightboxClose').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await control.click();
    await page.screenshot({ path: `test-results/spin360-${width}.png` });
  });
}
test('without spin: no control, no spin requests; ordinary gallery works', async ({ page }) => {
  const requests = await setup(page, { spin: false });
  await expect(page.locator('#spin360Controls')).toHaveCount(0);
  expect(requests).toEqual([]);
  await page.locator('.thumb-btn').nth(1).click();
  await expect(page.locator('#galleryCounter')).toHaveText('2 / 2');
});

test('touch rotation owns horizontal movement while vertical touch scrolls the page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await setup(page);
  await page.getByRole('button', { name: '360° Gör', exact: true }).click();
  const viewer = page.locator('.spin360-viewer');
  await expect(viewer).toHaveAttribute('data-frame', '0');
  const cdp = await context.newCDPSession(page);
  const gesture = async (x1, y1, x2, y2) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2-x1)*i/8, y: y1 + (y2-y1)*i/8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const box = await viewer.boundingBox();
  const y = Math.min(box.y + box.height * .5, 550);
  await gesture(300, y, 100, y);
  await expect(viewer).not.toHaveAttribute('data-frame', '0');
  await expect(page.locator('#galleryCounter')).toHaveText('1 / 2');
  const scroll = await page.evaluate(() => scrollY);
  await gesture(190, y, 190, y - 180);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll);
  await context.close();
});
test('broken poster removes control and preserves normal media', async ({ page }) => {
  await setup(page, { broken: 0 });
  await expect(page.locator('#spin360Controls')).toHaveCount(0);
  await expect(page.locator('#detailMainMedia > img')).toBeVisible();
});
test('individual missing frame holds valid image and remains usable', async ({ page }) => {
  await setup(page, { broken: 1 });
  await page.getByRole('button', { name: '360° Gör', exact: true }).click();
  const viewer = page.locator('.spin360-viewer');
  await expect(viewer).toHaveAttribute('data-frame', '0');
  await viewer.press('ArrowRight');
  await expect(viewer).toHaveAttribute('data-frame', '0');
  await viewer.press('ArrowRight');
  await expect(viewer).toHaveAttribute('data-frame', '2');
});

test('all rotation frames fail: restore photo and remove failed control', async ({ page }) => {
  await setup(page, { broken: -3 });
  await page.getByRole('button', { name: '360° Gör', exact: true }).click();
  await expect(page.locator('#spin360Controls')).toHaveCount(0);
  await expect(page.locator('.spin360-viewer')).toHaveCount(0);
  await expect(page.locator('#detailMainMedia')).toBeFocused();
  await expect(page.locator('#detailMainMedia > img')).toBeVisible();
});

test('adjacent frames work while the remaining sequence is still loading', async ({ page }) => {
  const requests = await setup(page, { delay: 250 });
  await page.getByRole('button', { name: '360° Gör', exact: true }).click();
  const viewer = page.locator('.spin360-viewer');
  await viewer.press('ArrowRight');
  await expect(viewer).toHaveAttribute('data-frame', '1');
  expect(new Set(requests).size).toBeLessThan(12);
  expect(requests.slice(0, 3)).toEqual([0, 1, 11]);
});
