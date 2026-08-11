// A24.3 size guide modal on the product page. The table is rendered with
// createElement/textContent (no innerHTML) so the sanitized guide can never inject
// markup. Accessible: role="dialog" + aria-modal, Escape to close, Tab is trapped, and
// focus returns to the trigger on close. cm/inch conversion is a pure function.
(function () {
  'use strict';

  const trigger = document.getElementById('sizeGuideBtn');
  const modal = document.getElementById('sizeGuideModal');
  if (!trigger || !modal) return;
  const productId = new URLSearchParams(window.location.search).get('id');
  if (!productId) return;

  let guide = null;
  let unit = 'cm';
  let lastFocus = null;

  // Convert every number in a cell between cm/inch, preserving ranges and other text.
  function convert(value, fromUnit, toUnit) {
    if (fromUnit === toUnit) return String(value == null ? '' : value);
    const factor = toUnit === 'inch' ? (1 / 2.54) : 2.54;
    return String(value == null ? '' : value).replace(/\d+(?:[.,]\d+)?/g, (match) => {
      const converted = parseFloat(match.replace(',', '.')) * factor;
      return (Math.round(converted * 10) / 10).toString().replace('.', ',');
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function renderTable() {
    const wrap = document.getElementById('sizeGuideTableWrap');
    if (!wrap) return;
    wrap.textContent = '';
    if (!guide || !Array.isArray(guide.columns) || !guide.columns.length) return;
    const table = el('table', 'size-guide-table');
    const caption = el('caption', 'size-guide-caption', `Ölçüler (${unit})`);
    table.appendChild(caption);
    const thead = el('thead');
    const headRow = el('tr');
    headRow.appendChild(el('th', null, 'Beden'));
    for (const column of guide.columns) headRow.appendChild(el('th', null, column.label || column.key));
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = el('tbody');
    for (const row of Array.isArray(guide.rows) ? guide.rows : []) {
      const tr = el('tr');
      const rowLabel = el('th', 'size-guide-row-label', row.label || '');
      rowLabel.setAttribute('scope', 'row');
      tr.appendChild(rowLabel);
      for (const column of guide.columns) {
        const raw = (row.cells && row.cells[column.key]) || '';
        tr.appendChild(el('td', null, convert(raw, guide.measurement_unit, unit)));
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  function setUnit(next) {
    unit = next === 'inch' ? 'inch' : 'cm';
    modal.querySelectorAll('[data-unit]').forEach((button) => {
      const active = button.dataset.unit === unit;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    renderTable();
  }

  // A31: the private focus trap this file used to carry was replaced by the shared dialog
  // primitive (js/a11y.js), so Escape, Tab cycling, background inertness, scroll lock and
  // focus restore behave identically here and in every other storefront overlay.
  function open() {
    if (!guide) return;
    lastFocus = document.activeElement;
    const title = document.getElementById('sizeGuideTitle');
    const desc = document.getElementById('sizeGuideDesc');
    if (title) title.textContent = guide.name || 'Beden Rehberi';
    if (desc) { desc.textContent = guide.description || ''; desc.hidden = !guide.description; }
    setUnit(guide.measurement_unit || 'cm');
    modal.hidden = false;
    window.SuveraA11y?.openDialog(modal, {
      opener: lastFocus,
      initialFocus: '#sizeGuideClose',
      labelledBy: 'sizeGuideTitle',
      describedBy: guide.description ? 'sizeGuideDesc' : undefined,
      onClose: function () { modal.hidden = true; },
    });
  }

  function close() {
    if (window.SuveraA11y?.isOpen(modal)) {
      window.SuveraA11y.closeDialog(modal);
      return;
    }
    modal.hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  trigger.addEventListener('click', open);
  const closeBtn = document.getElementById('sizeGuideClose');
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', function (event) {
    if (event.target === modal) { close(); return; }
    const unitBtn = event.target.closest('[data-unit]');
    if (unitBtn) setUnit(unitBtn.dataset.unit);
  });

  async function init() {
    if (!window.SuveraAPI || !window.SuveraAPI.catalog || !window.SuveraAPI.catalog.sizeGuide) return;
    try {
      const data = await window.SuveraAPI.catalog.sizeGuide(productId);
      guide = data && data.guide ? data.guide : null;
      if (guide) trigger.hidden = false;
    } catch (_) { /* no guide: leave the trigger hidden */ }
  }

  window.SuveraSizeGuide = { convert, open, close, setUnit };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else void init();
})();
