/* StockTrace V2.1 mobile navigation.
 * Deliberately isolated from app.js authentication/session lifecycle.
 */
(function () {
  'use strict';

  const sidebar = document.getElementById('appSidebar');
  const toggle = document.getElementById('mobileNavToggle');
  const backdrop = document.querySelector('.st-mobile-nav-backdrop');
  const mobileQuery = window.matchMedia('(max-width: 767px)');

  if (!sidebar || !toggle || !backdrop) return;

  function setOpen(open, restoreFocus) {
    const isMobile = mobileQuery.matches;
    if (!isMobile) open = false;

    document.body.classList.toggle('st-mobile-nav-open', Boolean(open));
    sidebar.setAttribute('aria-hidden', String(isMobile && !open));
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
    toggle.setAttribute('aria-label', open ? 'Tutup menu navigasi' : 'Buka menu navigasi');

    const icon = toggle.querySelector('i');
    if (icon) {
      icon.classList.toggle('ph-list', !open);
      icon.classList.toggle('ph-x', Boolean(open));
    }

    if (!open && restoreFocus && isMobile) {
      toggle.focus({ preventScroll: true });
    }
  }

  window.toggleMobileNav = function () {
    if (!mobileQuery.matches) return;
    setOpen(!document.body.classList.contains('st-mobile-nav-open'), false);
  };

  window.closeMobileNav = function (options) {
    setOpen(false, Boolean(options && options.restoreFocus));
  };

  toggle.addEventListener('click', function (event) {
    event.preventDefault();
    window.toggleMobileNav();
  });

  backdrop.addEventListener('click', function (event) {
    event.preventDefault();
    window.closeMobileNav();
  });

  sidebar.addEventListener('click', function (event) {
    const navButton = event.target.closest('[data-nav-view]');
    if (navButton && mobileQuery.matches) {
      window.closeMobileNav({ restoreFocus: true });
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && document.body.classList.contains('st-mobile-nav-open')) {
      window.closeMobileNav({ restoreFocus: true });
    }
  });

  function syncViewport() {
    if (mobileQuery.matches) {
      setOpen(false, false);
    } else {
      document.body.classList.remove('st-mobile-nav-open');
      sidebar.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Buka menu navigasi');
      const icon = toggle.querySelector('i');
      if (icon) {
        icon.classList.add('ph-list');
        icon.classList.remove('ph-x');
      }
    }
  }

  if (typeof mobileQuery.addEventListener === 'function') {
    mobileQuery.addEventListener('change', syncViewport);
  } else if (typeof mobileQuery.addListener === 'function') {
    mobileQuery.addListener(syncViewport);
  }

  syncViewport();
})();
