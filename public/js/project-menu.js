let current = null;

function closeMenu(restoreFocus = false) {
  if (!current) return;
  const menu = current;
  current = null;
  const panel = menu.querySelector('[data-project-menu-panel]');
  if (panel?.hidePopover && panel.matches(':popover-open')) panel.hidePopover();
  menu.open = false;
  if (restoreFocus && menu.isConnected) menu.querySelector('summary').focus({ preventScroll:true });
}

function placeMenu(menu) {
  const panel = menu.querySelector('[data-project-menu-panel]');
  // Native popovers escape the sidebar's scrolling clip without moving any action buttons.
  if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover();
  const anchor = menu.querySelector('summary').getBoundingClientRect();
  const size = panel.getBoundingClientRect();
  const top = anchor.bottom + size.height + 8 <= innerHeight ? anchor.bottom + 4 : anchor.top - size.height - 4;
  panel.style.left = Math.max(8, Math.min(innerWidth - size.width - 8, anchor.right - size.width)) + 'px';
  panel.style.top = Math.max(8, Math.min(innerHeight - size.height - 8, top)) + 'px';
}

export function syncProjectMenus() {
  if (current && (!current.isConnected || current.closest('[inert],[hidden]'))) closeMenu();
}

export function bindProjectMenus() {
  document.addEventListener('toggle', event => {
    const menu = event.target;
    if (!menu.matches?.('details.project-menu')) return;
    if (!menu.open || !menu.isConnected) { if (current === menu) closeMenu(); return; }
    if (current && current !== menu) closeMenu();
    current = menu;
    placeMenu(menu);
  }, true);
  document.addEventListener('pointerdown', event => {
    if (current && !current.contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (current && !current.contains(event.target)) closeMenu();
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-act="project-manage"]')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && current?.open && current.isConnected) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  }, true);
  document.addEventListener('scroll', event => {
    if (current && !current.querySelector('[data-project-menu-panel]').contains(event.target)) closeMenu();
  }, true);
  window.addEventListener('resize', () => closeMenu());
}
