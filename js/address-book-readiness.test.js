'use strict';

// The "Yeni adres ekle" control must never be usable before its click handler exists.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'hesabim.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/site-pages.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/site-pages.css'), 'utf8');

test('the add-address button ships disabled and announces it', () => {
  const button = html.match(/<button[^>]*id="addressAddButton"[^>]*>/)[0];
  assert.match(button, /\sdisabled(\s|>)/);
  assert.match(button, /aria-disabled="true"/);
});

test('the handler is bound before the button is enabled, and only once', () => {
  const render = script.slice(script.indexOf('async function renderAddressBook()'));
  const bindAt = render.indexOf('bindAddressBook();');
  const enableAt = render.indexOf('addButton.disabled = false;');
  assert.ok(bindAt > 0 && enableAt > bindAt, 'bind must precede enabling');
  assert.match(render.slice(enableAt, enableAt + 120), /removeAttribute\('aria-disabled'\)/);
  const bind = script.slice(script.indexOf('function bindAddressBook()'), script.indexOf('async function renderAddressBook()'));
  assert.match(bind, /if \(!card \|\| addressBookBound\) return;\s*addressBookBound = true;/);
  assert.equal((bind.match(/addButton\.addEventListener\('click'/g) || []).length, 1);
});

test('signed-out state keeps the action unavailable', () => {
  const render = script.slice(script.indexOf('async function renderAddressBook()'));
  const signedOut = render.slice(0, render.indexOf('bindAddressBook();'));
  assert.match(signedOut, /addButton\.hidden = true;[\s\S]*addButton\.disabled = true;[\s\S]*setAttribute\('aria-disabled', 'true'\)/);
});

test('the hidden attribute is not defeated by the button display rule', () => {
  assert.match(css, /\.page-btn-secondary\[hidden\]\s*\{\s*display:\s*none;\s*\}/);
});
