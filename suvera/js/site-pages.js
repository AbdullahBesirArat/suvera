(function () {
  'use strict';

  function money(value) {
    return Number(value || 0).toLocaleString('tr-TR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' TL';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (char) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char];
    });
  }

  function assetUrl(path) {
    return window.SuveraAPI && window.SuveraAPI.assetUrl ? window.SuveraAPI.assetUrl(path) : path;
  }

  function parseImageEntry(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parts = raw.split('|').map(function (part) { return part.trim(); }).filter(Boolean);
    if (parts.length >= 2) return { color: parts[0], url: parts[parts.length - 1] };
    return { color: '', url: raw };
  }

  function productImage(product) {
    const entry = (Array.isArray(product.images) ? product.images : [])
      .map(parseImageEntry)
      .find(function (item) { return item && item.url; });
    return entry ? assetUrl(entry.url) : '';
  }

  function blogUrl(post) {
    const key = post && (post.id || post.slug);
    return key ? 'blog-detay?id=' + encodeURIComponent(key) : 'blog-detay';
  }

  function publishedLabel(value) {
    if (!value) return 'Suvera Rehberi';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Suvera Rehberi';
    return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function blogArticleHtml(content) {
    const lines = String(content || '').split(/\n+/).map(function (line) { return line.trim(); }).filter(Boolean);
    if (!lines.length) return '<p>Bu blog yazısının detayları hazırlanıyor.</p>';

    const html = [];
    let list = [];
    function flushList() {
      if (!list.length) return;
      html.push('<ul>' + list.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ul>');
      list = [];
    }

    lines.forEach(function (line) {
      if (line.startsWith('## ')) {
        flushList();
        html.push('<h2>' + escapeHtml(line.replace(/^##\s+/, '')) + '</h2>');
        return;
      }
      if (line.startsWith('- ')) {
        list.push(line.replace(/^-\s+/, ''));
        return;
      }
      flushList();
      html.push('<p>' + escapeHtml(line) + '</p>');
    });
    flushList();
    return html.join('');
  }

  // FIX: Block unsafe link protocols from API and localStorage-backed content.
  function safeHref(value, fallback) {
    const href = String(value || '').trim();
    if (!href) return fallback || '';
    try {
      const parsed = new URL(href, location.href);
      if (['http:', 'https:'].includes(parsed.protocol)) return href;
    } catch (_) {}
    if (/^(\/|\.\/|\.\.\/|#|[a-z0-9_-]+(?:\.html)?(?:[?#].*)?)/i.test(href)) return href;
    return fallback || '';
  }

  function trackingLink(url) {
    const href = safeHref(url, '');
    return href ? ' • <a href="' + escapeHtml(href) + '">Takip Linki</a>' : '';
  }

  function productMatches(product, query) {
    const haystack = [
      product.name,
      product.category_name,
      product.tags,
      product.description,
    ].join(' ').toLocaleLowerCase('tr-TR');

    return haystack.includes(query.toLocaleLowerCase('tr-TR'));
  }

  function uniqueSorted(values) {
    return Array.from(new Set((values || []).map(function (value) {
      return String(value || '').trim();
    }).filter(Boolean))).sort(function (a, b) {
      return a.localeCompare(b, 'tr');
    });
  }

  function productFinalPrice(product) {
    return Number(product && (product.sale_price || product.price) || 0);
  }

  function productHasValue(product, key, value) {
    if (!value) return true;
    return (Array.isArray(product[key]) ? product[key] : []).some(function (item) {
      return String(item || '').toLocaleLowerCase('tr-TR') === value.toLocaleLowerCase('tr-TR');
    });
  }

  function optionHtml(value, label, selectedValue) {
    return '<option value="' + escapeHtml(value) + '"' + (String(value) === String(selectedValue || '') ? ' selected' : '') + '>' +
      escapeHtml(label || value) + '</option>';
  }

  function orderStatusLabel(status) {
    const labels = {
      payment_pending: 'Odeme bekleniyor',
      paid: 'Odeme alindi',
      payment_failed: 'Odeme basarisiz',
      payment_cancelled: 'Odeme iptal edildi',
      preparing: 'Hazirlaniyor',
      shipped: 'Kargoya verildi',
      delivered: 'Teslim edildi',
      cancelled: 'Iptal edildi',
    };
    return labels[status] || 'Islemde';
  }

  function normalizeOrder(raw) {
    if (!raw) return null;
    const items = Array.isArray(raw.items) ? raw.items.map(function (item) {
      return {
        id: item.product_id || '',
        name: item.name || 'Urun',
        qty: Number(item.qty || item.quantity || 1),
        quantity: Number(item.qty || item.quantity || 1),
        price: Number(item.price || item.unit_price || 0),
        unit_price: Number(item.price || item.unit_price || 0),
        variant: item.variant || item.size || 'Standart',
      };
    }) : [];

    return {
      id: raw.id || raw.order_code || '',
      orderCode: raw.orderCode || raw.order_code || raw.id || '',
      status: raw.status || 'new',
      provider: raw.provider || raw.payment_provider || '',
      paymentMethod: raw.paymentMethod || raw.payment_method || '',
      total: Number(raw.total || 0),
      shipping_fee: Number(raw.shipping_fee || raw.shippingFee || 0),
      shipping_company: raw.shipping_company || '',
      tracking_number: raw.tracking_number || '',
      tracking_url: raw.tracking_url || '',
      shipped_at: raw.shipped_at || '',
      created_at: raw.created_at || '',
      updated_at: raw.updated_at || '',
      customer: raw.customer || {
        name: raw.customer_name || raw.customer || '',
        email: raw.email || '',
        phone: raw.phone || '',
        address: raw.address || '',
      },
      items: items,
    };
  }

  function isIbanOrder(order) {
    const method = String(order && (order.paymentMethod || order.payment_method) || '').toLowerCase();
    const provider = String(order && order.provider || '').toLowerCase();
    const status = String(order && order.status || '').toLowerCase();
    return method === 'iban' || provider === 'manual';
  }

  function ibanInfoHtml(orderCode) {
    const info = window.SUVERA_IBAN_INFO || {};
    const accountName = info.accountName || 'Suvera';
    const bankName = info.bankName || '';
    const iban = info.iban || '';

    if (!iban) {
      return '<div class="page-warning-banner" style="margin-top:16px;"><strong>IBAN bilgileri yapılandırılmadı.</strong><br/>Lütfen ödeme için Suvera destek ekibiyle iletişime geçin. Sipariş kodunuz: <strong>' +
        escapeHtml(orderCode || '-') + '</strong></div>';
    }

    return '<div class="page-info-banner" style="margin-top:16px;"><strong>IBAN / havale bilgileri</strong><br/>' +
      (bankName ? 'Banka: <strong>' + escapeHtml(bankName) + '</strong><br/>' : '') +
      'Alıcı: <strong>' + escapeHtml(accountName) + '</strong><br/>' +
      'IBAN: <strong>' + escapeHtml(iban) + '</strong><br/>' +
      'Açıklama: <strong>' + escapeHtml(orderCode || '-') + '</strong></div>';
  }

  function orderStatusNote(order) {
    const status = String(order && order.status || '').toLowerCase();
    if (isIbanOrder(order)) {
      return 'IBAN / havale siparişiniz alındı. Ödeme açıklamasına sipariş kodunu ekleyin; ödeme onaylanana kadar durum Panelya’da ödeme bekliyor olarak kalır.';
    }
    if (status === 'payment_failed') {
      return 'Kart ödemeniz tamamlanamadı. Siparişi yeniden deneyebilir veya destek ekibimizle iletişime geçebilirsiniz.';
    }
    return 'Sipariş durumu Panelya backend verisinden okunuyor. Kargo numarası oluştuğunda bu alana otomatik yansır.';
  }

  function orderEmail(order) {
    return String(order && order.customer && order.customer.email || order && order.email || '').trim();
  }

  async function fetchOrder(orderCode, email) {
    if (!window.SuveraAPI || !orderCode) return null;
    try {
      const order = await window.SuveraAPI.orders.lookup(orderCode, email || '');
      return normalizeOrder(order);
    } catch (err) {
      return null;
    }
  }

  async function fetchOrders(orders) {
    const seen = new Set();
    const uniqueOrders = (orders || []).filter(function (order) {
      const code = order && (order.orderCode || order.id);
      if (!code || seen.has(String(code))) return false;
      seen.add(String(code));
      return true;
    }).slice(0, 20);

    // FIX: Cap account order lookup concurrency so localStorage cannot create request bursts.
    const results = [];
    let cursor = 0;
    async function worker() {
      while (cursor < uniqueOrders.length) {
        const index = cursor;
        cursor += 1;
        const order = uniqueOrders[index];
        results[index] = await fetchOrder(order.orderCode || order.id, orderEmail(order));
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, uniqueOrders.length) }, worker));
    return results.filter(Boolean);
  }

  async function fetchAccount(email, orderCode) {
    if (!window.SuveraAPI || !window.SuveraAPI.customers) return null;
    if (!window.SuveraAPI.customerToken || !window.SuveraAPI.customerToken()) {
      if (!email || !orderCode) return null;
    }
    try {
      const account = await window.SuveraAPI.customers.account(email, orderCode);
      return {
        customer: account.customer || {},
        orders: Array.isArray(account.orders) ? account.orders.map(normalizeOrder).filter(Boolean) : [],
      };
    } catch (err) {
      return null;
    }
  }

  async function fetchSignedInAccount() {
    const api = window.SuveraAPI;
    if (!api || !api.customerToken || !api.customerToken() || !api.customerAuth || !api.customerAuth.me) return null;

    try {
      const session = await api.customerAuth.me();
      return {
        customer: session.account || {},
        orders: Array.isArray(session.orders) ? session.orders.map(normalizeOrder).filter(Boolean) : [],
      };
    } catch (err) {
      return null;
    }
  }

  function getState() {
    return window.Suvera || {};
  }

  function renderOrderItems(items) {
    return (items || []).map(function (item) {
      return '<tr><td><strong>' + escapeHtml(item.name || 'Urun') + '</strong><br/><span>' +
        escapeHtml(item.variant || item.size || 'Standart') + '</span></td><td>' +
        Number(item.qty || item.quantity || 1) + '</td><td>' + money(Number(item.price || item.unit_price || 0)) +
        '</td></tr>';
    }).join('');
  }

  function paymentReturnState(params) {
    const raw = String(
      params.get('payment') ||
      params.get('paymentStatus') ||
      params.get('status') ||
      ''
    ).toLowerCase();

    if (['success', 'successful', 'paid', 'ok'].includes(raw)) {
      return {
        status: 'paid',
        note: 'Odemeniz onaylandi. Siparisiniz hazirlama sirasina alindi ve gelismeleri bu sayfadan takip edebilirsiniz.',
      };
    }

    if (['failed', 'failure', 'error'].includes(raw)) {
      return {
        status: 'payment_failed',
        note: 'Odeme tamamlanamadi. Kart bilgilerinizi kontrol ederek siparisi tekrar deneyebilir veya destek ekibimizle iletisime gecebilirsiniz.',
      };
    }

    if (['cancel', 'cancelled'].includes(raw)) {
      return {
        status: 'payment_cancelled',
        note: 'Odeme islemi tamamlanmadan sonlandirildi. Hazir oldugunuzda siparisinizi yeniden baslatabilirsiniz.',
      };
    }

    return null;
  }

  async function renderThankYou() {
    const root = document.getElementById('thankYouPage');
    if (!root) return;

    const params = new URLSearchParams(location.search);
    const state = getState();
    const lastOrder = state.getLastOrder ? state.getLastOrder() : null;
    const history = state.loadOrderHistory ? state.loadOrderHistory() : [];
    const orderCode = params.get('order');
    const localOrder = history.find(function (item) {
      return String(item.orderCode || item.id || '') === String(orderCode || '');
    }) || lastOrder;

    const summary = document.getElementById('thankYouSummary');
    const codeNode = document.getElementById('thankYouOrderCode');
    const nameNode = document.getElementById('thankYouCustomerName');
    const totalNode = document.getElementById('thankYouTotal');
    const statusNode = document.getElementById('thankYouStatus');
    const noteNode = document.getElementById('thankYouProviderNote');
    const paymentState = paymentReturnState(params);

    const backendOrder = await fetchOrder(
      orderCode || (localOrder && (localOrder.orderCode || localOrder.id)),
      orderEmail(localOrder)
    );
    const order = backendOrder || normalizeOrder(localOrder);

    if (!order) {
      summary.innerHTML = '<div class="page-empty">Son siparis ozeti bulunamadi. Sepet veya hesabim sayfasindan son islemlerinizi kontrol edebilirsiniz.</div>';
      return;
    }

    if (paymentState && state.recordOrder) {
      state.recordOrder({
        ...order,
        status: paymentState.status,
      });
    }

    const effectiveOrder = paymentState
      ? { ...order, status: paymentState.status }
      : order;

    codeNode.textContent = effectiveOrder.orderCode || effectiveOrder.id || '-';
    nameNode.textContent = effectiveOrder.customer && effectiveOrder.customer.name ? effectiveOrder.customer.name : 'Suvera musterisi';
    totalNode.textContent = money(effectiveOrder.total || 0);
    statusNode.textContent = orderStatusLabel(effectiveOrder.status);

    if (paymentState) {
      noteNode.textContent = paymentState.note;
    } else if (isIbanOrder(effectiveOrder)) {
      noteNode.innerHTML = 'Siparişiniz oluşturuldu. IBAN / havale ödemesi onaylanana kadar durum <strong>ödeme bekleniyor</strong> olarak kalır.';
    } else {
      noteNode.textContent = 'Odeme saglayicisi tarafinda islem tamamlandiginda durum bu sayfadan ve hesabim alanindan takip edilebilir.';
    }

    summary.innerHTML = '<div class="page-table-wrap"><table class="page-table"><thead><tr><th>Urun</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>' +
      renderOrderItems(effectiveOrder.items || []) +
      '</tbody></table></div>' +
      (isIbanOrder(effectiveOrder) ? ibanInfoHtml(effectiveOrder.orderCode || effectiveOrder.id) : '') +
      ((effectiveOrder.tracking_number || effectiveOrder.tracking_url)
        ? '<div class="page-info-banner" style="margin-top:16px;">Kargo: <strong>' + escapeHtml(effectiveOrder.shipping_company || 'Hazirlaniyor') + '</strong>' +
          (effectiveOrder.tracking_number ? ' • Takip No: <strong>' + escapeHtml(effectiveOrder.tracking_number) + '</strong>' : '') +
          trackingLink(effectiveOrder.tracking_url) +
          '</div>'
        : '');
  }

  async function renderAccount() {
    const root = document.getElementById('accountPage');
    if (!root) return;

    const state = getState();
    if (state.syncFavoritesFromServer) {
      await state.syncFavoritesFromServer();
    }
    let profile = state.loadProfile ? state.loadProfile() : {};
    const localOrders = state.loadOrderHistory ? state.loadOrderHistory() : [];
    const latestLocal = localOrders[0] || null;
    const accountEmail = profile.email || orderEmail(latestLocal);
    const accountOrderCode = latestLocal && (latestLocal.orderCode || latestLocal.id);
    const account = await fetchSignedInAccount() || await fetchAccount(accountEmail, accountOrderCode);
    if (account && account.customer && state.saveProfile) {
      state.saveProfile(account.customer);
      profile = state.loadProfile ? state.loadProfile() : profile;
    }
    const backendOrders = account && account.orders.length ? account.orders : await fetchOrders(localOrders);
    const orders = backendOrders.length ? backendOrders : localOrders.map(normalizeOrder).filter(Boolean);
    const favorites = state.loadFavorites ? state.loadFavorites() : [];
    bindAccountLookup();

    const latestOrder = orders[0] || {};
    document.getElementById('accountName').textContent = profile.name || latestOrder.customer && latestOrder.customer.name || 'Suvera Uyesi';
    document.getElementById('accountEmail').textContent = profile.email || latestOrder.customer && latestOrder.customer.email || 'E-posta eklendiginde burada gorunur';
    document.getElementById('accountPhone').textContent = profile.phone || latestOrder.customer && latestOrder.customer.phone || 'Telefon bilgisi eklenmedi';

    document.getElementById('accountStats').innerHTML =
      '<div class="page-stat">Toplam siparis: ' + orders.length + '</div>' +
      '<div class="page-stat">Favori urun: ' + favorites.length + '</div>' +
      '<div class="page-stat">Son durum: ' + escapeHtml(orderStatusLabel(latestOrder.status)) + '</div>';

    const ordersNode = document.getElementById('accountOrders');
    if (!orders.length) {
      ordersNode.innerHTML = '<div class="page-empty">Hesabinizda gorunecek ilk siparis, checkout sonrasi otomatik olarak burada listelenir.</div>';
    } else {
      ordersNode.innerHTML = orders.map(function (order) {
        return '<div class="page-order-card"><strong>' + escapeHtml(order.orderCode || order.id || 'Siparis') + '</strong><p>' +
          escapeHtml(order.customer && order.customer.name || 'Musteri bilgisi yok') + '</p><p>Durum: ' +
          escapeHtml(orderStatusLabel(order.status)) + '</p><p>Toplam: ' + money(order.total || 0) +
          '</p><div class="page-inline-actions"><a class="page-btn-secondary" href="siparis-takip?order=' +
          encodeURIComponent(order.orderCode || order.id || '') + '">Takip Et</a></div></div>';
      }).join('');
    }

    const favoritesNode = document.getElementById('accountFavorites');
    if (!favorites.length) {
      favoritesNode.innerHTML = '<div class="page-empty">Henuz favori eklemediniz. Urun detaylarindaki kalp butonuyla kayda baslayabilirsiniz.</div>';
    } else {
      favoritesNode.innerHTML = favorites.slice(0, 4).map(function (item) {
        const media = item.image
          ? '<img src="' + escapeHtml(assetUrl(item.image)) + '" alt="' + escapeHtml(item.name) + '" loading="lazy" decoding="async"/>'
          : escapeHtml(item.emoji || 'SU');
        return '<div class="page-favorite-card"><div class="page-favorite-media">' + media + '</div><h3>' +
          escapeHtml(item.name) + '</h3><p>' + money(item.price || 0) + '</p><a class="page-btn-secondary" href="' +
          escapeHtml(safeHref(item.url, 'urun')) + '">Incele</a></div>';
      }).join('');
    }
  }

  function bindAccountLookup() {
    const form = document.getElementById('accountLookupForm');
    if (!form || form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';

    const state = getState();
    const profile = state.loadProfile ? state.loadProfile() : {};
    const latestOrder = state.getLastOrder ? state.getLastOrder() : null;
    const emailInput = document.getElementById('accountLookupEmail');
    const orderInput = document.getElementById('accountLookupOrder');
    const message = document.getElementById('accountLookupMessage');

    if (emailInput) emailInput.value = profile.email || orderEmail(latestOrder);
    if (orderInput && latestOrder) orderInput.value = latestOrder.orderCode || latestOrder.id || '';

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const email = emailInput ? emailInput.value.trim() : '';
      const orderCode = orderInput ? orderInput.value.trim() : '';
      if (message) {
        message.style.display = 'block';
        message.textContent = 'Hesap bilgisi yukleniyor.';
      }

      const account = await fetchAccount(email, orderCode);
      if (!account) {
        if (message) message.textContent = 'Bu e-posta ve siparis kodu ile hesap bulunamadi.';
        return;
      }

      if (state.saveProfile) state.saveProfile(account.customer);
      if (state.recordOrder) {
        account.orders.forEach(function (order) {
          state.recordOrder(order);
        });
      }
      if (message) message.textContent = 'Hesap bilgisi guncellendi.';
      await renderAccount();
    });
  }

  async function renderFavorites() {
    const root = document.getElementById('favoritesPage');
    if (!root) return;

    const state = getState();
    if (state.syncFavoritesFromServer) {
      await state.syncFavoritesFromServer();
    }
    const favorites = state.loadFavorites ? state.loadFavorites() : [];
    const grid = document.getElementById('favoritesGrid');
    const count = document.getElementById('favoritesCount');

    count.textContent = String(favorites.length);

    if (!favorites.length) {
      grid.innerHTML = '<div class="page-empty">Kayitli favoriniz henuz yok. Urun listesinde veya detay sayfasinda kalp ikonuna basarak bu alani doldurabilirsiniz.</div>';
      return;
    }

    grid.innerHTML = favorites.map(function (item) {
      const media = item.image
        ? '<img src="' + escapeHtml(assetUrl(item.image)) + '" alt="' + escapeHtml(item.name) + '" loading="lazy" decoding="async"/>'
        : escapeHtml(item.emoji || 'SU');
      return '<article class="page-favorite-card" data-favorite-id="' + escapeHtml(item.id || item.name) + '">' +
        '<div class="page-favorite-media">' + media + '</div>' +
        '<h3>' + escapeHtml(item.name) + '</h3>' +
        '<p>' + money(item.price || 0) + '</p>' +
        '<div class="page-inline-actions"><a class="page-btn-secondary" href="' + escapeHtml(safeHref(item.url, 'urun')) +
        '">Urunu Ac</a><button class="page-btn" type="button" data-remove-favorite="' + escapeHtml(item.id || item.name) +
        '">Kaldir</button></div></article>';
    }).join('');

    grid.querySelectorAll('[data-remove-favorite]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (!state.toggleFavorite) return;
        state.toggleFavorite({ id: button.getAttribute('data-remove-favorite') });
        renderFavorites();
        if (state.refreshWishlistButtons) state.refreshWishlistButtons();
        if (state.toast) state.toast('Favori listesinden kaldirildi', 'dark');
      });
    });
  }

  async function renderBlog() {
    const root = document.getElementById('blogPage');
    if (!root) return;

    const grid = document.getElementById('blogPostsGrid');
    if (!grid || !window.SuveraAPI || !window.SuveraAPI.blog) return;

    try {
      const posts = await window.SuveraAPI.blog.list();
      if (!posts || !posts.length) {
        grid.innerHTML = '<div class="page-empty">Blog yazilari Panelya panelinden yayinlandiginda burada gorunur.</div>';
        return;
      }

      grid.innerHTML = posts.map(function (post, index) {
        const image = post.image_url ? assetUrl(post.image_url) : '';
        const media = image
          ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(post.title) + '" loading="lazy" decoding="async"/>'
          : String(index + 1).padStart(2, '0');
        return '<article class="page-blog-card" onclick="location.href=\'' + escapeHtml(blogUrl(post)) + '\'"><div class="page-blog-media">' + media + '</div><span class="page-badge good">' +
          escapeHtml(publishedLabel(post.published_at)) + '</span><h3>' +
          escapeHtml(post.title) + '</h3><p>' + escapeHtml(post.excerpt || 'Suvera blog yazisi') +
          '</p><div class="page-inline-actions"><a class="page-btn-secondary" href="' + escapeHtml(blogUrl(post)) + '">Yazıyı oku</a></div></article>';
      }).join('');
    } catch (err) {
      grid.innerHTML = '<div class="page-empty">Blog yazilari yuklenemedi. Lutfen daha sonra tekrar deneyin.</div>';
    }
  }

  async function renderBlogDetail() {
    const root = document.getElementById('blogDetailPage');
    if (!root) return;
    const params = new URLSearchParams(location.search);
    const id = params.get('id') || params.get('slug') || '';
    const title = document.getElementById('blogDetailTitle');
    const excerpt = document.getElementById('blogDetailExcerpt');
    const meta = document.getElementById('blogDetailMeta');
    const hero = document.getElementById('blogDetailHero');
    const body = document.getElementById('blogDetailBody');
    const breadcrumb = document.getElementById('blogDetailBreadcrumb');
    const aside = document.getElementById('blogDetailAside');

    if (!id || !window.SuveraAPI || !window.SuveraAPI.blog || !window.SuveraAPI.blog.get) {
      if (body) body.innerHTML = '<div class="page-empty">Blog yazısı bulunamadı.</div>';
      return;
    }

    try {
      let post = null;
      if (window.SuveraAPI.blog.get) {
        post = await window.SuveraAPI.blog.get(id).catch(function () { return null; });
      }
      if (!post && window.SuveraAPI.blog.list) {
        const posts = await window.SuveraAPI.blog.list();
        post = (posts || []).find(function (item) {
          return String(item.id) === String(id) || String(item.slug || '') === String(id);
        });
      }
      if (!post) throw new Error('Blog yazısı bulunamadı');
      const image = post.image_url ? assetUrl(post.image_url) : '';
      const pageTitle = post.title || 'Suvera Blog';
      const pageExcerpt = post.excerpt || 'Suvera stil, bakım ve seçki rehberi.';
      if (title) title.textContent = pageTitle;
      if (excerpt) excerpt.textContent = pageExcerpt;
      if (meta) meta.textContent = publishedLabel(post.published_at) + ' • Suvera İçerik Merkezi';
      if (breadcrumb) breadcrumb.innerHTML = '<a href="anasayfa">Ana Sayfa</a><span>›</span><a href="blog">Blog</a><span>›</span><span>' + escapeHtml(pageTitle) + '</span>';
      if (hero) {
        hero.innerHTML = image
          ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(pageTitle) + '" decoding="async" />'
          : '<div class="blog-detail-fallback">Suvera</div>';
      }
      if (body) body.innerHTML = blogArticleHtml(post.content);
      if (aside) {
        aside.innerHTML = '<div class="page-check"><strong>Okuma önerisi</strong><span>Bu yazıdaki bakım ve stil önerilerini ürün detayındaki ölçü bilgileriyle birlikte değerlendirin.</span></div>' +
          '<div class="page-check"><strong>Sonraki adım</strong><span>İlgili ürünleri inceleyerek kombini tamamlayabilirsiniz.</span></div>';
      }

      document.title = pageTitle + ' | Suvera Blog';
      if (window.SuveraSEO) {
        const path = 'blog-detay?id=' + encodeURIComponent(post.id || id);
        window.SuveraSEO.applyPageMeta({
          title: pageTitle + ' | Suvera Blog',
          description: pageExcerpt,
          path,
          image: image || window.SuveraSEO.defaultImage,
          type: 'article',
        });
      }
    } catch (err) {
      if (body) body.innerHTML = '<div class="page-empty">Blog yazısı yüklenemedi. Lütfen blog listesine geri dönün.</div>';
    }
  }

  async function renderSearch() {
    const root = document.getElementById('searchPage');
    if (!root) return;

    const params = new URLSearchParams(location.search);
    const query = (params.get('q') || '').trim();
    const categoryId = params.get('category_id') || '';
    const color = params.get('color') || '';
    const size = params.get('size') || '';
    const minPrice = Number(params.get('min_price') || 0);
    const maxPrice = Number(params.get('max_price') || 0);
    const input = document.getElementById('searchInput');
    const categorySelect = document.getElementById('searchCategory');
    const colorSelect = document.getElementById('searchColor');
    const sizeSelect = document.getElementById('searchSize');
    const minPriceInput = document.getElementById('searchMinPrice');
    const maxPriceInput = document.getElementById('searchMaxPrice');
    const label = document.getElementById('searchQueryLabel');
    const resultsNode = document.getElementById('searchResultsGrid');
    const countNode = document.getElementById('searchResultCount');

    input.value = query;
    if (minPriceInput && minPrice > 0) minPriceInput.value = String(minPrice);
    if (maxPriceInput && maxPrice > 0) maxPriceInput.value = String(maxPrice);
    label.textContent = query || 'Tum secki';

    if (window.SuveraSEO) {
      window.SuveraSEO.applyPageMeta({
        title: query ? query + ' arama sonuclari | Suvera' : 'Arama | Suvera',
        description: query
          ? 'Suvera urunleri icinde "' + query + '" arama sonuclari.'
          : 'Suvera koleksiyonunda urun arayin ve filtreleyin.',
        path: 'arama' + (query ? '?q=' + encodeURIComponent(query) : ''),
      });
      window.SuveraSEO.applyBaseSchemas({
        path: 'arama' + (query ? '?q=' + encodeURIComponent(query) : ''),
        name: query ? query + ' arama sonuclari | Suvera' : 'Arama | Suvera',
        description: query
          ? 'Suvera urunleri icinde "' + query + '" arama sonuclari.'
          : 'Suvera koleksiyonunda urun arayin ve filtreleyin.',
      });
    }

    if (!window.SuveraAPI) {
      resultsNode.innerHTML = '<div class="page-empty">Arama servisi su anda hazir degil. Lutfen daha sonra tekrar deneyin.</div>';
      countNode.textContent = '0';
      return;
    }

    try {
      const categories = await window.SuveraAPI.categories.list().catch(function () { return []; });
      const productQuery = new URLSearchParams({ status: 'active', limit: '128' });
      if (query) productQuery.set('q', query);
      if (/^\d+$/.test(categoryId)) productQuery.set('category_id', categoryId);
      // FIX: Let the API apply supported search filters before client-side faceting.
      const items = await window.SuveraAPI.products.list('?' + productQuery.toString());
      const availableColors = uniqueSorted((items || []).flatMap(function (item) { return Array.isArray(item.colors) ? item.colors : []; }));
      const availableSizes = uniqueSorted((items || []).flatMap(function (item) { return Array.isArray(item.sizes) ? item.sizes : []; }));

      if (categorySelect) {
        categorySelect.innerHTML = optionHtml('', 'Tum kategoriler', categoryId) + (categories || []).map(function (category) {
          return optionHtml(category.id, category.name, categoryId);
        }).join('');
      }
      if (colorSelect) {
        colorSelect.innerHTML = optionHtml('', 'Tum renkler', color) + availableColors.map(function (item) {
          return optionHtml(item, item, color);
        }).join('');
      }
      if (sizeSelect) {
        sizeSelect.innerHTML = optionHtml('', 'Tum bedenler', size) + availableSizes.map(function (item) {
          return optionHtml(item, item, size);
        }).join('');
      }

      const matches = (items || []).filter(function (item) {
        const price = productFinalPrice(item);
        return (!query || productMatches(item, query))
          && (!categoryId || String(item.category_id || '') === String(categoryId))
          && productHasValue(item, 'colors', color)
          && productHasValue(item, 'sizes', size)
          && (!minPrice || price >= minPrice)
          && (!maxPrice || price <= maxPrice);
      });

      countNode.textContent = String(matches.length);

      if (!matches.length) {
        resultsNode.innerHTML = '<div class="page-empty">Aradiginiz ifade icin sonuca ulasilamadi. Daha genel bir kelimeyle tekrar deneyebilirsiniz.</div>';
        return;
      }

      resultsNode.innerHTML = matches.map(function (item) {
        const image = productImage(item);
        const media = image
          ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(item.name) + '" loading="lazy" decoding="async"/>'
          : escapeHtml(item.emoji || 'SU');
        const finalPrice = productFinalPrice(item);
        return '<article class="page-result-card"><div class="page-result-media">' + media + '</div><span class="page-badge good">' +
          escapeHtml(item.category_name || 'Secki') + '</span><h3>' + escapeHtml(item.name) + '</h3><p>' +
          escapeHtml(item.tags || 'Suvera katalog urunu') + '</p><div class="page-inline-actions"><a class="page-btn-secondary" href="urun?id=' +
          encodeURIComponent(item.id) + '">Incele</a><button class="page-btn" type="button" data-search-add="' +
          escapeHtml(item.id) + '">Sepete Ekle</button><span class="page-badge warn">' + money(finalPrice) +
          '</span></div></article>';
      }).join('');

      resultsNode.querySelectorAll('[data-search-add]').forEach(function (button) {
        button.addEventListener('click', function () {
          const id = button.getAttribute('data-search-add');
          const item = matches.find(function (product) { return String(product.id) === String(id); });
          if (!item) return;
          if (window.addApiProductToCart) {
            window.addApiProductToCart(id);
            return;
          }
          if (window.Suvera) {
            window.Suvera.addToCart(item.name, productFinalPrice(item), item.emoji || 'SU', {
              id: item.id,
              product_id: item.id,
              image: productImage(item),
            });
          }
        });
      });
    } catch (err) {
      resultsNode.innerHTML = '<div class="page-empty">Arama sonuclari yuklenemedi. Lutfen kisa sure sonra tekrar deneyin.</div>';
      countNode.textContent = '0';
    }
  }

  async function renderTracking() {
    const root = document.getElementById('trackingPage');
    if (!root) return;

    const state = getState();
    const history = state.loadOrderHistory ? state.loadOrderHistory() : [];
    const params = new URLSearchParams(location.search);
    const initialCode = params.get('order') || '';
    const initialLocalOrder = history.find(function (item) {
      return String(item.orderCode || item.id || '').toLocaleLowerCase('tr-TR') === initialCode.toLocaleLowerCase('tr-TR');
    });
    const input = document.getElementById('trackingOrderInput');
    const emailInput = document.getElementById('trackingEmailInput');
    const result = document.getElementById('trackingResult');

    async function paint(orderCode, email) {
      if (!orderCode) {
        result.innerHTML = '<div class="page-empty">Siparis kodunuzu ve e-posta adresinizi yazarak durum takibini burada gorebilirsiniz.</div>';
        return;
      }
      if (!email) {
        result.innerHTML = '<div class="page-warning-banner">Siparis durumunu gorebilmek icin sipariste kullandiginiz e-posta adresini girin.</div>';
        return;
      }

      const backendOrder = await fetchOrder(orderCode, email);
      const localOrder = history.find(function (item) {
        return String(item.orderCode || item.id || '').toLocaleLowerCase('tr-TR') === orderCode.toLocaleLowerCase('tr-TR')
          && orderEmail(item).toLocaleLowerCase('tr-TR') === email.toLocaleLowerCase('tr-TR');
      });
      const match = backendOrder || normalizeOrder(localOrder);

      if (!match) {
        result.innerHTML = '<div class="page-warning-banner">Bu siparis kodu ve e-posta ile eslesen kayit bulunamadi. Bilgileri kontrol ederek tekrar deneyin.</div>';
        return;
      }

      result.innerHTML = '<div class="page-kv-grid"><div class="page-kv"><small>Siparis</small><strong>' +
        escapeHtml(match.orderCode || match.id || '-') + '</strong></div><div class="page-kv"><small>Durum</small><strong>' +
        escapeHtml(orderStatusLabel(match.status)) + '</strong></div><div class="page-kv"><small>Musteri</small><strong>' +
        escapeHtml(match.customer && match.customer.name || '-') + '</strong></div><div class="page-kv"><small>Toplam</small><strong>' +
        money(match.total || 0) + '</strong></div></div><div class="page-info-banner" style="margin-top:16px;">' +
        (match.tracking_number
          ? 'Kargo: <strong>' + escapeHtml(match.shipping_company || 'Hazirlaniyor') + '</strong> • Takip No: <strong>' + escapeHtml(match.tracking_number) + '</strong>' +
            trackingLink(match.tracking_url)
          : escapeHtml(orderStatusNote(match))) +
        '</div>' +
        (isIbanOrder(match) ? ibanInfoHtml(match.orderCode || match.id) : '');
    }

    input.value = initialCode;
    if (emailInput) emailInput.value = orderEmail(initialLocalOrder);
    await paint(initialCode, emailInput ? emailInput.value.trim() : '');

    document.getElementById('trackingForm').addEventListener('submit', async function (event) {
      event.preventDefault();
      await paint(input.value.trim(), emailInput ? emailInput.value.trim() : '');
    });
  }

  function bindSupportForms() {
    [
      ['contactForm', 'Mesajiniz kaydedildi. Suvera destek ekibi en kisa surede donus yapacak.'],
      ['returnRequestForm', 'Iade veya degisim talebiniz not edildi. Siparis kodunuzla birlikte destek ekibi sizi yonlendirecek.'],
      ['passwordResetForm', 'Sifre sifirlama baglantisi hazir durumda. Canli entegrasyonda e-posta servisine baglanacak.'],
    ].forEach(function (entry) {
      const form = document.getElementById(entry[0]);
      if (!form) return;
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (window.showToast) window.showToast(entry[1], 'green');
      });
    });

    const searchForm = document.getElementById('searchForm');
    if (searchForm) {
      searchForm.addEventListener('submit', function (event) {
        event.preventDefault();
        const next = new URLSearchParams();
        const query = document.getElementById('searchInput').value.trim();
        const category = document.getElementById('searchCategory') && document.getElementById('searchCategory').value;
        const color = document.getElementById('searchColor') && document.getElementById('searchColor').value;
        const size = document.getElementById('searchSize') && document.getElementById('searchSize').value;
        const minPrice = document.getElementById('searchMinPrice') && document.getElementById('searchMinPrice').value;
        const maxPrice = document.getElementById('searchMaxPrice') && document.getElementById('searchMaxPrice').value;
        if (query) next.set('q', query);
        if (category) next.set('category_id', category);
        if (color) next.set('color', color);
        if (size) next.set('size', size);
        if (minPrice) next.set('min_price', minPrice);
        if (maxPrice) next.set('max_price', maxPrice);
        location.href = 'arama' + (next.toString() ? '?' + next.toString() : '');
      });
    }
  }

  async function init() {
    await renderThankYou();
    await renderAccount();
    await renderFavorites();
    await renderTracking();
    await renderBlog();
    await renderBlogDetail();
    renderSearch();
    bindSupportForms();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
