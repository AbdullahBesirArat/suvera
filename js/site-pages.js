import { formatMoney as money, escapeHtml, resolveAssetUrl as assetUrl, parseImageEntry, safeHref, productFinalPrice } from './core/storefront-utils.js';
(function () {
  'use strict';

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
        orderItemId: item.order_item_id || item.orderItemId || '',
        variantId: item.variant_id || item.variantId || '',
        name: item.name || 'Urun',
        qty: Number(item.qty || item.quantity || 1),
        quantity: Number(item.qty || item.quantity || 1),
        price: Number(item.price || item.unit_price || 0),
        unit_price: Number(item.price || item.unit_price || 0),
        variant: item.variant || item.size || 'Standart',
        selectedColor: item.selected_color || item.selectedColor || '',
        selectedSize: item.selected_size || item.selectedSize || '',
        sku: item.sku || '',
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
      shipments: Array.isArray(raw.shipments) ? raw.shipments : [],
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
      return '<div class="page-warning-banner" data-css="margin-top:16px;"><strong>IBAN bilgileri yapılandırılmadı.</strong><br/>Lütfen ödeme için Suvera destek ekibiyle iletişime geçin. Sipariş kodunuz: <strong>' +
        escapeHtml(orderCode || '-') + '</strong></div>';
    }

    return '<div class="page-info-banner" data-css="margin-top:16px;"><strong>IBAN / havale bilgileri</strong><br/>' +
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
    const root = document.querySelector('[data-page-root="thankYouPage"]');
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
        ? '<div class="page-info-banner" data-css="margin-top:16px;">Kargo: <strong>' + escapeHtml(effectiveOrder.shipping_company || 'Hazirlaniyor') + '</strong>' +
          (effectiveOrder.tracking_number ? ' • Takip No: <strong>' + escapeHtml(effectiveOrder.tracking_number) + '</strong>' : '') +
          trackingLink(effectiveOrder.tracking_url) +
          '</div>'
        : '');
  }

  async function renderAccount() {
    const root = document.querySelector('[data-page-root="accountPage"]');
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
          '</p>' + shipmentCards(order.shipments) + '<div class="page-inline-actions"><a class="page-btn-secondary" href="siparis-takip?order=' +
          encodeURIComponent(order.orderCode || order.id || '') + '">Takip Et</a></div></div>';
      }).join('');
    }

    await renderCustomerReturns(orders);

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

  function shipmentStatusLabel(status) {
    return {
      pending: 'Hazirlaniyor', label_ready: 'Etiket hazir', shipped: 'Kargoya verildi',
      in_transit: 'Yolda', delivered: 'Teslim edildi', failed: 'Teslimat sorunu',
      cancelled: 'Iptal edildi', returned: 'Geri dondu',
    }[String(status || '')] || 'Hazirlaniyor';
  }

  function shipmentCards(shipments) {
    return (shipments || []).map(function (shipment) {
      return '<div class="page-info-banner" data-css="margin-top:12px;"><strong>' +
        escapeHtml(shipment.is_return ? 'Iade gonderisi' : shipment.carrier_name || 'Kargo') + '</strong> · ' +
        escapeHtml(shipmentStatusLabel(shipment.status)) +
        (shipment.tracking_number ? '<br/>Takip No: <strong>' + escapeHtml(shipment.tracking_number) + '</strong>' : '') +
        trackingLink(shipment.tracking_url) + '</div>';
    }).join('');
  }

  function returnStatusLabel(status) {
    return {
      requested: 'Incelemede',
      approved: 'Onaylandi',
      rejected: 'Reddedildi',
      awaiting_shipment: 'Kargo bekleniyor',
      in_transit: 'Yolda',
      received: 'Teslim alindi',
      inspected: 'Kontrol edildi',
      resolved: 'Sonuclandi',
      cancelled: 'Iptal edildi',
    }[String(status || '')] || 'Islemde';
  }

  async function renderCustomerReturns(orders) {
    const api = window.SuveraAPI;
    const listNode = document.getElementById('accountReturns');
    const message = document.getElementById('returnRequestMessage');
    const form = document.getElementById('returnRequestForm');
    if (!listNode || !form) return;

    form._returnOrders = (orders || []).filter(function (order) {
      return /^\d+$/.test(String(order.id || '')) && order.items.some(function (item) {
        return /^\d+$/.test(String(item.orderItemId || ''));
      });
    });
    bindReturnRequestForm(form);
    populateReturnOrderOptions(form);

    if (!api || !api.customerToken || !api.customerToken()) {
      listNode.innerHTML = '<div class="page-empty">Taleplerinizi gormek ve yeni talep olusturmak icin <a href="giris">hesabiniza giris yapin</a>.</div>';
      if (message) message.textContent = 'Iade talebi olusturmak icin musteri hesabinizla giris yapmalisiniz.';
      return;
    }
    try {
      const requests = await api.returns.list();
      listNode.innerHTML = requests.length ? requests.map(function (request) {
        return '<div class="page-order-card"><strong>' + escapeHtml(request.order_code || 'Talep') + '</strong>' +
          '<p>' + escapeHtml({ return: 'Iade', exchange: 'Degisim', cancellation: 'Iptal' }[request.request_type] || request.request_type) +
          ' · ' + escapeHtml(returnStatusLabel(request.status)) + '</p>' +
          '<p>Sebep: ' + escapeHtml(request.reason_code || '-') + '</p>' +
          (request.resolution ? '<p>Sonuc: ' + escapeHtml(request.resolution) + '</p>' : '') +
          '</div>';
      }).join('') : '<div class="page-empty">Henuz iade, degisim veya iptal talebiniz yok.</div>';
      if (message) message.textContent = 'Talep ve durum bilgileri hesabinizla guvenli bicimde eslestirilir.';
    } catch (err) {
      listNode.innerHTML = '<div class="page-empty">Talep durumu su anda yuklenemedi.</div>';
      if (message) message.textContent = (err && err.message) || 'Iade bilgileri yuklenemedi.';
    }
  }

  function populateReturnOrderOptions(form) {
    const select = document.getElementById('returnOrder');
    if (!select) return;
    const current = select.value;
    const options = form._returnOrders || [];
    select.innerHTML = '<option value="">Siparis secin</option>' + options.map(function (order) {
      return '<option value="' + escapeHtml(order.id) + '">' + escapeHtml(order.orderCode || order.id) +
        ' · ' + escapeHtml(orderStatusLabel(order.status)) + '</option>';
    }).join('');
    if (options.some(function (order) { return String(order.id) === current; })) select.value = current;
    renderReturnOrderItems(form);
  }

  function renderReturnOrderItems(form) {
    const select = document.getElementById('returnOrder');
    const container = document.getElementById('returnItems');
    if (!select || !container) return;
    const order = (form._returnOrders || []).find(function (item) { return String(item.id) === select.value; });
    if (!order) {
      container.innerHTML = 'Siparis sectiginizde uygun kalemler burada gorunur.';
      return;
    }
    container.innerHTML = order.items.filter(function (item) {
      return /^\d+$/.test(String(item.orderItemId || ''));
    }).map(function (item) {
      return '<label class="page-check" style="align-items:center;"><input type="checkbox" data-return-item="' +
        escapeHtml(item.orderItemId) + '" checked /> <span><strong>' + escapeHtml(item.name) + '</strong><br/>' +
        escapeHtml([item.selectedColor, item.selectedSize, item.sku].filter(Boolean).join(' · ')) +
        '</span><input type="number" data-return-quantity="' + escapeHtml(item.orderItemId) +
        '" min="1" max="' + Number(item.quantity || 1) + '" value="' + Number(item.quantity || 1) + '" aria-label="Talep adedi" /></label>';
    }).join('');
  }

  function bindReturnRequestForm(form) {
    if (form.dataset.bound === 'true') return;
    form.dataset.bound = 'true';
    const orderSelect = document.getElementById('returnOrder');
    if (orderSelect) orderSelect.addEventListener('change', function () { renderReturnOrderItems(form); });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      const api = window.SuveraAPI;
      const message = document.getElementById('returnRequestMessage');
      if (!api || !api.customerToken || !api.customerToken()) {
        if (message) message.innerHTML = 'Talep olusturmak icin <a href="giris">giris yapin</a>.';
        return;
      }
      const orderId = document.getElementById('returnOrder').value;
      const requestType = document.getElementById('returnType').value;
      const reasonCode = document.getElementById('returnReason').value;
      const customerNote = document.getElementById('returnNote').value.trim();
      const selected = Array.from(document.querySelectorAll('[data-return-item]:checked'));
      const items = selected.map(function (checkbox) {
        const orderItemId = checkbox.getAttribute('data-return-item');
        const quantity = document.querySelector('[data-return-quantity="' + CSS.escape(orderItemId) + '"]');
        return {
          order_item_id: Number(orderItemId),
          quantity: Number(quantity && quantity.value || 1),
          reason_code: reasonCode,
          requested_resolution: requestType === 'exchange' ? 'exchange' : 'refund',
        };
      });
      if (!orderId || !items.length) {
        if (message) message.textContent = 'Siparis ve en az bir kalem secin.';
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      if (message) message.textContent = 'Talebiniz kaydediliyor.';
      try {
        await api.returns.create({
          order_id: Number(orderId), type: requestType, reason_code: reasonCode,
          customer_note: customerNote, items: items,
        });
        form.reset();
        renderReturnOrderItems(form);
        if (message) message.textContent = 'Talebiniz alindi. Durumunu bu sayfadan takip edebilirsiniz.';
        await renderCustomerReturns(form._returnOrders || []);
      } catch (err) {
        if (message) message.textContent = (err && err.message) || 'Talep olusturulamadi.';
      } finally {
        if (button) button.disabled = false;
      }
    });
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
    const root = document.querySelector('[data-page-root="favoritesPage"]');
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
    const root = document.querySelector('[data-page-root="blogPage"]');
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
        return '<article class="page-blog-card" data-nav="' + escapeHtml(blogUrl(post)) + '"><div class="page-blog-media">' + media + '</div><span class="page-badge good">' +
          escapeHtml(publishedLabel(post.published_at)) + '</span><h3>' +
          escapeHtml(post.title) + '</h3><p>' + escapeHtml(post.excerpt || 'Suvera blog yazisi') +
          '</p><div class="page-inline-actions"><a class="page-btn-secondary" href="' + escapeHtml(blogUrl(post)) + '">Yazıyı oku</a></div></article>';
      }).join('');
    } catch (err) {
      grid.innerHTML = '<div class="page-empty">Blog yazilari yuklenemedi. Lutfen daha sonra tekrar deneyin.</div>';
    }
  }

  async function renderBlogDetail() {
    const root = document.querySelector('[data-page-root="blogDetailPage"]');
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
    const root = document.querySelector('[data-page-root="searchPage"]');
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
    const root = document.querySelector('[data-page-root="trackingPage"]');
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
        money(match.total || 0) + '</strong></div></div><div class="page-info-banner" data-css="margin-top:16px;">' +
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

  // ── A25: customer address book (hesabim) ─────────────────────
  function titleCaseAddress(value) {
    return String(value || '')
      .toLocaleLowerCase('tr-TR')
      .replace(/(^|[\s/-])\S/g, function (part) { return part.toLocaleUpperCase('tr-TR'); });
  }

  let addressBookCities = [];
  let addressBookCache = [];
  let addressBookBound = false;

  async function populateAddressCities(preferred) {
    const select = document.getElementById('addressCity');
    if (!select || !window.SuveraAddressData) return;
    try {
      addressBookCities = await window.SuveraAddressData.loadCities();
      select.innerHTML = '<option value="">İl seçin</option>' + addressBookCities.map(function (city) {
        const name = titleCaseAddress(city.name);
        return '<option value="' + escapeHtml(name) + '" data-city-id="' + escapeHtml(city.id) + '">' + escapeHtml(name) + '</option>';
      }).join('');
      if (preferred) select.value = preferred;
    } catch (err) {
      select.innerHTML = '<option value="">İller yüklenemedi</option>';
    }
  }

  async function populateAddressDistricts(preferred) {
    const citySelect = document.getElementById('addressCity');
    const districtSelect = document.getElementById('addressDistrict');
    if (!citySelect || !districtSelect || !window.SuveraAddressData) return;
    const selectedCity = citySelect.value;
    districtSelect.value = '';
    districtSelect.disabled = true;
    if (!selectedCity) {
      districtSelect.innerHTML = '<option value="">Önce il seçin</option>';
      return;
    }
    districtSelect.innerHTML = '<option value="">İlçeler yükleniyor</option>';
    try {
      const selectedOption = citySelect.options[citySelect.selectedIndex];
      const districts = await window.SuveraAddressData.loadDistricts((selectedOption && selectedOption.dataset.cityId) || selectedCity);
      districtSelect.innerHTML = '<option value="">İlçe seçin</option>' + districts.map(function (district) {
        const name = titleCaseAddress(district.name);
        return '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
      }).join('');
      districtSelect.disabled = false;
      if (preferred) districtSelect.value = preferred;
    } catch (err) {
      districtSelect.innerHTML = '<option value="">İlçeler yüklenemedi</option>';
    }
  }

  function addressSummaryLine(address) {
    return [address.address_line1, address.neighborhood, address.district, address.city]
      .map(function (part) { return String(part || '').trim(); })
      .filter(Boolean)
      .join(', ');
  }

  function renderAddressList(addresses) {
    const listNode = document.getElementById('addressBookList');
    if (!listNode) return;
    if (!addresses.length) {
      listNode.innerHTML = '<div class="page-empty">Henüz kayıtlı adresiniz yok. Yeni adres ekleyerek başlayın.</div>';
      return;
    }
    listNode.innerHTML = addresses.map(function (address) {
      const badges = [];
      if (address.is_default_shipping) badges.push('<span class="page-stat">Varsayılan teslimat</span>');
      if (address.is_default_billing) badges.push('<span class="page-stat">Varsayılan fatura</span>');
      const actions = [
        '<button class="page-btn-secondary" type="button" data-address-edit="' + escapeHtml(address.id) + '">Düzenle</button>',
        address.is_default_shipping ? '' : '<button class="page-btn-secondary" type="button" data-address-default="' + escapeHtml(address.id) + '" data-kind="shipping">Teslimat varsayılanı</button>',
        address.is_default_billing ? '' : '<button class="page-btn-secondary" type="button" data-address-default="' + escapeHtml(address.id) + '" data-kind="billing">Fatura varsayılanı</button>',
        '<button class="page-btn-secondary" type="button" data-address-delete="' + escapeHtml(address.id) + '">Sil</button>',
      ].filter(Boolean).join('');
      return '<div class="page-order-card"><strong>' + escapeHtml(address.label || address.recipient || 'Adres') + '</strong>' +
        '<p>' + escapeHtml([address.recipient, address.phone].filter(Boolean).join(' · ')) + '</p>' +
        '<p>' + escapeHtml(addressSummaryLine(address)) + '</p>' +
        (badges.length ? '<div class="page-stats" data-css="margin:8px 0;">' + badges.join('') + '</div>' : '') +
        '<div class="page-inline-actions">' + actions + '</div></div>';
    }).join('');
  }

  function syncAddressCompanyFields() {
    const type = document.getElementById('addressInvoiceType');
    if (!type) return;
    document.querySelectorAll('[data-address-company]').forEach(function (node) { node.hidden = type.value !== 'company'; });
  }

  function resetAddressForm() {
    const form = document.getElementById('addressForm');
    if (!form) return;
    form.reset();
    document.getElementById('addressId').value = '';
    document.getElementById('addressSubmit').textContent = 'Kaydet';
    const message = document.getElementById('addressFormMessage');
    if (message) message.textContent = '';
    syncAddressCompanyFields();
    populateAddressDistricts('');
  }

  async function openAddressForm(address) {
    const form = document.getElementById('addressForm');
    if (!form) return;
    resetAddressForm();
    if (address) {
      document.getElementById('addressId').value = address.id;
      document.getElementById('addressLabel').value = address.label || '';
      document.getElementById('addressRecipient').value = address.recipient || '';
      document.getElementById('addressPhone').value = address.phone || '';
      document.getElementById('addressNeighborhood').value = address.neighborhood || '';
      document.getElementById('addressLine1').value = address.address_line1 || '';
      document.getElementById('addressLine2').value = address.address_line2 || '';
      document.getElementById('addressPostal').value = address.postal_code || '';
      document.getElementById('addressInvoiceType').value = address.invoice_type || 'individual';
      document.getElementById('addressCompany').value = address.company_name || '';
      document.getElementById('addressVkn').value = address.vkn || '';
      document.getElementById('addressTaxOffice').value = address.tax_office || '';
      document.getElementById('addressDefaultShipping').checked = !!address.is_default_shipping;
      document.getElementById('addressDefaultBilling').checked = !!address.is_default_billing;
      document.getElementById('addressSubmit').textContent = 'Güncelle';
      syncAddressCompanyFields();
      document.getElementById('addressCity').value = address.city || '';
      await populateAddressDistricts(address.district || '');
    }
    form.hidden = false;
    document.getElementById('addressRecipient').focus();
  }

  function readAddressForm() {
    return {
      label: document.getElementById('addressLabel').value.trim(),
      recipient: document.getElementById('addressRecipient').value.trim(),
      phone: document.getElementById('addressPhone').value.trim(),
      city: document.getElementById('addressCity').value.trim(),
      district: document.getElementById('addressDistrict').value.trim(),
      neighborhood: document.getElementById('addressNeighborhood').value.trim(),
      address_line1: document.getElementById('addressLine1').value.trim(),
      address_line2: document.getElementById('addressLine2').value.trim(),
      postal_code: document.getElementById('addressPostal').value.trim(),
      invoice_type: document.getElementById('addressInvoiceType').value,
      company_name: document.getElementById('addressCompany').value.trim(),
      vkn: document.getElementById('addressVkn').value.trim(),
      tax_office: document.getElementById('addressTaxOffice').value.trim(),
      is_default_shipping: document.getElementById('addressDefaultShipping').checked,
      is_default_billing: document.getElementById('addressDefaultBilling').checked,
    };
  }

  function bindAddressBook() {
    const card = document.getElementById('addressBookCard');
    if (!card || addressBookBound) return;
    addressBookBound = true;
    const form = document.getElementById('addressForm');
    const addButton = document.getElementById('addressAddButton');
    const cancelButton = document.getElementById('addressCancel');
    const listNode = document.getElementById('addressBookList');
    const invoiceType = document.getElementById('addressInvoiceType');
    const citySelect = document.getElementById('addressCity');

    if (addButton) addButton.addEventListener('click', function () { openAddressForm(null); });
    if (cancelButton) cancelButton.addEventListener('click', function () { resetAddressForm(); if (form) form.hidden = true; });
    if (invoiceType) invoiceType.addEventListener('change', syncAddressCompanyFields);
    if (citySelect) citySelect.addEventListener('change', function () { populateAddressDistricts(''); });

    if (listNode) {
      listNode.addEventListener('click', async function (event) {
        const target = event.target.closest('[data-address-edit],[data-address-delete],[data-address-default]');
        if (!target) return;
        const api = window.SuveraAPI;
        if (target.hasAttribute('data-address-edit')) {
          const id = target.getAttribute('data-address-edit');
          const address = addressBookCache.find(function (item) { return String(item.id) === String(id); });
          if (address) await openAddressForm(address);
          return;
        }
        if (target.hasAttribute('data-address-delete')) {
          const id = target.getAttribute('data-address-delete');
          if (!window.confirm('Bu adresi silmek istiyor musunuz?')) return;
          target.disabled = true;
          try {
            await api.addresses.remove(id);
            await renderAddressBook();
          } catch (err) {
            target.disabled = false;
          }
          return;
        }
        if (target.hasAttribute('data-address-default')) {
          const id = target.getAttribute('data-address-default');
          const kind = target.getAttribute('data-kind') || 'shipping';
          target.disabled = true;
          try {
            await api.addresses.setDefault(id, kind);
            await renderAddressBook();
          } catch (err) {
            target.disabled = false;
          }
        }
      });
    }

    if (form) {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const api = window.SuveraAPI;
        const formMessage = document.getElementById('addressFormMessage');
        const submit = document.getElementById('addressSubmit');
        const id = document.getElementById('addressId').value;
        const payload = readAddressForm();
        if (submit) submit.disabled = true;
        if (formMessage) formMessage.textContent = 'Kaydediliyor...';
        try {
          if (id) await api.addresses.update(id, payload);
          else await api.addresses.create(payload);
          resetAddressForm();
          form.hidden = true;
          await renderAddressBook();
        } catch (err) {
          if (formMessage) formMessage.textContent = (err && err.message) || 'Adres kaydedilemedi.';
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }
  }

  async function renderAddressBook() {
    const card = document.getElementById('addressBookCard');
    if (!card) return;
    const api = window.SuveraAPI;
    const listNode = document.getElementById('addressBookList');
    const message = document.getElementById('addressBookMessage');
    const addButton = document.getElementById('addressAddButton');
    const form = document.getElementById('addressForm');

    if (!api || !api.hasCustomerSession || !api.hasCustomerSession()) {
      if (listNode) listNode.innerHTML = '<div class="page-empty">Adres defterinizi görmek için <a href="giris">giriş yapın</a>.</div>';
      if (message) message.textContent = 'Adresleri görmek ve yönetmek için hesabınıza giriş yapın.';
      if (addButton) addButton.hidden = true;
      if (form) form.hidden = true;
      return;
    }
    if (addButton) addButton.hidden = false;
    if (message) message.textContent = '';

    bindAddressBook();
    await populateAddressCities('');

    try {
      const data = await api.addresses.list();
      addressBookCache = (data && data.addresses) || [];
      renderAddressList(addressBookCache);
    } catch (err) {
      if (listNode) listNode.innerHTML = '<div class="page-empty">Adresler yüklenemedi.</div>';
    }
  }

  // ── A25: guest order -> account linking (hesabim) ────────────
  function stripQueryParam(name) {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has(name)) return;
      url.searchParams.delete(name);
      const query = url.searchParams.toString();
      window.history.replaceState({}, document.title, url.pathname + (query ? '?' + query : '') + url.hash);
    } catch (_) { /* history unavailable */ }
  }

  async function initOrderClaim() {
    const form = document.getElementById('orderClaimForm');
    const message = document.getElementById('orderClaimMessage');
    if (!form) return;
    const api = window.SuveraAPI;

    // Consume ?claim_token from the emailed link: strip it from the URL first (token
    // hygiene — never leave it in history), then confirm only when signed in.
    let claimToken = '';
    try { claimToken = new URLSearchParams(window.location.search).get('claim_token') || ''; } catch (_) {}
    if (claimToken) {
      stripQueryParam('claim_token');
      if (api && api.hasCustomerSession && api.hasCustomerSession()) {
        if (message) message.textContent = 'Sipariş bağlanıyor...';
        try {
          await api.orderClaim.confirm(claimToken);
          if (message) message.textContent = 'Siparişiniz hesabınıza bağlandı. Sipariş geçmişinizde görünecek.';
          await renderAccount();
        } catch (err) {
          if (message) {
            message.textContent = (err && err.status === 409)
              ? 'Bu sipariş başka bir hesaba bağlı.'
              : ((err && err.message) || 'Doğrulama bağlantısı geçersiz veya süresi doldu.');
          }
        }
      } else if (message) {
        message.innerHTML = 'Siparişi bağlamak için önce <a href="giris">giriş yapın</a>, ardından sipariş kodunuzla tekrar deneyin.';
      }
    }

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!api || !api.hasCustomerSession || !api.hasCustomerSession()) {
        if (message) message.innerHTML = 'Sipariş bağlamak için <a href="giris">giriş yapın</a>.';
        return;
      }
      const codeInput = document.getElementById('orderClaimCode');
      const code = codeInput ? codeInput.value.trim() : '';
      if (!code) { if (message) message.textContent = 'Sipariş kodu zorunlu.'; return; }
      const submit = form.querySelector('button[type="submit"]');
      if (submit) submit.disabled = true;
      if (message) message.textContent = 'Doğrulama bağlantısı gönderiliyor...';
      try {
        const result = await api.orderClaim.request(code);
        if (message) message.textContent = (result && result.message) || 'Eğer bu sipariş kodu geçerliyse, siparişin e-posta adresine bir doğrulama bağlantısı gönderildi.';
        form.reset();
      } catch (err) {
        if (message) message.textContent = (err && err.message) || 'İşlem tamamlanamadı.';
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  async function init() {
    await renderThankYou();
    await renderAccount();
    await renderAddressBook();
    await initOrderClaim();
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
