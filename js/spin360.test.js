const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'spin360.js'), 'utf8').replaceAll('export function ', 'function ');
const context = vm.createContext({});
vm.runInContext(source, context);
test('optional spin contract rejects missing, ambiguous and unsafe manifests without fetching assets', () => {
  assert.equal(context.spinManifest({}), null);
  const spin360 = { frameCount: 2, poster: '/a.webp', frames: ['/a.webp', '/b.webp'] };
  assert.equal(context.spinManifest({ details: { spin360 } }), spin360);
  for (const invalid of [ { ...spin360, frameCount: 12 }, { ...spin360, poster: '/b.webp' },
    { ...spin360, frames: ['/a.webp', '/a.webp'] },
    { frameCount: 2, poster: 'javascript:alert(1)', frames: ['javascript:alert(1)', '/b.webp'] },
    { frameCount: 2, poster: '//other.test/a', frames: ['//other.test/a', '/b.webp'] } ]) {
    assert.equal(context.spinManifest({ details: { spin360: invalid } }), null);
  }
});
