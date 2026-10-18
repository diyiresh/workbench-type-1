import { esc } from './core.js';
import { t as tr } from './i18n.js';

const SIDEBAR_KEY = 'bench-secondary-sidebar-v1';
const mobile = window.matchMedia('(max-width:720px)');
let desktopCollapsed = false;
try { desktopCollapsed = localStorage.getItem(SIDEBAR_KEY) === 'collapsed'; } catch { /* Memory-only preference. */ }
let mobileOpen = false;
let focusToggleAfterNavigation = false;
let projectId = null;
const expandedStages = new Set();
let stageObserver;

function sidebarOpen() { return mobile.matches ? mobileOpen : !desktopCollapsed; }

export function sidebarToggle() {
  const label = tr(sidebarOpen() ? '收起侧栏' : '展开侧栏');
  return `<button type="button" class="ghost sidebar-toggle" data-sidebar-toggle aria-controls="sidebar" aria-expanded="${sidebarOpen()}" title="${esc(label)}"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg><span>${esc(label)}</span></button>`;
}

function applySidebar() {
  const sidebar = document.getElementById('sidebar');
  const workspace = document.getElementById('workspace');
  const rail = document.getElementById('rail');
  const open = sidebarOpen();
  const modal = mobile.matches && open;
  const focusWasInside = sidebar.contains(document.activeElement);
  document.getElementById('shell').dataset.sidebarCollapsed = String(!open);
  sidebar.hidden = !open;
  sidebar.inert = !open;
  sidebar.classList.toggle('open', modal);
  if (modal) {
    sidebar.setAttribute('aria-modal', 'true');
    sidebar.setAttribute('role', 'dialog');
    sidebar.setAttribute('aria-label', tr('二级导航'));
  } else {
    sidebar.removeAttribute('aria-modal');
    sidebar.removeAttribute('role');
    sidebar.removeAttribute('aria-label');
  }
  document.getElementById('sidebar-backdrop').hidden = !modal;
  workspace.inert = modal;
  rail.inert = modal;
  const toggle = document.querySelector('[data-sidebar-toggle]');
  if (toggle) {
    const label = tr(open ? '收起侧栏' : '展开侧栏');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = label;
    toggle.querySelector('span').textContent = label;
    if ((!open && focusWasInside) || focusToggleAfterNavigation || (!mobile.matches && document.activeElement?.matches('.sidebar-dismiss'))) {
      toggle.focus({ preventScroll:true });
      focusToggleAfterNavigation = false;
    }
  }
  const close = sidebar.querySelector('[data-sidebar-close]');
  close.textContent = tr('关闭侧栏');
}

function closeMobile({ restoreFocus = true } = {}) {
  if (!mobileOpen) return;
  mobileOpen = false;
  applySidebar();
  if (restoreFocus) document.querySelector('[data-sidebar-toggle]')?.focus({ preventScroll:true });
}

// Sidebar changes never render the workspace or write to the business ledger.
export function bindCompactLayout() {
  document.addEventListener('click', event => {
    if (event.target.closest('[data-sidebar-toggle]')) {
      if (mobile.matches) mobileOpen = !mobileOpen;
      else {
        desktopCollapsed = !desktopCollapsed;
        try { localStorage.setItem(SIDEBAR_KEY, desktopCollapsed ? 'collapsed' : 'expanded'); } catch { /* Memory-only. */ }
      }
      applySidebar();
      if (mobileOpen) document.querySelector('#sidebar [data-sidebar-close]').focus();
      return;
    }
    if (event.target.closest('[data-sidebar-close]')) { closeMobile(); return; }
    if (mobileOpen && event.target.closest('#channels a,#channels [data-sec],#sidebar .add-mod')) {
      closeMobile({ restoreFocus:false });
      focusToggleAfterNavigation = true;
    }
    const button = event.target.closest('[data-stage-toggle]');
    if (button) {
      const section = button.closest('[data-stage-description]');
      const key = section.dataset.stageDescription;
      const open = !expandedStages.has(key);
      if (open) expandedStages.add(key); else expandedStages.delete(key);
      setStageExpanded(section, open);
    }
  });
  document.addEventListener('keydown', event => {
    if (!mobileOpen || !mobile.matches) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMobile();
    } else if (event.key === 'Tab') {
      const controls = [...document.getElementById('sidebar').querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')]
        .filter(element => !element.disabled && element.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  mobile.addEventListener('change', () => {
    mobileOpen = false;
    applySidebar();
  });
  window.addEventListener('hashchange', () => closeMobile({ restoreFocus:false }));
  applySidebar();
}

export function stageDescription(run, item) {
  const key = JSON.stringify([run.id, item.id]);
  const open = projectId === run.id && expandedStages.has(key);
  const id = 'stage-instruction-' + encodeURIComponent(run.id) + '-' + encodeURIComponent(item.id);
  return `<div class="stage-description" data-stage-description="${esc(key)}" data-stage-project="${esc(run.id)}"><p class="stage-instruction" id="${esc(id)}" data-expanded="${open}">${esc(item.instruction)}</p><button type="button" class="tiny stage-description-toggle" data-stage-toggle aria-expanded="${open}" aria-controls="${esc(id)}" hidden>${tr(open ? '收起详情' : '展开详情')}</button></div>`;
}

function setStageExpanded(section, open) {
  section.querySelector('.stage-instruction').dataset.expanded = String(open);
  const button = section.querySelector('[data-stage-toggle]');
  button.setAttribute('aria-expanded', String(open));
  button.textContent = tr(open ? '收起详情' : '展开详情');
}

// Measure rendered overflow: a short description needs no extra control.
export function mountCompactLayout() {
  applySidebar();
  stageObserver?.disconnect();
  const sections = [...document.querySelectorAll('[data-stage-description]')];
  const nextProject = sections[0]?.dataset.stageProject || null;
  if (projectId !== nextProject) expandedStages.clear();
  projectId = nextProject;
  if (!sections.length) return;
  function measure(section) {
    if (!section.isConnected) return;
    const text = section.querySelector('.stage-instruction');
    const button = section.querySelector('[data-stage-toggle]');
    button.hidden = text.scrollHeight <= parseFloat(getComputedStyle(text).lineHeight) * 4 + 1;
  }
  stageObserver = new ResizeObserver(entries => {
    for (const entry of entries) measure(entry.target.parentElement);
  });
  for (const section of sections) {
    setStageExpanded(section, expandedStages.has(section.dataset.stageDescription));
    measure(section);
    stageObserver.observe(section.querySelector('.stage-instruction'));
  }
}
