// A31 accessibility primitives. One canonical dialog/overlay lifecycle for the whole
// storefront, so mobile menu, filter drawer, cart drawer, lightbox and size guide behave
// identically instead of each re-implementing focus handling slightly differently.
//
// Loaded as a classic script before shared.js and exposed on window.SuveraA11y, because
// the storefront mixes classic scripts and modules. No inline handlers, no innerHTML:
// A06's CSP invariant holds.
(function () {
  'use strict';

  // Elements that can hold focus. :not([hidden]) and the disabled filter below keep the
  // list to what is genuinely reachable at this moment.
  var FOCUSABLE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary',
    'audio[controls]', 'video[controls]', '[contenteditable]', '[tabindex]',
  ].join(',');

  function isVisible(node) {
    if (node.hasAttribute('disabled') || node.getAttribute('aria-hidden') === 'true') return false;
    if (node.hasAttribute('hidden')) return false;
    if (Number(node.getAttribute('tabindex')) < 0) return false;
    // offsetParent is null for display:none subtrees; position:fixed needs the rect check.
    return Boolean(node.offsetParent) || node.getClientRects().length > 0;
  }

  function focusables(container) {
    return Array.prototype.filter.call(container.querySelectorAll(FOCUSABLE), isVisible);
  }

  // The scroll lock is reference counted: closing a size guide opened from a page that
  // also has a drawer open must not hand scrolling back early.
  var scrollLocks = 0;
  var savedScrollY = 0;
  var savedHtmlOverflow = '';
  var savedBodyOverflow = '';

  function lockScroll() {
    scrollLocks += 1;
    if (scrollLocks > 1) return;
    savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    savedHtmlOverflow = document.documentElement.style.overflow;
    savedBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }

  function unlockScroll() {
    scrollLocks = Math.max(0, scrollLocks - 1);
    if (scrollLocks > 0) return;
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.body.style.overflow = savedBodyOverflow;
    window.scrollTo(0, savedScrollY);
  }

  var openDialogs = [];

  function topDialog() {
    return openDialogs.length ? openDialogs[openDialogs.length - 1] : null;
  }

  // Everything outside the dialog is hidden from assistive technology while it is open, so
  // a screen reader cannot wander into the page behind it. Siblings are recorded so a
  // pre-existing aria-hidden is restored rather than cleared.
  function hideBackground(dialog) {
    var hidden = [];
    var node = dialog;
    while (node && node !== document.body) {
      var parent = node.parentElement;
      if (!parent) break;
      Array.prototype.forEach.call(parent.children, function (sibling) {
        if (sibling === node || sibling.hasAttribute('aria-hidden')) return;
        sibling.setAttribute('aria-hidden', 'true');
        hidden.push(sibling);
      });
      node = parent;
    }
    return hidden;
  }

  function restoreBackground(hidden) {
    hidden.forEach(function (node) { node.removeAttribute('aria-hidden'); });
  }

  function onKeydown(event) {
    var current = topDialog();
    if (!current) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(current.element);
      return;
    }
    if (event.key !== 'Tab') return;
    var items = focusables(current.element);
    if (!items.length) {
      event.preventDefault();
      current.element.focus();
      return;
    }
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    // Focus that escaped the dialog (browser chrome, programmatic move) is pulled back.
    if (!current.element.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown, true);

  /**
   * Open an element as a modal dialog.
   *
   * options.opener       element focus returns to on close (defaults to activeElement)
   * options.initialFocus element or selector focused on open
   * options.labelledBy   id of the element naming the dialog
   * options.describedBy  id of the element describing it
   * options.onClose      called after the dialog is closed and focus restored
   */
  function openDialog(element, options) {
    if (!element || openDialogs.some(function (entry) { return entry.element === element; })) return;
    var config = options || {};
    var record = {
      element: element,
      opener: config.opener || (document.activeElement instanceof HTMLElement ? document.activeElement : null),
      hidden: [],
      onClose: typeof config.onClose === 'function' ? config.onClose : null,
      hadTabIndex: element.hasAttribute('tabindex'),
    };

    if (element.tagName !== 'DIALOG') {
      element.setAttribute('role', element.getAttribute('role') || 'dialog');
      element.setAttribute('aria-modal', 'true');
    }
    if (config.labelledBy) element.setAttribute('aria-labelledby', config.labelledBy);
    if (config.describedBy) element.setAttribute('aria-describedby', config.describedBy);
    element.removeAttribute('aria-hidden');
    if (!record.hadTabIndex) element.setAttribute('tabindex', '-1');

    record.hidden = hideBackground(element);
    lockScroll();
    openDialogs.push(record);

    // Where focus lands must never depend on a transition or animation completing. The
    // caller names the control it wants focused, so that element is taken at face value
    // rather than being run through the visibility probe: mid-transition the drawer can
    // still report zero client rects, which previously collapsed the choice to the dialog
    // container itself. Under prefers-reduced-motion the transition timing shifts and that
    // fallback became the normal path, which is how this surfaced.
    var target = null;
    if (typeof config.initialFocus === 'string') target = element.querySelector(config.initialFocus);
    else if (config.initialFocus instanceof HTMLElement) target = config.initialFocus;
    if (!target) target = focusables(element)[0] || element;

    // Flush pending style/layout so the dialog's own visibility has settled, then move
    // focus synchronously in the same task as the open call.
    void element.offsetHeight;
    target.focus();
    if (document.activeElement !== target) {
      // Safety net only: some engines refuse focus while an element is still being made
      // visible. This is never the primary path — the synchronous focus above is.
      window.requestAnimationFrame(function () { target.focus(); });
    }
  }

  function closeDialog(element) {
    var index = -1;
    for (var i = openDialogs.length - 1; i >= 0; i -= 1) {
      if (openDialogs[i].element === element) { index = i; break; }
    }
    if (index === -1) return;
    var record = openDialogs[index];
    openDialogs.splice(index, 1);

    restoreBackground(record.hidden);
    unlockScroll();
    element.removeAttribute('aria-modal');
    element.setAttribute('aria-hidden', 'true');
    if (!record.hadTabIndex) element.removeAttribute('tabindex');

    if (record.opener && document.contains(record.opener)) record.opener.focus();
    if (record.onClose) record.onClose();
  }

  function isOpen(element) {
    return openDialogs.some(function (entry) { return entry.element === element; });
  }

  // Wires a trigger/dialog pair that toggles a class, keeping aria-expanded on the trigger
  // truthful. Used by the disclosure-style overlays (mobile menu, filter drawer).
  function bindExpanded(trigger, dialog, expanded) {
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    if (dialog && dialog.id) trigger.setAttribute('aria-controls', dialog.id);
  }

  // Politely announce a transient status (cart updated, N results). One shared region
  // avoids a live region per feature, and re-setting the text is what makes it speak.
  var liveRegion = null;

  function announce(message, assertive) {
    if (!message) return;
    if (!liveRegion) {
      liveRegion = document.createElement('div');
      liveRegion.className = 'sr-only';
      liveRegion.setAttribute('role', 'status');
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      document.body.appendChild(liveRegion);
    }
    liveRegion.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
    // Clearing first guarantees a repeat of the same message is still announced.
    liveRegion.textContent = '';
    window.setTimeout(function () { liveRegion.textContent = String(message); }, 30);
  }

  window.SuveraA11y = {
    openDialog: openDialog,
    closeDialog: closeDialog,
    isOpen: isOpen,
    focusables: focusables,
    bindExpanded: bindExpanded,
    announce: announce,
  };
}());
