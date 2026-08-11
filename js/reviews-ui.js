// Product reviews + Q&A UI. All user-authored content is rendered via textContent
// (never innerHTML), so a stored review/answer body can never execute as markup.
(function () {
  'use strict';

  const section = document.getElementById('reviewsSection');
  if (!section) return;
  const productId = new URLSearchParams(window.location.search).get('id');
  if (!productId) return;

  const api = () => (window.SuveraAPI && window.SuveraAPI.reviews ? window.SuveraAPI : null);

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function stars(rating) {
    const wrap = el('span', 'review-stars');
    wrap.setAttribute('aria-label', `${rating} / 5`);
    const full = Math.max(0, Math.min(5, Math.round(Number(rating) || 0)));
    wrap.textContent = '★★★★★☆☆☆☆☆'.slice(5 - full, 10 - full);
    return wrap;
  }

  function renderSummary(summary) {
    const box = document.getElementById('reviewsSummary');
    box.textContent = '';
    const count = Number(summary && summary.count) || 0;
    if (!count) {
      box.appendChild(el('p', 'reviews-empty', 'Bu ürün için henüz değerlendirme yok.'));
      return;
    }
    const avg = el('div', 'reviews-average');
    avg.appendChild(el('span', 'reviews-average-num', Number(summary.average).toFixed(1)));
    avg.appendChild(stars(summary.average));
    avg.appendChild(el('span', 'reviews-count', `${count} değerlendirme`));
    box.appendChild(avg);
    // Distribution as text (no JS-set inline styles, so the strict CSP is untouched).
    const dist = el('div', 'reviews-distribution');
    for (let rating = 5; rating >= 1; rating -= 1) {
      const n = (summary.distribution && summary.distribution[rating]) || 0;
      const row = el('div', 'reviews-dist-row');
      row.appendChild(el('span', 'reviews-dist-label', `${rating}★`));
      row.appendChild(el('span', 'reviews-dist-n', `${n} (%${count ? Math.round((n / count) * 100) : 0})`));
      dist.appendChild(row);
    }
    box.appendChild(dist);
  }

  function renderReviews(items) {
    const list = document.getElementById('reviewsList');
    list.textContent = '';
    if (!items || !items.length) return;
    for (const review of items) {
      const card = el('article', 'review-card');
      const head = el('div', 'review-card-head');
      head.appendChild(stars(review.rating));
      if (review.verified_purchase) head.appendChild(el('span', 'review-verified', 'Doğrulanmış alışveriş'));
      head.appendChild(el('span', 'review-author', review.author_name || 'Suvera müşterisi'));
      card.appendChild(head);
      if (review.title) card.appendChild(el('h4', 'review-title', review.title));
      card.appendChild(el('p', 'review-body', review.body));
      const foot = el('div', 'review-card-foot');
      const helpful = el('button', 'review-helpful-btn');
      helpful.type = 'button';
      helpful.dataset.reviewId = String(review.id);
      helpful.dataset.vote = 'helpful';
      helpful.textContent = `Faydalı (${review.helpful_count || 0})`;
      foot.appendChild(helpful);
      card.appendChild(foot);
      list.appendChild(card);
    }
  }

  function renderQuestions(items) {
    const list = document.getElementById('qaList');
    list.textContent = '';
    if (!items || !items.length) {
      list.appendChild(el('p', 'qa-empty', 'Henüz soru yok. İlk soruyu siz sorun.'));
      return;
    }
    for (const question of items) {
      const item = el('div', 'qa-item');
      item.appendChild(el('p', 'qa-question', `S: ${question.body}`));
      for (const answer of question.answers || []) {
        const ans = el('p', 'qa-answer', `C: ${answer.body}`);
        if (answer.is_official) ans.appendChild(el('span', 'qa-official', 'Mağaza yanıtı'));
        item.appendChild(ans);
      }
      list.appendChild(item);
    }
  }

  async function loadReviews() {
    const sdk = api();
    if (!sdk) return;
    try {
      const data = await sdk.reviews.list(productId, '?page_size=20');
      renderSummary(data.summary);
      renderReviews(data.items);
    } catch (_) { /* keep the section quiet on transient errors */ }
  }

  async function loadQuestions() {
    const sdk = api();
    if (!sdk) return;
    try {
      const data = await sdk.questions.list(productId, '?page_size=20');
      renderQuestions(data.items);
    } catch (_) { /* ignore */ }
  }

  function bindRatingInput() {
    const input = document.getElementById('reviewRatingInput');
    if (!input) return 0;
    let selected = 0;
    // A31: role="radio" REQUIRES aria-checked (axe aria-required-attr, critical) and the
    // group itself has to be a named radiogroup, or the rating is just five unrelated
    // buttons whose selected state exists only as a CSS class.
    input.setAttribute('role', 'radiogroup');
    if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', 'Puanınız');
    for (let value = 1; value <= 5; value += 1) {
      const star = el('button', 'review-rating-star', '★');
      star.type = 'button';
      star.dataset.value = String(value);
      star.setAttribute('role', 'radio');
      star.setAttribute('aria-checked', 'false');
      star.setAttribute('aria-label', `${value} yıldız`);
      input.appendChild(star);
    }
    input.addEventListener('click', function (event) {
      const star = event.target.closest('[data-value]');
      if (!star) return;
      selected = Number(star.dataset.value);
      input.querySelectorAll('[data-value]').forEach(function (node) {
        const value = Number(node.dataset.value);
        node.classList.toggle('active', value <= selected);
        // Exactly one radio is checked: the rating chosen, not every star up to it.
        node.setAttribute('aria-checked', value === selected ? 'true' : 'false');
      });
    });
    return () => selected;
  }

  function bindForms() {
    const writeBtn = document.getElementById('reviewWriteBtn');
    const form = document.getElementById('reviewForm');
    const getRating = bindRatingInput();
    if (writeBtn && form) {
      writeBtn.addEventListener('click', function () { form.hidden = !form.hidden; });
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        const msg = document.getElementById('reviewFormMsg');
        const rating = typeof getRating === 'function' ? getRating() : 0;
        const body = document.getElementById('reviewBodyInput').value.trim();
        if (!rating) { msg.textContent = 'Lütfen bir puan seçin.'; return; }
        if (!body) { msg.textContent = 'Lütfen değerlendirmenizi yazın.'; return; }
        try {
          await api().reviews.create(productId, {
            rating, title: document.getElementById('reviewTitleInput').value.trim(), body,
          });
          msg.textContent = 'Değerlendirmeniz alındı ve moderasyon sonrası yayınlanacak.';
          form.reset();
          form.hidden = true;
        } catch (error) {
          if (error && error.status === 401) {
            msg.textContent = 'Değerlendirme için lütfen giriş yapın.';
          } else if (error && error.status === 409) {
            msg.textContent = 'Bu ürün için zaten bir değerlendirmeniz var.';
          } else {
            msg.textContent = 'Değerlendirme gönderilemedi. Lütfen tekrar deneyin.';
          }
        }
      });
    }

    const qaForm = document.getElementById('qaForm');
    if (qaForm) {
      qaForm.addEventListener('submit', async function (event) {
        event.preventDefault();
        const msg = document.getElementById('qaFormMsg');
        const body = document.getElementById('qaBodyInput').value.trim();
        if (!body) { msg.textContent = 'Lütfen sorunuzu yazın.'; return; }
        try {
          await api().questions.ask(productId, { body });
          msg.textContent = 'Sorunuz alındı ve yanıtlandığında yayınlanacak.';
          qaForm.reset();
        } catch (_) {
          msg.textContent = 'Soru gönderilemedi. Lütfen tekrar deneyin.';
        }
      });
    }

    document.getElementById('reviewsList').addEventListener('click', async function (event) {
      const btn = event.target.closest('[data-vote]');
      if (!btn) return;
      btn.disabled = true;
      try {
        const counts = await api().reviews.vote(btn.dataset.reviewId, btn.dataset.vote);
        btn.textContent = `Faydalı (${counts.helpful_count || 0})`;
      } catch (_) {
        btn.disabled = false;
      }
    });
  }

  function init() {
    bindForms();
    void loadReviews();
    void loadQuestions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
