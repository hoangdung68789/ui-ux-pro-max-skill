/* Thiên Khôi CDC — front-end
 * 1. Full-screen 3D walk-through hero: the scroll position drives real 60 fps video (forward file,
 *    or a reversed file when scrolling up); look around by mouse, swipe or phone tilt;
 *    chapter text placed along the walk flies past the camera. Fullscreen player for the full film
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
    const bar = hero.querySelector('[data-bar]');
    const hint = hero.querySelector('[data-hint]');
    const W = 0.075; // half-width of the stretch of the walk where a chapter's text stays in place
    const F = 0.04; // fade length on either side
    const chaps = [...hero.querySelectorAll('[data-chap]')].map((el) => ({ el, at: parseFloat(el.dataset.at) }));

    const coarse = !finePointer;
    const small = innerWidth / innerHeight < 0.85 || Math.max(innerWidth, innerHeight) < 1024;
    fwd.src = small ? fwd.dataset.srcSm : fwd.dataset.srcLg;
    rev.src = small ? rev.dataset.srcSm : rev.dataset.srcLg;

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
      if (walk.t > 0) fwd.currentTime = walk.t;
      measure();
      onScroll();
    });
    fwd.addEventListener('loadeddata', () => hero.classList.add('is-ready'), { once: true });
    fwd.addEventListener('canplaythrough', () => { rev.preload = 'auto'; }, { once: true });
    setTimeout(() => { rev.preload = 'auto'; }, 4000);

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
      if (Math.abs(dist) < 0.025 || (dist > 0 && fwd.ended && active === fwd)) {
        if (!active.paused) { active.pause(); preseek(); }
        return;
      }
      const want = dist > 0 ? fwd : rev;
      if (want !== active) { swapTo(want); return; }
      // speed follows the distance: a flick of the page catches up fast, then eases into place
      const rate = clamp(Math.abs(dist) * 2.4, 0.4, 5);
      if (Math.abs(rate - walk.rate) > walk.rate * 0.12 && now - walk.rateAt > 120) {
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
     * Look-around. The 16:9 scene covers the screen with some to spare; the
     * viewer pans across it with the mouse, a horizontal swipe or by tilting
     * the phone, so a narrow portrait screen still reaches the whole frame.
     * ------------------------------------------------------------------ */
    const look = { x: 0, y: 0, tx: 0, ty: 0, rx: 0, ry: 0, lastInput: -1e9 };
    const touched = (now) => {
      look.lastInput = now;
      if (hint) hint.classList.remove('is-on');
    };

    if (finePointer) {
      addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        look.tx = (e.clientX / innerWidth) * 2 - 1;
        look.ty = ((e.clientY / innerHeight) * 2 - 1) * 0.6;
        touched(performance.now());
      }, { passive: true });
    }

    // horizontal drag (vertical swipes still scroll the page: touch-action: pan-y)
    let drag = null;
    sticky.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      drag = { x: e.clientX, start: look.tx };
    });
    sticky.addEventListener('pointermove', (e) => {
      if (!drag || look.rx <= 0) return;
      look.tx = clamp(drag.start - (e.clientX - drag.x) / look.rx, -1, 1); // scene follows the finger 1:1
      touched(performance.now());
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => sticky.addEventListener(type, () => { drag = null; }));

    // gyroscope: turning the phone turns the view
    if (coarse && 'DeviceOrientationEvent' in window) {
      let lastG = null;
      let lastB = null;
      const onTilt = (e) => {
        if (e.gamma == null || e.beta == null) return;
        if (lastG !== null) {
          const dg = e.gamma - lastG;
          const db = e.beta - lastB;
          if (Math.abs(dg) > 0.15 || Math.abs(db) > 0.15) {
            look.tx = clamp(look.tx + dg / 22, -1, 1);
            look.ty = clamp(look.ty + db / 40, -0.6, 0.6);
            if (Math.abs(dg) > 0.6) touched(performance.now());
          }
        }
        lastG = e.gamma;
        lastB = e.beta;
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

    if (hint && coarse) {
      setTimeout(() => { if (performance.now() - look.lastInput > 2500) hint.classList.add('is-on'); }, 1500);
      setTimeout(() => hint.classList.remove('is-on'), 7500);
    }

    /* ---- layout: the scene is a 16:9 box that covers the screen, plus a margin for the tilt ---- */
    const layout = () => {
      const w = sticky.clientWidth;
      const h = sticky.clientHeight;
      const s = Math.max(w / 16, h / 9) * 1.05;
      const sw = 16 * s;
      const sh = 9 * s;
      scene.style.width = `${sw}px`;
      scene.style.height = `${sh}px`;
      scene.style.left = `${(w - sw) / 2}px`;
      scene.style.top = `${(h - sh) / 2}px`;
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

      // chapter text sits at fixed points along the walk and flies past the camera
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
      if (bar) bar.style.transform = `scaleX(${f.toFixed(4)})`;

      // idle: the camera slowly looks left and right on its own
      if (now - look.lastInput > 4000 && !drag) {
        const amp = coarse ? 0.5 : 0.3;
        look.tx = Math.sin(now / 1000 * (Math.PI * 2 / 18)) * amp;
        look.ty = Math.cos(now / 1000 * (Math.PI * 2 / 23)) * 0.15;
      }
      const k = 1 - Math.pow(1 - (drag ? 0.35 : 0.07), dt * 60);
      look.x = lerp(look.x, look.tx, k);
      look.y = lerp(look.y, look.ty, k);
      const px = -look.x * look.rx * 0.92;
      const py = -look.y * look.ry * 0.9;
      scene.style.transform =
        `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) ` +
        `rotateY(${(look.x * 2.2).toFixed(3)}deg) rotateX(${(-look.y * 1.6).toFixed(3)}deg)`;
      // the text layer drifts a little the other way: depth without tilting the text
      stage.style.transform = `translate3d(${(look.x * 8).toFixed(1)}px, ${(look.y * 5).toFixed(1)}px, 0)`;
    };

    const onResize = () => { layout(); measure(); onScroll(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize);
    onResize();
    // opened mid-page (reload, anchor): start at that point of the walk instead of playing there
    walk.t = walk.target;
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
