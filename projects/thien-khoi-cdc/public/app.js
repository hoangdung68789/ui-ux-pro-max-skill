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
    const ambient = hero.querySelector('[data-ambient]');
    const actx = ambient.getContext('2d', { alpha: false });
    const scene = hero.querySelector('[data-scene]');
    const stage = hero.querySelector('[data-stage]');
    const chaps = [...hero.querySelectorAll('[data-chap]')].map((el) => ({
      el,
      in: parseFloat(el.dataset.in),
      out: parseFloat(el.dataset.out),
    }));
    const bar = hero.querySelector('[data-bar]');
    const cue = hero.querySelector('[data-cue]');
    const loaderText = hero.querySelector('[data-loader-text]');

    // Portrait phones show the full 16:9 frame in a floating panel (CSS); phones and small screens
    // (portrait or landscape) get the 1280px set, larger screens the 2560px set
    const portrait = () => innerWidth / innerHeight < 0.85;
    const pickSet = () => (portrait() || Math.max(innerWidth, innerHeight) < 1024 ? 'md' : 'hd');
    let set = pickSet();
    let TOTAL = parseInt(hero.dataset[set === 'md' ? 'framesMd' : 'framesHd'], 10);
    const src = (i) => `assets/frames/${set}/f${String(i + 1).padStart(3, '0')}.webp`;
    let frames = new Array(TOTAL);
    let loadedCount = 0;
    let generation = 0; // bumps when the frame set changes (phone rotated)

    const state = {
      target: 0, // scroll progress 0..1
      progress: 0, // smoothed progress
      mx: 0, my: 0, tmx: 0, tmy: 0, // pointer / device-tilt parallax (smoothed / target)
      tilted: false, // true once real input (mouse or gyroscope) drives the tilt
      dirty: true,
      w: 0, h: 0,
    };

    /* ---- progressive preloading: coarse-to-fine so scrubbing works immediately ---- */
    let order = [];
    let cursor = 0;
    const buildOrder = () => {
      order = [];
      cursor = 0;
      const seen = new Set();
      for (const step of [16, 8, 4, 2, 1]) {
        for (let i = 0; i < TOTAL; i += step) if (!seen.has(i)) { seen.add(i); order.push(i); }
      }
    };
    buildOrder();
    const loadNext = () => {
      if (cursor >= order.length) return;
      const i = order[cursor++];
      const gen = generation;
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const done = () => {
          if (gen !== generation) return;
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
    const startLoading = () => { for (let k = 0; k < 6; k++) loadNext(); };
    startLoading();
    const maybeSwapSet = () => {
      const next = pickSet();
      if (next === set) return;
      set = next;
      generation++;
      TOTAL = parseInt(hero.dataset[set === 'md' ? 'framesMd' : 'framesHd'], 10);
      const old = frames;
      frames = new Array(TOTAL);
      loadedCount = 0;
      hero.classList.remove('is-loaded');
      buildOrder();
      startLoading();
      // keep showing the old set until the new one has its first frames
      const keep = old.filter(Boolean);
      if (keep.length) fallback = keep;
    };
    let fallback = null;
    let isPortrait = portrait();

    const nearest = (i) => {
      if (frames[i]) return frames[i];
      for (let d = 1; d < TOTAL; d++) {
        if (frames[i - d]) return frames[i - d];
        if (frames[i + d]) return frames[i + d];
      }
      return fallback ? fallback[Math.min(fallback.length - 1, Math.round((i / TOTAL) * fallback.length))] : null;
    };

    /* ---- canvas sizing ---- */
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      state.w = canvas.width = Math.round(rect.width * dpr);
      state.h = canvas.height = Math.round(rect.height * dpr);
      isPortrait = portrait();
      ambient.width = 48;
      ambient.height = Math.max(1, Math.round(48 * innerHeight / innerWidth));
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
      if (isPortrait) actx.drawImage(canvas, 0, 0, ambient.width, ambient.height); // tiny + CSS blur = cheap fill
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
    const updateChapters = (p) => {
      chaps.forEach((c) => {
        let d = 0;
        if (p < c.in) d = -clamp((c.in - p) / FADE, 0, 1);
        else if (p > c.out) d = clamp((p - c.out) / FADE, 0, 1);
        const eased = Math.sign(d) * easeInOut(Math.abs(d));
        const o = 1 - Math.abs(eased);
        c.el.style.setProperty('--d', eased.toFixed(4));
        c.el.style.setProperty('--o', o.toFixed(3));
        c.el.classList.toggle('is-hidden', o <= 0.001);
        c.el.classList.toggle('is-active', o > 0.6);
      });
      if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
      if (cue) cue.style.opacity = String(clamp(1 - p / 0.06, 0, 1));
      hero.classList.toggle('is-past-start', p > 0.02);
    };

    /* ---- 3D parallax: mouse on desktop, gyroscope on phones, gentle drift as fallback ---- */
    if (finePointer) {
      addEventListener('pointermove', (e) => {
        state.tilted = true;
        state.tmx = (e.clientX / innerWidth) * 2 - 1;
        state.tmy = (e.clientY / innerHeight) * 2 - 1;
      }, { passive: true });
      document.addEventListener('pointerleave', () => { state.tmx = 0; state.tmy = 0; });
    } else if ('DeviceOrientationEvent' in window) {
      let base = null;
      const onTilt = (e) => {
        if (e.beta == null || e.gamma == null) return;
        if (!base) base = { b: e.beta, g: e.gamma };
        state.tilted = true;
        state.tmx = clamp((e.gamma - base.g) / 20, -1, 1);
        state.tmy = clamp((e.beta - base.b) / 20, -1, 1);
      };
      const listen = () => addEventListener('deviceorientation', onTilt, { passive: true });
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS asks once, on the first tap
        addEventListener('touchend', () => {
          DeviceOrientationEvent.requestPermission().then((r) => r === 'granted' && listen()).catch(() => {});
        }, { once: true });
      } else {
        listen();
      }
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
      if (!state.tilted) {
        // no pointer/gyro yet: slow ambient drift so the scene still reads as 3D
        const t = performance.now() / 1000;
        state.tmx = Math.sin(t * 0.35) * 0.45;
        state.tmy = Math.cos(t * 0.27) * 0.3;
      }
      state.mx = lerp(state.mx, state.tmx, 0.07);
      state.my = lerp(state.my, state.tmy, 0.07);

      if (moving || state.dirty) {
        draw();
        updateChapters(state.progress);
        state.dirty = false;
      }
      // 3D camera: scene and text layer tilt in opposite directions => strong depth separation
      const dolly = 1 + Math.sin(state.progress * Math.PI * 4) * 0.01;
      // full-screen scene: modest tilt within the overscan; portrait floating panel: free to tilt further
      const k = isPortrait ? 2 : 1;
      scene.style.transform =
        `translate3d(${(-state.mx * 14).toFixed(2)}px, ${(-state.my * 9).toFixed(2)}px, 0) ` +
        `rotateY(${(state.mx * 3.5 * k).toFixed(3)}deg) rotateX(${(-state.my * 2.5 * k).toFixed(3)}deg) scale(${dolly.toFixed(4)})`;
      stage.style.transform =
        `translate3d(${(state.mx * 16).toFixed(2)}px, ${(state.my * 10).toFixed(2)}px, 0) ` +
        `rotateY(${(state.mx * -3).toFixed(3)}deg) rotateX(${(state.my * 2).toFixed(3)}deg)`;
    };

    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', () => { maybeSwapSet(); resize(); onScroll(); });
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
  let lastY = scrollY;
  const setNav = () => {
    const threshold = hero && !reduceMotion ? hero.offsetHeight - innerHeight - 40 : 40;
    const open = toggle.getAttribute('aria-expanded') === 'true';
    nav.classList.toggle('is-solid', scrollY > threshold || open);
    // hide while scrolling down so the 3D scene fills the screen; show again on the way up
    const delta = scrollY - lastY;
    if (Math.abs(delta) > 6) {
      nav.classList.toggle('is-hidden', delta > 0 && scrollY > 120 && !open);
      lastY = scrollY;
    }
  };
  addEventListener('scroll', setNav, { passive: true });
  nav.addEventListener('focusin', () => nav.classList.remove('is-hidden'));
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

    // Static preview build has no server: confirm the form works without sending anything
    if (form.dataset.preview !== undefined) {
      status.classList.add('is-ok');
      status.textContent = 'Bản xem trước: thông tin hợp lệ. Khi chạy trên máy chủ thật, yêu cầu sẽ được lưu vào trang quản trị.';
      return;
    }

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
