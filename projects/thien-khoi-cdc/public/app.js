/* Thiên Khôi CDC — front-end
 * 1. Full-screen 3D walk-through hero: the scroll position drives real 60 fps video (forward file,
 *    or a reversed file when scrolling up); look around by mouse, swipe or phone tilt;
 *    phones held upright play a dedicated 9:16 cut; chapter text placed along the walk flies past the camera
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
    const sticky = hero.querySelector('[data-look]');
    const scene = hero.querySelector('[data-scene]');
    const stage = hero.querySelector('[data-stage]');
    const fwd = hero.querySelector('[data-video="fwd"]');
    const rev = hero.querySelector('[data-video="rev"]');
    const W = 0.075; // half-width of the stretch of the walk where a chapter's text stays in place
    const F = 0.04; // fade length on either side
    const chaps = [...hero.querySelectorAll('[data-chap]')].map((el) => ({ el, at: parseFloat(el.dataset.at) }));

    const coarse = !finePointer;
    // phones held upright get the 9:16 cut; otherwise pick 16:9 by real device pixels (a phone held
    // sideways is ~2500 px wide, so it gets 1080p too)
    const pickSet = () =>
      innerWidth / innerHeight < 0.85 ? 'portrait'
        : Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 3) < 1400 ? 'sm' : 'lg';
    const key = { portrait: 'srcPortrait', sm: 'srcSm', lg: 'srcLg' };
    let set = pickSet();
    const posterFor = (s) => (s === 'portrait' ? 'assets/frames/poster-916.webp' : 'assets/frames/poster.webp');
    const loadSet = () => {
      [fwd, rev].forEach((v) => {
        v.poster = posterFor(set);
        v.src = v.dataset[key[set]];
      });
    };
    loadSet();

    /* ------------------------------------------------------------------
     * Walk engine. The scroll position sets a target time on the walk-through.
     * The video then *plays* toward it (forward file, or the reversed file when
     * scrolling back up) with a speed proportional to the distance, so motion is
     * always real 60 fps, hardware-decoded video that follows the user's scroll.
     * ------------------------------------------------------------------ */
    const walk = {
      t: 0, // position on the forward timeline (s)
      target: 0,
      D: 20, // file duration, replaced once metadata loads
      mode: 'play', // 'seek' when the browser refuses muted playback (stepped seeking instead)
      rate: 1,
      rateAt: 0,
      dir: 0, // direction of the last movement
      movedAt: -1e9,
      seeking: false,
    };
    const END = () => walk.D - 0.05;
    const mirror = (t) => Math.max(0, walk.D - 1 / 60 - t); // forward time <-> reversed-file time
    let active = fwd;
    let switching = false;
    let playPending = false;
    let preseekTimer = 0;

    fwd.addEventListener('loadedmetadata', () => {
      walk.D = fwd.duration || walk.D;
      if (walk.t > 0 && !switching) fwd.currentTime = walk.t;
      measure();
      onScroll();
    });

    // phone rotated: switch between the 9:16 and 16:9 files, staying at the same point of the walk
    const maybeSwapSet = () => {
      const next = pickSet();
      if (next === set) return;
      set = next;
      const keep = walk.t;
      switching = true; // freeze the walk until the new file sits on the same frame
      active.pause();
      show(fwd);
      loadSet();
      fwd.addEventListener('loadedmetadata', () => {
        seek(fwd, keep).then(() => { walk.t = keep; switching = false; });
      }, { once: true });
    };
    fwd.addEventListener('loadeddata', () => hero.classList.add('is-ready'), { once: true });
    // bandwidth goes to the forward file first; the reversed one follows once it is buffered
    const loadRev = () => { if (rev.preload !== 'auto') rev.preload = 'auto'; };
    fwd.addEventListener('progress', () => {
      const b = fwd.buffered;
      if (b.length && b.end(b.length - 1) >= (fwd.duration || 1e9) - 0.5) loadRev();
    });
    setTimeout(loadRev, 8000);

    const show = (v) => {
      active = v;
      fwd.classList.toggle('is-on', v === fwd);
      rev.classList.toggle('is-on', v === rev);
    };

    const seek = (v, time) => new Promise((resolve) => {
      if (Math.abs(v.currentTime - time) < 0.02) return resolve();
      const done = () => { clearTimeout(timer); v.removeEventListener('seeked', done); resolve(); };
      const timer = setTimeout(done, 600);
      v.addEventListener('seeked', done);
      v.currentTime = time;
    });

    async function swapTo(v) {
      switching = true;
      active.pause();
      await seek(v, v === fwd ? walk.t : mirror(walk.t));
      show(v);
      switching = false;
    }

    // While resting, line the hidden file up with the current frame so a change of direction is instant
    const preseek = () => {
      clearTimeout(preseekTimer);
      preseekTimer = setTimeout(() => {
        if (switching || !active.paused) return;
        const other = active === fwd ? rev : fwd;
        const want = other === fwd ? walk.t : mirror(walk.t);
        if (Math.abs(other.currentTime - want) > 0.03) other.currentTime = want;
      }, 150);
    };

    const toSeekMode = () => {
      walk.mode = 'seek';
      active.pause();
      show(fwd);
    };
    // Some in-app browsers only allow playback after a tap: try again on every tap
    const unlock = () => {
      if (walk.mode !== 'seek') return;
      fwd.play().then(() => {
        fwd.pause();
        walk.mode = 'play';
        rev.play().then(() => rev.pause(), () => {});
      }, () => {});
    };
    ['pointerup', 'keydown'].forEach((type) => addEventListener(type, unlock, { passive: true }));

    function stepWalk(now) {
      if (walk.mode === 'seek') {
        // fallback: hop toward the target with seeks (each hop waits for the previous frame)
        if (!walk.seeking && Math.abs(walk.target - walk.t) > 0.02) {
          walk.seeking = true;
          const next = walk.t + clamp(walk.target - walk.t, -0.5, 0.5);
          seek(fwd, next).then(() => { walk.t = fwd.currentTime; walk.seeking = false; });
        }
        return;
      }
      if (switching) return;
      walk.t = active === fwd ? fwd.currentTime : mirror(rev.currentTime);
      const dist = walk.target - walk.t;
      const dir = Math.sign(dist);
      const moving = !active.paused;
      // stop a frame early rather than late; a small overshoot is accepted instead of reversing
      const stopBand = moving ? Math.max(0.03, walk.rate / 60 * 1.5) : 0.03;
      const smallReverse = dir !== walk.dir && Math.abs(dist) < 0.2 && now - walk.movedAt < 700;
      if (Math.abs(dist) < stopBand || smallReverse || (dist > 0 && fwd.ended && active === fwd)) {
        if (moving) { active.pause(); walk.movedAt = now; preseek(); }
        return;
      }
      const want = dir > 0 ? fwd : rev;
      if (want !== active) { swapTo(want); return; }
      walk.dir = dir;
      walk.movedAt = now;
      // speed follows the distance: a flick of the page catches up fast, then eases into place.
      // Slowing down is applied at once; speeding up is rate-limited to avoid jitter.
      const rate = clamp(Math.abs(dist) * 2.2, 0.35, 4);
      const slower = rate < walk.rate * 0.95;
      if ((slower && now - walk.rateAt > 40) || (rate > walk.rate * 1.12 && now - walk.rateAt > 120)) {
        active.playbackRate = rate;
        walk.rate = rate;
        walk.rateAt = now;
      }
      if (active.paused && !playPending) {
        playPending = true;
        active.play().then(() => { playPending = false; }, () => { playPending = false; toSeekMode(); });
      }
    }

    /* ---- scroll -> target time (short rests at the gate and in the kitchen) ---- */
    let heroTop = 0;
    let heroRange = 1;
    function measure() {
      heroTop = hero.getBoundingClientRect().top + scrollY;
      heroRange = Math.max(1, hero.offsetHeight - innerHeight);
    }
    function onScroll() {
      const p = clamp((scrollY - heroTop) / heroRange, 0, 1);
      walk.target = clamp((p - 0.02) / 0.9, 0, 1) * END();
    }

    /* ------------------------------------------------------------------
     * Depth. The mouse (desktop) or tilting the phone shifts the scene a few
     * pixels against the text layer. Nothing moves on its own, and at rest the
     * video is drawn with no transform at all, so it stays pixel-sharp.
     * ------------------------------------------------------------------ */
    const look = { x: 0, y: 0, tx: 0, ty: 0, rx: 0, ry: 0, lastInput: -1e9 };

    if (finePointer) {
      addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        look.tx = (e.clientX / innerWidth) * 2 - 1;
        look.ty = ((e.clientY / innerHeight) * 2 - 1) * 0.6;
        look.lastInput = performance.now();
      }, { passive: true });
      document.addEventListener('pointerleave', () => { look.tx = 0; look.ty = 0; });
    }

    // gyroscope: relative to how the phone was held when the page opened; drifts back to centre
    if (coarse && 'DeviceOrientationEvent' in window) {
      let base = null;
      const onTilt = (e) => {
        if (e.gamma == null || e.beta == null) return;
        if (!base) base = { g: e.gamma, b: e.beta };
        base.g = lerp(base.g, e.gamma, 0.01); // slowly re-centre so a new grip is the new neutral
        base.b = lerp(base.b, e.beta, 0.01);
        look.tx = clamp((e.gamma - base.g) / 18, -1, 1);
        look.ty = clamp((e.beta - base.b) / 30, -0.6, 0.6);
        look.lastInput = performance.now();
      };
      const listen = () => addEventListener('deviceorientation', onTilt, { passive: true });
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        addEventListener('touchend', () => {
          DeviceOrientationEvent.requestPermission().then((r) => r === 'granted' && listen()).catch(() => {});
        }, { once: true });
      } else {
        listen();
      }
    }

    /* ---- layout: the scene is a 16:9 (or 9:16) box that covers the screen, plus a small margin for depth ---- */
    const layout = () => {
      const w = sticky.clientWidth;
      const h = sticky.clientHeight;
      const [aw, ah] = set === 'portrait' ? [9, 16] : [16, 9];
      const s = Math.max(w / aw, h / ah) * 1.02;
      const sw = Math.round(aw * s);
      const sh = Math.round(ah * s);
      scene.style.width = `${sw}px`;
      scene.style.height = `${sh}px`;
      scene.style.left = `${Math.round((w - sw) / 2)}px`;
      scene.style.top = `${Math.round((h - sh) / 2)}px`;
      look.rx = (sw - w) / 2;
      look.ry = (sh - h) / 2;
    };

    /* ---- frame loop ---- */
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(hero);
    let last = performance.now();

    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;

      stepWalk(now);

      // chapter text sits at fixed points along the walk: rises in, then drifts up and fades as you pass
      const f = clamp(walk.t / END(), 0, 1);
      chaps.forEach((c) => {
        let d = 0;
        if (f < c.at - W) d = -clamp((c.at - W - f) / F, 0, 1);
        else if (f > c.at + W) d = clamp((f - c.at - W) / F, 0, 1);
        const eased = Math.sign(d) * easeInOut(Math.abs(d));
        const o = 1 - Math.abs(eased);
        c.el.style.setProperty('--d', eased.toFixed(4));
        c.el.style.setProperty('--o', o.toFixed(3));
        c.el.classList.toggle('is-hidden', o <= 0.001);
        c.el.classList.toggle('is-active', o > 0.6);
      });

      const k = 1 - Math.pow(1 - 0.08, dt * 60);
      look.x = lerp(look.x, look.tx, k);
      look.y = lerp(look.y, look.ty, k);
      if (Math.abs(look.x) < 0.004 && Math.abs(look.y) < 0.004 && Math.abs(look.tx) < 0.004 && Math.abs(look.ty) < 0.004) {
        // at rest: no transform, the video maps 1:1 to the screen (sharpest)
        if (scene.style.transform) { scene.style.transform = ''; stage.style.transform = ''; }
      } else {
        const px = -look.x * look.rx * 0.9;
        const py = -look.y * look.ry * 0.9;
        // a slight turn only with a mouse; on phones the video is only shifted, never resampled at an angle
        const turn = finePointer ? ` rotateY(${(look.x * 1.2).toFixed(3)}deg) rotateX(${(-look.y * 0.8).toFixed(3)}deg)` : '';
        scene.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)${turn}`;
        stage.style.transform = `translate3d(${(look.x * 6).toFixed(1)}px, ${(look.y * 4).toFixed(1)}px, 0)`;
      }
    };

    // Rotating the phone changes the page length; keep the viewer at the same point of the walk.
    // (Height-only resizes come from the mobile address bar and are left alone.)
    let lastW = innerWidth;
    const onResize = () => {
      const rotated = innerWidth !== lastW;
      lastW = innerWidth;
      const f = walk.target / END();
      const inside = scrollY >= heroTop && scrollY <= heroTop + heroRange;
      maybeSwapSet();
      layout();
      measure();
      if (rotated && inside && f > 0) scrollTo(0, heroTop + (0.02 + f * 0.9) * heroRange);
      onScroll();
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    onResize();
    // opened mid-page (reload, anchor): start at that point of the walk instead of playing there
    walk.t = walk.target;
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
