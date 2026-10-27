/* Thiên Khôi CDC — front-end
 * 1. Scroll-driven 3D fly-through hero (image sequence on canvas, cross-faded sub-frames,
 *    mouse parallax tilt, chapters entering/leaving along the Z axis)
 * 2. Nav, reveal-on-scroll, 3D card tilt, lightbox
 * 3. Quote form -> POST /api/leads
 */
(() => {
  'use strict';

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* ================================================================ */
  /* HERO                                                              */
  /* ================================================================ */
  const hero = document.querySelector('[data-hero]');
  if (hero && !reduceMotion) initHero(hero);

  function initHero(hero) {
    const canvas = hero.querySelector('[data-canvas]');
    const ctx = canvas.getContext('2d', { alpha: false });
    const scene = hero.querySelector('[data-scene]');
    const chaps = [...hero.querySelectorAll('[data-chap]')].map((el) => ({
      el,
      in: parseFloat(el.dataset.in),
      out: parseFloat(el.dataset.out),
    }));
    const bar = hero.querySelector('[data-bar]');
    const count = hero.querySelector('[data-count]');
    const dots = [...hero.querySelectorAll('[data-dots] li')];
    const cue = hero.querySelector('[data-cue]');
    const loaderText = hero.querySelector('[data-loader-text]');

    const TOTAL = parseInt(hero.dataset.frames, 10);
    const size = Math.min(innerWidth, innerHeight * 16 / 9) * Math.min(devicePixelRatio || 1, 2) > 1000 ? 'lg' : 'sm';
    const src = (i) => `/assets/frames/${size}/f${String(i + 1).padStart(3, '0')}.webp`;
    const frames = new Array(TOTAL);
    let loadedCount = 0;

    const state = {
      target: 0, // scroll progress 0..1
      progress: 0, // smoothed progress
      mx: 0, my: 0, tmx: 0, tmy: 0, // mouse parallax (smoothed / target)
      dirty: true,
      w: 0, h: 0,
    };

    /* ---- progressive preloading: coarse-to-fine so scrubbing works immediately ---- */
    const order = [];
    const seen = new Set();
    for (const step of [16, 8, 4, 2, 1]) {
      for (let i = 0; i < TOTAL; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
    }
    let cursor = 0;
    const loadNext = () => {
      if (cursor >= order.length) return;
      const i = order[cursor++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const done = () => {
          frames[i] = img;
          loadedCount++;
          if (loaderText) loaderText.textContent = `${Math.round((loadedCount / TOTAL) * 100)}%`;
          if (i === 0) hero.classList.add('is-ready');
          if (loadedCount === TOTAL) hero.classList.add('is-loaded');
          state.dirty = true;
          loadNext();
        };
        img.decode ? img.decode().then(done, done) : done();
      };
      img.onerror = loadNext;
      img.src = src(i);
    };
    for (let k = 0; k < 6; k++) loadNext();

    const nearest = (i) => {
      if (frames[i]) return frames[i];
      for (let d = 1; d < TOTAL; d++) {
        if (frames[i - d]) return frames[i - d];
        if (frames[i + d]) return frames[i + d];
      }
      return null;
    };

    /* ---- canvas sizing ---- */
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      state.w = canvas.width = Math.round(rect.width * dpr);
      state.h = canvas.height = Math.round(rect.height * dpr);
      ctx.imageSmoothingQuality = 'high';
      state.dirty = true;
      measure();
    };

    const drawCover = (img, alpha) => {
      const { w, h } = state;
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    };

    const draw = () => {
      const f = state.progress * (TOTAL - 1);
      const i0 = Math.floor(f);
      const i1 = Math.min(TOTAL - 1, i0 + 1);
      const t = f - i0;
      const a = nearest(i0);
      if (!a) return;
      drawCover(a, 1);
      const b = frames[i1];
      if (b && b !== a && t > 0.01) drawCover(b, t); // cross-fade => seamless sub-frame motion
      ctx.globalAlpha = 1;
    };

    /* ---- scroll progress ---- */
    let heroTop = 0;
    let heroRange = 1;
    function measure() {
      const r = hero.getBoundingClientRect();
      heroTop = r.top + scrollY;
      heroRange = Math.max(1, hero.offsetHeight - innerHeight);
    }
    const onScroll = () => {
      state.target = clamp((scrollY - heroTop) / heroRange, 0, 1);
    };

    /* ---- chapters (Z-axis fly-through) ---- */
    const FADE = 0.05;
    let activeIndex = -1;
    const updateChapters = (p) => {
      let active = 0;
      chaps.forEach((c, idx) => {
        let d = 0;
        if (p < c.in) d = -clamp((c.in - p) / FADE, 0, 1);
        else if (p > c.out) d = clamp((p - c.out) / FADE, 0, 1);
        const eased = Math.sign(d) * easeInOut(Math.abs(d));
        const o = 1 - Math.abs(eased);
        c.el.style.setProperty('--d', eased.toFixed(4));
        c.el.style.setProperty('--o', o.toFixed(3));
        c.el.classList.toggle('is-hidden', o <= 0.001);
        c.el.classList.toggle('is-active', o > 0.6);
        if (p >= c.in - FADE / 2) active = idx;
      });
      if (active !== activeIndex) {
        activeIndex = active;
        if (count) count.textContent = String(active + 1).padStart(2, '0');
        dots.forEach((d, k) => d.classList.toggle('is-on', k === active));
      }
      if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
      if (cue) cue.style.opacity = String(clamp(1 - p / 0.06, 0, 1));
      hero.classList.toggle('is-past-start', p > 0.02);
    };

    /* ---- mouse parallax ---- */
    if (finePointer) {
      addEventListener('pointermove', (e) => {
        state.tmx = (e.clientX / innerWidth) * 2 - 1;
        state.tmy = (e.clientY / innerHeight) * 2 - 1;
      }, { passive: true });
      document.addEventListener('pointerleave', () => { state.tmx = 0; state.tmy = 0; });
    }

    /* ---- render loop: only does work while something is moving ---- */
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);

    const tick = () => {
      requestAnimationFrame(tick);
      if (!visible) return;
      const dp = state.target - state.progress;
      const moving = Math.abs(dp) > 0.00005;
      state.progress = moving ? lerp(state.progress, state.target, 0.11) : state.target;
      state.mx = lerp(state.mx, state.tmx, 0.06);
      state.my = lerp(state.my, state.tmy, 0.06);

      if (moving || state.dirty) {
        draw();
        updateChapters(state.progress);
        state.dirty = false;
      }
      // 3D camera: gentle dolly-in through each scene + mouse-driven tilt
      const dolly = 1.04 + Math.sin(state.progress * Math.PI * 4) * 0.012;
      scene.style.transform =
        `translate3d(${(-state.mx * 14).toFixed(2)}px, ${(-state.my * 10).toFixed(2)}px, 0) ` +
        `rotateY(${(state.mx * 2.4).toFixed(3)}deg) rotateX(${(-state.my * 1.8).toFixed(3)}deg) scale(${dolly.toFixed(4)})`;
    };

    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', () => { resize(); onScroll(); });
    resize();
    onScroll();
    state.progress = state.target;
    updateChapters(state.progress);
    requestAnimationFrame(tick);
  }

  /* ================================================================ */
  /* NAV                                                               */
  /* ================================================================ */
  const nav = document.querySelector('[data-nav]');
  const toggle = document.querySelector('.nav__toggle');
  const menu = document.getElementById('mobile-menu');
  const setNav = () => {
    const threshold = hero && !reduceMotion ? hero.offsetHeight - innerHeight - 40 : 40;
    nav.classList.toggle('is-solid', scrollY > threshold || toggle.getAttribute('aria-expanded') === 'true');
  };
  addEventListener('scroll', setNav, { passive: true });
  setNav();
  const closeMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Mở menu');
    menu.hidden = true;
    setNav();
  };
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    menu.hidden = !open;
    setNav();
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) closeMenu(); });

  /* ================================================================ */
  /* REVEAL + TILT                                                     */
  /* ================================================================ */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const siblings = [...e.target.parentElement.children].filter((n) => n.classList.contains('reveal'));
        e.target.style.setProperty('--delay', `${Math.min(siblings.indexOf(e.target), 5) * 0.08}s`);
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px' });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('is-in'));
  }

  if (finePointer && !reduceMotion) {
    document.querySelectorAll('[data-tilt]').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', `${x * 100}%`);
        card.style.setProperty('--my', `${y * 100}%`);
        card.style.transform = `rotateY(${((x - 0.5) * 8).toFixed(2)}deg) rotateX(${((0.5 - y) * 8).toFixed(2)}deg)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }

  /* ================================================================ */
  /* LIGHTBOX                                                          */
  /* ================================================================ */
  const dialog = document.querySelector('[data-lightbox-dialog]');
  if (dialog && typeof dialog.showModal === 'function') {
    const img = dialog.querySelector('[data-lightbox-img]');
    const cap = dialog.querySelector('[data-lightbox-cap]');
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-lightbox]');
      if (!btn) return;
      img.src = btn.dataset.lightbox;
      img.alt = btn.querySelector('img')?.alt || '';
      cap.textContent = btn.dataset.caption || '';
      dialog.showModal();
    });
    dialog.querySelector('[data-lightbox-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  }

  /* ================================================================ */
  /* QUOTE FORM                                                        */
  /* ================================================================ */
  const form = document.querySelector('[data-form]');
  if (!form) return;
  const status = form.querySelector('[data-status]');
  const submit = form.querySelector('[data-submit]');

  // "Nhận báo giá" links on service cards pre-select the service
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-service]');
    if (link) form.elements.service.value = link.dataset.service;
  });

  const showErrors = (errors = {}) => {
    form.querySelectorAll('[data-err]').forEach((p) => {
      const msg = errors[p.dataset.err] || '';
      p.textContent = msg;
      p.closest('.field').classList.toggle('has-error', Boolean(msg));
      const input = form.elements[p.dataset.err];
      if (input) input.setAttribute('aria-invalid', String(Boolean(msg)));
    });
    const first = Object.keys(errors)[0];
    if (first && form.elements[first]) form.elements[first].focus();
  };

  const clientValidate = (d) => {
    const e = {};
    if (d.name.trim().length < 2) e.name = 'Vui lòng nhập họ tên.';
    if (!/^(\+?84|0)(3|5|7|8|9)\d{8}$/.test(d.phone.replace(/[\s.\-()]/g, ''))) e.phone = 'Số điện thoại chưa đúng (VD: 0901 234 567).';
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim())) e.email = 'Email chưa đúng định dạng.';
    if (!d.service) e.service = 'Vui lòng chọn dịch vụ.';
    return e;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    status.className = 'form__status';
    status.textContent = '';
    const errs = clientValidate(data);
    showErrors(errs);
    if (Object.keys(errs).length) return;

    submit.disabled = true;
    submit.textContent = 'Đang gửi…';
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const out = await res.json().catch(() => ({}));
      if (res.ok && out.ok) {
        form.reset();
        status.classList.add('is-ok');
        status.textContent = 'Cảm ơn anh/chị! Thiên Khôi CDC sẽ liên hệ trong thời gian sớm nhất.';
      } else if (out.errors) {
        showErrors(out.errors);
      } else {
        throw new Error(out.message || 'Gửi không thành công.');
      }
    } catch (err) {
      status.classList.add('is-err');
      status.textContent = `${err.message || 'Không thể kết nối.'} Vui lòng gọi hotline để được hỗ trợ ngay.`;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Gửi yêu cầu báo giá';
    }
  });
})();
