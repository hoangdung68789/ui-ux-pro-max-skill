/* Thiên Khôi CDC — front-end
 * 1. Scroll-driven 3D fly-through hero: each scroll step plays real 60 fps video (forward file,
 *    or a reversed file when scrolling up) to the next chapter; parallax tilt; Z-axis chapter text
 *    Fullscreen player for the full film
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
    const scene = hero.querySelector('[data-scene]');
    const stage = hero.querySelector('[data-stage]');
    const fwd = hero.querySelector('[data-video="fwd"]');
    const rev = hero.querySelector('[data-video="rev"]');
    const ambient = hero.querySelector('[data-ambient]');
    const actx = ambient.getContext('2d', { alpha: false });
    const bar = hero.querySelector('[data-bar]');
    const cue = hero.querySelector('[data-cue]');
    const stops = hero.dataset.stops.split(',').map(Number); // video time (s) where each chapter rests
    const chaps = [...hero.querySelectorAll('[data-chap]')].map((el, i) => ({ el, d: i === 0 ? 0 : -1 }));
    const LAST = stops.length - 1;

    // Phones (either orientation) stream the 720p pair, larger screens 1080p. Both are 60 fps.
    const portrait = () => innerWidth / innerHeight < 0.85;
    const small = portrait() || Math.max(innerWidth, innerHeight) < 1024;
    fwd.src = small ? fwd.dataset.srcSm : fwd.dataset.srcLg;
    rev.src = small ? rev.dataset.srcSm : rev.dataset.srcLg;
    let isPortrait = portrait();

    const state = {
      time: 0, // position on the forward timeline (s)
      target: 0, // time we are travelling to
      chapter: 0, // chapter the scroll position asks for
      arrived: true,
      dir: 0, // 1 forward, -1 backward, 0 resting
      D: stops[LAST] + 0.2, // replaced by real duration once metadata loads
      autoplay: true, // false when the browser refuses muted playback (e.g. iOS low-power mode)
      mx: 0, my: 0, tmx: 0, tmy: 0,
      tilted: false,
    };
    let active = fwd; // the element currently on screen
    let switching = false;

    fwd.addEventListener('loadedmetadata', () => { state.D = fwd.duration || state.D; });
    fwd.addEventListener('loadeddata', () => hero.classList.add('is-ready', 'is-loaded'), { once: true });
    fwd.load();
    rev.load();

    const seek = (v, t) => new Promise((resolve) => {
      if (Math.abs(v.currentTime - t) < 0.02) return resolve();
      const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); };
      const timer = setTimeout(done, 700);
      v.addEventListener('seeked', done);
      v.currentTime = t;
    });

    const show = (v) => {
      active = v;
      fwd.classList.toggle('is-on', v === fwd);
      rev.classList.toggle('is-on', v === rev);
    };

    // Travel to the target time: forward plays the normal file, backward plays the reversed file,
    // so motion is always real 60 fps video in both directions.
    async function travel() {
      const dist = state.target - state.time;
      if (Math.abs(dist) < 0.03) { finish(); return; }
      const dir = Math.sign(dist);
      const v = dir > 0 ? fwd : rev;
      v.playbackRate = clamp(Math.abs(dist) / 2.2, 1.6, 4); // longer hops play faster
      if (state.dir === dir && active === v && !v.paused) return; // already heading that way
      state.dir = dir;
      state.arrived = false;
      if (active !== v) {
        switching = true;
        active.pause();
        await seek(v, dir > 0 ? state.time : state.D - state.time);
        show(v);
        switching = false;
      }
      if (!state.autoplay) return jump();
      try {
        await v.play();
      } catch {
        state.autoplay = false;
        jump();
      }
    }

    // Fallback without autoplay: cut straight to the chapter frame
    async function jump() {
      await seek(fwd, state.target);
      show(fwd);
      state.time = state.target;
      finish();
    }

    function finish() {
      active.pause();
      state.dir = 0;
      state.arrived = true;
    }

    /* ---- scroll -> chapter ---- */
    let heroTop = 0;
    let heroRange = 1;
    const measure = () => {
      heroTop = hero.getBoundingClientRect().top + scrollY;
      heroRange = Math.max(1, hero.offsetHeight - innerHeight);
    };
    const onScroll = () => {
      const p = clamp((scrollY - heroTop) / heroRange, 0, 1);
      const chapter = Math.round(p * LAST);
      if (cue) cue.style.opacity = String(clamp(1 - p / 0.05, 0, 1));
      hero.classList.toggle('is-past-start', p > 0.02);
      if (chapter === state.chapter) return;
      state.chapter = chapter;
      state.target = stops[chapter];
      if (!switching) travel();
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

    /* ---- frame loop: follows the playing video, animates chapter text and the 3D camera ---- */
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
    let last = performance.now();
    let frameNo = 0;

    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      frameNo++;

      if (!state.arrived && !switching) {
        state.time = active === fwd ? fwd.currentTime : state.D - rev.currentTime;
        const reached = state.dir > 0 ? state.time >= state.target - 0.02 : state.time <= state.target + 0.02;
        if (reached || active.ended) { state.time = state.target; finish(); }
        if (state.target !== stops[state.chapter]) { state.target = stops[state.chapter]; travel(); }
      }
      if (state.arrived && Math.abs(stops[state.chapter] - state.time) > 0.03 && !switching) {
        state.target = stops[state.chapter];
        travel();
      }

      // chapter text: the resting chapter flies in once the video is (almost) there
      const remaining = Math.abs(state.target - state.time) / (active.playbackRate || 1);
      const settled = state.arrived || remaining < 0.45;
      chaps.forEach((c, i) => {
        const goal = i < state.chapter ? 1 : i > state.chapter ? -1 : settled ? 0 : c.d;
        const step = dt / 0.75;
        if (Math.abs(c.d) === 1 && goal === -c.d) c.d = goal; // skipped chapter: don't flash it past the camera
        else c.d = c.d < goal ? Math.min(goal, c.d + step) : Math.max(goal, c.d - step);
        const eased = Math.sign(c.d) * easeInOut(Math.abs(c.d));
        const o = 1 - Math.abs(eased);
        c.el.style.setProperty('--d', eased.toFixed(4));
        c.el.style.setProperty('--o', o.toFixed(3));
        c.el.classList.toggle('is-hidden', o <= 0.001);
        c.el.classList.toggle('is-active', o > 0.6);
      });
      if (bar) bar.style.transform = `scaleX(${clamp(state.time / stops[LAST], 0, 1).toFixed(4)})`;

      // portrait phones: tiny blurred copy of the current frame fills the space around the 16:9 panel
      if (isPortrait && frameNo % 6 === 0 && active.readyState >= 2) {
        actx.drawImage(active, 0, 0, ambient.width, ambient.height);
      }

      if (!state.tilted) {
        // no pointer/gyro yet: slow ambient drift so the scene still reads as 3D
        const t = now / 1000;
        state.tmx = Math.sin(t * 0.35) * 0.45;
        state.tmy = Math.cos(t * 0.27) * 0.3;
      }
      const k = 1 - Math.pow(1 - 0.07, dt * 60);
      state.mx = lerp(state.mx, state.tmx, k);
      state.my = lerp(state.my, state.tmy, k);
      // full-screen scene: modest tilt within the overscan; portrait floating panel: free to tilt further
      const amp = isPortrait ? 2 : 1;
      scene.style.transform =
        `translate3d(${(-state.mx * 14).toFixed(2)}px, ${(-state.my * 9).toFixed(2)}px, 0) ` +
        `rotateY(${(state.mx * 3.5 * amp).toFixed(3)}deg) rotateX(${(-state.my * 2.5 * amp).toFixed(3)}deg)`;
      stage.style.transform =
        `translate3d(${(state.mx * 16).toFixed(2)}px, ${(state.my * 10).toFixed(2)}px, 0) ` +
        `rotateY(${(state.mx * -3).toFixed(3)}deg) rotateX(${(state.my * 2).toFixed(3)}deg)`;
    };

    const resize = () => {
      isPortrait = portrait();
      ambient.width = 24;
      ambient.height = Math.max(1, Math.round(24 * innerHeight / innerWidth));
      measure();
      onScroll();
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', resize);
    resize();
    // opening mid-page (reload / anchor): rest on that chapter without playing the whole way there
    state.chapter = Math.round(clamp((scrollY - heroTop) / heroRange, 0, 1) * LAST);
    state.time = state.target = stops[state.chapter];
    if (state.time > 0) fwd.addEventListener('loadedmetadata', () => { fwd.currentTime = state.time; }, { once: true });
    chaps.forEach((c, i) => { c.d = i < state.chapter ? 1 : i > state.chapter ? -1 : 0; });
    requestAnimationFrame(tick);
  }

  /* ================================================================ */
  /* FULLSCREEN PLAYER                                                 */
  /* ================================================================ */
  const player = document.querySelector('[data-player]');
  if (player) {
    const pv = player.querySelector('video');
    let open = false;
    const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const close = () => {
      if (!open) return;
      open = false;
      pv.pause();
      player.hidden = true;
      if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch?.(() => {});
      try { screen.orientation?.unlock?.(); } catch {}
    };
    document.querySelectorAll('[data-fullscreen]').forEach((btn) => btn.addEventListener('click', () => {
      open = true;
      player.hidden = false;
      if (!pv.src) pv.src = pv.dataset.src;
      pv.currentTime = 0;
      const canElementFs = document.fullscreenEnabled || document.webkitFullscreenEnabled;
      if (canElementFs) {
        // Android / desktop: real fullscreen, then turn the phone sideways automatically
        const req = player.requestFullscreen || player.webkitRequestFullscreen;
        Promise.resolve(req.call(player))
          .then(() => screen.orientation?.lock?.('landscape'))
          .catch(() => {});
        pv.play().catch(() => {});
      } else if (pv.webkitEnterFullscreen) {
        // iPhone: hand over to the native video player
        pv.play().catch(() => {});
        try { pv.webkitEnterFullscreen(); } catch {}
      } else {
        pv.play().catch(() => {});
      }
    }));
    player.querySelector('[data-player-close]').addEventListener('click', close);
    document.addEventListener('fullscreenchange', () => { if (!fsElement()) close(); });
    document.addEventListener('webkitfullscreenchange', () => { if (!fsElement()) close(); });
    pv.addEventListener('webkitendfullscreen', close);
    addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
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
