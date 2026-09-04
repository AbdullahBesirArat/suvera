// Optional product media. Frames are fetched only after explicit activation.
export function spinManifest(product) {
  const value = product?.details?.spin360;
  const safe = (url) => typeof url === 'string' && url.length <= 2048
    && (/^https:\/\//.test(url) || /^\/(?!\/)/.test(url));
  if (!value || !Array.isArray(value.frames) || value.frames.length < 2
    || value.frames.length > 72 || value.frameCount !== value.frames.length
    || !value.frames.every(safe) || !safe(value.poster)
    || new Set(value.frames).size !== value.frames.length || value.poster !== value.frames[0]) return null;
  return value;
}

export function createSpin360({ manifest, name, onFailure }) {
  let frame = 0, wanted = 0, started = false, disposed = false, mount = null;
  let loadedCount = 0;
  const cache = new Map();
  const wrap = (n) => (n % manifest.frameCount + manifest.frameCount) % manifest.frameCount;
  function load(index) {
    if (cache.has(index)) return cache.get(index);
    const pending = new Promise((resolve) => {
      const image = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        image.onload = image.onerror = null;
        resolve(ok ? image : null);
      };
      const timer = setTimeout(() => finish(false), 15000);
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = manifest.frames[index];
    });
    cache.set(index, pending);
    return pending;
  }
  async function show(next, announce = false) {
    wanted = wrap(next);
    const target = wanted;
    const image = await load(target);
    if (disposed || !mount || target !== wanted || !image) return;
    frame = target;
    mount.image.src = image.src;
    mount.image.alt = `${name}, ${Math.round(frame * 360 / manifest.frameCount)} derece görünümü`;
    mount.root.dataset.frame = String(frame);
    if (announce) mount.status.textContent = mount.image.alt;
  }
  async function preload() {
    // Two adjacent frames first; bounded sequential work thereafter.
    const order = [...new Set(Array.from({ length: manifest.frameCount }, (_, i) =>
      wrap(i % 2 ? (i + 1) / 2 : -i / 2)))];
    let loaded = 0;
    for (const index of order) {
      if (disposed) return;
      if (await load(index)) loaded++;
      loadedCount = loaded;
      if (mount) mount.progress.textContent = `${loaded}/${manifest.frameCount}`;
    }
    if (!disposed && loaded < 2) onFailure();
  }
  function attach(host) {
    if (mount) mount.root.remove();
    const root = document.createElement('div');
    root.className = 'spin360-viewer';
    root.tabIndex = 0;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', `${name} 360 derece görünümü. Döndürmek için sağa veya sola sürükleyin.`);
    const image = document.createElement('img');
    image.draggable = false;
    image.alt = `${name} 360 derece görünümü`;
    const hint = document.createElement('span');
    hint.className = 'spin360-hint';
    hint.textContent = 'Sağa–sola sürükleyerek döndür';
    const progress = document.createElement('span');
    progress.className = 'spin360-progress';
    progress.textContent = `${loadedCount}/${manifest.frameCount}`;
    progress.setAttribute('aria-hidden', 'true');
    const status = document.createElement('span');
    status.className = 'sr-only';
    status.setAttribute('aria-live', 'polite');
    root.append(image, hint, progress, status);
    host.append(root);
    mount = { root, image, status, progress };
    let pointer = null;
    root.addEventListener('pointerdown', (event) => {
      if (event.button > 0 || pointer) return;
      event.stopPropagation();
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, frame, horizontal: false };
    });
    root.addEventListener('pointermove', (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = pointer.x - event.clientX, dy = pointer.y - event.clientY;
      if (!pointer.horizontal) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
        if (Math.abs(dy) > Math.abs(dx)) { pointer = null; return; }
        pointer.horizontal = true;
        root.setPointerCapture(event.pointerId);
      }
      event.stopPropagation();
      show(pointer.frame + Math.round(dx / Math.max(14, root.clientWidth / 18)));
    });
    const end = (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      event.stopPropagation();
      pointer = null;
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      show(wanted, true);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
    root.addEventListener('lostpointercapture', () => { pointer = null; });
    root.addEventListener('click', (event) => event.stopPropagation());
    root.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      show(wanted + (event.key === 'ArrowLeft' ? -1 : 1), true);
    });
    show(frame);
    root.focus({ preventScroll: true });
    if (!started) { started = true; preload(); }
  }
  return {
    ready: () => load(0),
    attach,
    detach: () => { mount?.root.remove(); mount = null; },
    destroy: () => { disposed = true; mount?.root.remove(); mount = null; },
  };
}
