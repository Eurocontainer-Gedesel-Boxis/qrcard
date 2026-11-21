/* Interfaz de la página: progreso de scroll, aparición suave, inclinación 3D,
   navegación activa y descarga de tarjetas de contacto (vCard). */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  /* ---------- Barra de progreso ---------- */
  const line = document.getElementById('scrollLine');
  let ticking = false;
  const updateScroll = () => {
    ticking = false;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (line) line.style.width = Math.min(100, (window.scrollY / max) * 100) + '%';
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(updateScroll); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  updateScroll();

  /* ---------- Aparición al hacer scroll ---------- */
  const reveals = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  /* ---------- Navegación activa ---------- */
  const navLinks = [...document.querySelectorAll('.main-nav a[href^="#"]')];
  const targets = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && targets.length) {
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((a) => a.removeAttribute('aria-current'));
        const link = navLinks.find((a) => a.getAttribute('href') === '#' + entry.target.id);
        if (link) link.setAttribute('aria-current', 'true');
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach((t) => navObserver.observe(t));
  }

  /* ---------- Inclinación 3D con inercia ---------- */
  if (finePointer && !reduceMotion) {
    const MAX_X = 4.2;   // grados
    const MAX_Y = 5.4;
    document.querySelectorAll('[data-depth]').forEach((el) => el.style.setProperty('--z', el.dataset.depth));

    document.querySelectorAll('[data-tilt]').forEach((el) => {
      const state = { rx: 0, ry: 0, tx: 0, ty: 0, raf: 0, active: false };
      const step = () => {
        state.rx += (state.tx - state.rx) * 0.14;
        state.ry += (state.ty - state.ry) * 0.14;
        el.style.setProperty('--rx', state.rx.toFixed(3) + 'deg');
        el.style.setProperty('--ry', state.ry.toFixed(3) + 'deg');
        const settled = Math.abs(state.rx - state.tx) < 0.01 && Math.abs(state.ry - state.ty) < 0.01;
        if (!state.active && settled) {
          el.classList.remove('is-tilting');
          el.style.removeProperty('--rx'); el.style.removeProperty('--ry');
          state.raf = 0; return;
        }
        state.raf = requestAnimationFrame(step);
      };
      const kick = () => { if (!state.raf) state.raf = requestAnimationFrame(step); };

      el.addEventListener('pointerenter', () => { state.active = true; el.classList.add('is-tilting'); kick(); });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        state.ty = (x - 0.5) * 2 * MAX_Y;
        state.tx = (0.5 - y) * 2 * MAX_X;
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        kick();
      });
      el.addEventListener('pointerleave', () => { state.active = false; state.tx = 0; state.ty = 0; kick(); });
    });
  }

  /* ---------- Vídeo del montaje: botón de reproducción sobre el póster ---------- */
  document.querySelectorAll('.shot--video').forEach((box) => {
    const video = box.querySelector('video');
    if (!video) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'video-play';
    btn.setAttribute('aria-label', 'Reproducir el vídeo del montaje');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a.6.6 0 0 0 .92.5l10-6.4a.6.6 0 0 0 0-1l-10-6.4A.6.6 0 0 0 8 5.6Z" fill="currentColor"/></svg>';
    video.removeAttribute('controls');
    box.appendChild(btn);
    const start = () => { video.setAttribute('controls', ''); box.classList.add('is-started'); };
    btn.addEventListener('click', () => { start(); const p = video.play(); if (p && p.catch) p.catch(() => {}); video.focus({ preventScroll: true }); });
    video.addEventListener('play', start);

    /* Al pasar a pantalla completa se carga la versión 4K (3840×2160), conservando el punto de reproducción */
    const hires = video.dataset.hires;
    if (hires) {
      const saveData = !!(navigator.connection && navigator.connection.saveData);
      let hiLoaded = false;
      const swapToHires = () => {
        if (hiLoaded || saveData) return;
        hiLoaded = true;
        const t = video.currentTime, playing = !video.paused;
        video.removeAttribute('poster');
        video.src = hires;
        video.addEventListener('loadedmetadata', () => {
          try { video.currentTime = t; } catch (_) { /* sin punto de reproducción */ }
          if (playing) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
        }, { once: true });
        video.load();
      };
      const onFullscreen = () => { if ((document.fullscreenElement || document.webkitFullscreenElement) === video) swapToHires(); };
      document.addEventListener('fullscreenchange', onFullscreen);
      document.addEventListener('webkitfullscreenchange', onFullscreen);
      video.addEventListener('webkitbeginfullscreen', swapToHires);
    }
  });

  /* ---------- vCard ---------- */
  const team = {
    jose:      { first: 'José Luis', last: 'Herrando',    full: 'José Luis Herrando',  role: 'Director de proyecto',           phone: '+34 659 481 773', email: 'jlherrando@boxis.es', hours: 'Lunes a viernes, 08:30–16:30' },
    alejandro: { first: 'Alejandro', last: 'Ballestín',   full: 'Alejandro Ballestín', role: 'Director de proyecto',           phone: '+34 683 223 203', email: 'aballestin@boxis.es', hours: 'Lunes a viernes, 08:30–16:30' },
    ruben:     { first: 'Rubén',     last: 'Ruiz Cañón',  full: 'Rubén Ruiz Cañón',    role: 'Delineante eléctrico y calidad', phone: '+34 659 341 288', email: 'rruiz@boxis.es',      hours: 'Lunes a viernes, 08:00–16:00' }
  };
  const esc = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

  document.querySelectorAll('[data-contact-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const p = team[button.dataset.contactId];
      if (!p) return;
      const lines = [
        'BEGIN:VCARD', 'VERSION:3.0',
        'N:' + esc(p.last) + ';' + esc(p.first) + ';;;',
        'FN:' + esc(p.full), 'ORG:BOX Integration Systems', 'TITLE:' + esc(p.role)
      ];
      lines.push(
        'TEL;TYPE=CELL:' + p.phone,
        'EMAIL;TYPE=WORK:' + p.email,
        'ADR;TYPE=WORK:;;Carretera Alagón–Tudela (A-126) km 44\\,900;Remolinos;Zaragoza;50637;España',
        'URL:https://boxis.es/',
        'NOTE:' + esc(p.hours),
        'END:VCARD'
      );
      const blob = new Blob([lines.join('\r\n')], { type: 'text/vcard;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = p.full.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-') + '.vcf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1500);
    });
  });
})();
