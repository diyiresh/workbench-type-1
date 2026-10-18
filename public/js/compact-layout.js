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
let sidebarButton;

function sidebarOpen() { return mobile.matches ? mobileOpen : !desktopCollapsed; }

function sidebarToggle() {
  if (!sidebarButton) {
    sidebarButton = document.createElement('button');
    sidebarButton.type = 'button';
    sidebarButton.className = 'sidebar-toggle';
    sidebarButton.setAttribute('data-sidebar-toggle', '');
    sidebarButton.setAttribute('aria-controls', 'sidebar');
    sidebarButton.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>';
  }
  return sidebarButton;
}

function applySidebar() {
  const sidebar = document.getElementById('sidebar');
  const workspace = document.getElementById('workspace');
  const rail = document.getElementById('rail');
  const open = sidebarOpen();
  const modal = mobile.matches && open;
  const focusWasInside = sidebar.contains(document.activeElement);
  const toggle = sidebarToggle();
  const focusWasToggle = document.activeElement === toggle;
  const tools = document.getElementById('rail-tools');
  const host = open ? sidebar.querySelector('[data-sidebar-toggle-host]') : tools;
  // Keep one real control on the navigation side, including when the sidebar is hidden.
  if (toggle.parentElement !== host) host.append(toggle);
  tools.hidden = open;
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
  if (toggle) {
    const label = tr(open ? '收起侧栏' : '展开侧栏');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    if ((!open && focusWasInside) || focusToggleAfterNavigation || focusWasToggle) {
      toggle.focus({ preventScroll:true });
      focusToggleAfterNavigation = false;
    }
  }
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
      if (mobileOpen) sidebarToggle().focus();
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

export function stageDescription(run, item, kind = 'instruction') {
  const review = kind === 'review';
  const content = review ? item.review.comment : item.instruction;
  const key = JSON.stringify([run.id, item.id, kind]);
  const open = projectId === run.id && expandedStages.has(key);
  const id = 'stage-' + kind + '-' + encodeURIComponent(run.id) + '-' + encodeURIComponent(item.id);
  return `<div class="stage-description${review ? ' agenda-review' : ''}" data-stage-description="${esc(key)}" data-stage-project="${esc(run.id)}" data-stage-kind="${kind}">${review ? `<b>${tr('退回意见：')}</b>` : ''}<p class="stage-instruction" id="${esc(id)}" data-expanded="${open}">${esc(content)}</p><button type="button" class="tiny stage-description-toggle" data-stage-toggle aria-expanded="${open}" aria-controls="${esc(id)}" hidden>${tr(open ? '收起详情' : '展开详情')}</button></div>`;
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
