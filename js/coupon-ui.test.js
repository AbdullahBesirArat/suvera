const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('coupon helper persists a normalized code and sends canonical cart identities', async () => {
  const values = new Map();
  let requestPayload = null;
  const context = {
    window: {
      SuveraAPI: {
        coupons: {
          evaluate: async (payload) => {
            requestPayload = payload;
            return { pricing: { total: 90 } };
          },
        },
      },
    },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  vm.runInNewContext(read('js/coupon-ui.js'), context);
  await context.window.SuveraCoupons.evaluate([
    { product_id: 7, variant_id: 12, qty: 2 },
    { id: 9, quantity: 1 },
  ], ' save20 ', ' guest@example.com ');

  assert.equal(context.window.SuveraCoupons.load(), 'SAVE20');
  assert.deepEqual(JSON.parse(JSON.stringify(requestPayload)), {
    couponCode: 'SAVE20',
    email: 'guest@example.com',
    items: [
      { product_id: 7, variant_id: 12, quantity: 2 },
      { product_id: 9, variant_id: null, quantity: 1 },
    ],
  });
});

test('coupon evaluation stays on the same-origin API proxy', () => {
  const api = read('js/api.js');
  assert.match(api, /evaluate:\s*\(payload\) => request\('\/coupons\/evaluate'/);
  assert.doesNotMatch(api, /coupons\/evaluate[\s\S]{0,120}https?:\/\//);
});

test('checkout revalidates the saved coupon and preserves cart and coupon on failure', () => {
  const checkout = read('siparis.html');
  assert.match(checkout, /if \(couponCode\) payload\.couponCode = couponCode/);

  const successStart = checkout.indexOf('const result = isIbanPayment');
  const failureStart = checkout.indexOf('} catch (err) {', successStart);
  const failureEnd = checkout.indexOf('\n      }\n    });', failureStart);
  assert.ok(successStart > -1 && failureStart > successStart && failureEnd > failureStart);

  const successPath = checkout.slice(successStart, failureStart);
  const failurePath = checkout.slice(failureStart, failureEnd);
  assert.match(successPath, /localStorage\.removeItem\(CART_KEY\)/);
  assert.match(successPath, /SuveraCoupons\?\.clear\(\)/);
  assert.doesNotMatch(failurePath, /removeItem\(CART_KEY\)|SuveraCoupons\?\.clear\(\)/);
  assert.match(failurePath, /getCheckoutErrorMessage\(err\)/);
});

test('coupon controls stay in checkout and are intentionally absent from the cart page', () => {
  const cart = read('sepet.html');
  assert.doesNotMatch(cart, /Kupon checkout sırasında sunucuda yeniden doğrulanır|CouponApply|CouponRemove|cartCoupon/);

  const checkout = read('siparis.html');
  assert.match(checkout, /Kupon checkout sırasında sunucuda yeniden doğrulanır/);
  assert.match(checkout, /CouponApply/);
  assert.match(checkout, /CouponRemove/);
});
