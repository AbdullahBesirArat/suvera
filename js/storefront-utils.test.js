const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleSource = fs.readFileSync(path.join(__dirname, 'core', 'storefront-utils.js'), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`;

test('shared storefront utilities keep money, text and HTTP URL behavior canonical', async () => {
  const { escapeHtml, formatMoney, safeHttpUrl } = await import(moduleUrl);

  assert.equal(formatMoney(1499.5), '1.499,50 TL');
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(safeHttpUrl('/tesekkur', 'https://suvera.example/siparis'), 'https://suvera.example/tesekkur');
  assert.equal(safeHttpUrl('javascript:alert(1)', 'https://suvera.example/siparis'), '');
  assert.equal(safeHttpUrl('data:text/html,test', 'https://suvera.example/siparis'), '');
});
