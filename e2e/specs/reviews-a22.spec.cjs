'use strict';

const {
  bff,
  expect,
  loginAdmin,
  test,
} = require('../fixtures.cjs');
const { dbQuery } = require('../lib/db.cjs');

test.describe('A22 reviews, ratings and Q&A', () => {
  test('review lifecycle: customer writes -> admin publishes -> storefront renders safely with verified badge + helpful vote', async ({ page, browser, e2eState }) => {
    const productId = e2eState.fixtures.tenantA.productId;
    // A payload that would execute if the body were ever inserted as HTML.
    const payload = 'Harika urun <img src=x onerror="window.__xss_fired=1"> ve <script>window.__xss_fired=1</script> son';

    // Customer (who has a paid order for this product) signs in and writes a review.
    await page.goto(`${e2eState.origins.storefront}/giris`);
    await page.locator('#emailInput').fill(e2eState.credentials.customerA.email);
    await page.locator('#pwInput').fill(e2eState.credentials.customerA.password);
    await page.locator('[data-action="do-login"]').click();
    await page.waitForURL(/\/hesabim/, { timeout: 20_000 });

    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    await page.locator('#reviewWriteBtn').click();
    await page.locator('#reviewRatingInput [data-value="5"]').click();
    await page.locator('#reviewBodyInput').fill(payload);
    await page.locator('#reviewForm button[type="submit"]').click();
    await expect(page.locator('#reviewFormMsg')).toContainText(/moderasyon/i);

    // Pending review is not public yet.
    await page.reload();
    await expect(page.locator('#reviewsList .review-card')).toHaveCount(0);

    // Publish it through the real admin moderation endpoint (via the admin BFF).
    const [review] = await dbQuery(
      "select id from product_reviews where product_id = $1 and status = 'pending' order by id desc limit 1",
      [productId]
    );
    expect(review).toBeTruthy();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAdmin(adminPage, e2eState);
    const moderation = await bff(adminPage, `/operations/reviews/${review.id}/moderate`, { method: 'POST', body: { action: 'publish' } });
    expect(moderation.status).toBe(200);
    await adminContext.close();

    // The published review renders as TEXT — the markup never executes.
    await page.reload();
    await expect(page.locator('#reviewsList .review-card')).toHaveCount(1);
    await expect(page.locator('.review-body')).toContainText('onerror'); // literal payload shown, not run
    await expect(page.locator('.review-verified')).toBeVisible();
    expect(await page.evaluate(() => window.__xss_fired)).toBeUndefined();
    expect(await page.locator('#reviewsList img').count()).toBe(0);

    // Helpful vote persists and increments.
    await page.locator('.review-helpful-btn').click();
    await expect(page.locator('.review-helpful-btn')).toContainText('(1)');
  });

  test('Q&A: a guest question awaits moderation and a store answer publishes the thread', async ({ page, browser, e2eState }) => {
    const productId = e2eState.fixtures.tenantA.productId;
    await page.goto(`${e2eState.origins.storefront}/urun?id=${productId}`);
    await page.locator('#qaBodyInput').fill('Bu urun icin kargo ne kadar surede teslim edilir?');
    await page.locator('#qaForm button[type="submit"]').click();
    await expect(page.locator('#qaFormMsg')).toContainText(/yayınlanacak|yayinlanacak|yanıtlan/i);

    // Pending question is not public.
    await page.reload();
    await expect(page.locator('#qaList .qa-item')).toHaveCount(0);

    const [question] = await dbQuery(
      "select id from product_questions where product_id = $1 and status = 'pending' order by id desc limit 1",
      [productId]
    );
    expect(question).toBeTruthy();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAdmin(adminPage, e2eState);
    const answered = await bff(adminPage, `/operations/reviews/questions/${question.id}/answer`, { method: 'POST', body: { body: 'Kargo 1-3 is gununde teslim edilir.' } });
    expect(answered.status).toBe(201);
    await adminContext.close();

    // The answered thread is now public with the official store answer.
    await page.reload();
    await expect(page.locator('#qaList .qa-item')).toHaveCount(1);
    await expect(page.locator('.qa-answer')).toContainText('1-3');
    await expect(page.locator('.qa-official')).toBeVisible();
  });
});
