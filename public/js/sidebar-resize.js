import { t as tr } from './i18n.js';

const WIDTH_KEY = 'bench-secondary-sidebar-width-v1';
const narrow = window.matchMedia('(max-width:720px)');
let preferredWidth = null;
try {
  const stored = localStorage.getItem(WIDTH_KEY);
  const value = stored === null ? NaN : Number(stored);
  if (Number.isFinite(value) && value >= 200 && value <= 420) preferredWidth = value;
} catch { /* Keep this browser session usable without storage. */ }
let drag = null;

function limits() {
  const shell = document.getElementById('shell');
  const style = getComputedStyle(shell);
  const rail = parseFloat(style.getPropertyValue('--rail-width'));
  return { min:200, max:Math.max(200, Math.min(420, shell.clientWidth - rail - 360)),
    initial:parseFloat(style.getPropertyValue('--sidebar-default-width')) };
}
function clamp(width) {
  const { min, max } = limits();
  return Math.round(Math.max(min, Math.min(max, width)));
}
function remember(width) {
  preferredWidth = width;
  try {
    if (width === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(width));
  } catch { /* Memory-only preference. */ }
}
function finishDrag(save = false) {
  if (!drag) return;
  const finished = drag;
  drag = null;
  document.documentElement.classList.remove('sidebar-resizing');
  if (finished.handle.hasPointerCapture(finished.pointerId)) finished.handle.releasePointerCapture(finished.pointerId);
  if (save) remember(clamp(finished.width));
  syncSidebarResize();
}

// Preference and effective width differ when a smaller window limits available room.
export function syncSidebarResize() {
  const handle = document.getElementById('sidebar-resizer');
  handle.hidden = narrow.matches || document.getElementById('sidebar').hidden;
  if (handle.hidden && drag) { finishDrag(); return; }
  const { min, max, initial } = limits();
  const width = clamp(drag?.width ?? preferredWidth ?? initial);
  document.getElementById('shell').style.setProperty('--sidebar-width', width + 'px');
  handle.setAttribute('aria-label', tr('调整侧栏宽度'));
  handle.title = tr('拖动调整侧栏宽度，双击或按 Enter 恢复默认');
  handle.setAttribute('aria-valuemin', String(min));
  handle.setAttribute('aria-valuemax', String(max));
  handle.setAttribute('aria-valuenow', String(width));
}

export function bindSidebarResize() {
  const handle = document.getElementById('sidebar-resizer');
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag || handle.hidden) return;
    event.preventDefault();
    handle.focus({ preventScroll:true });
    const width = document.getElementById('sidebar').getBoundingClientRect().width;
    drag = { pointerId:event.pointerId, startX:event.clientX, startWidth:width, width, handle };
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add('sidebar-resizing');
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.width = clamp(drag.startWidth + event.clientX - drag.startX);
    syncSidebarResize();
  });
  handle.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) finishDrag(true); });
  handle.addEventListener('pointercancel', event => { if (drag?.pointerId === event.pointerId) finishDrag(); });
  handle.addEventListener('lostpointercapture', () => finishDrag());
  handle.addEventListener('dblclick', () => { finishDrag(); remember(null); syncSidebarResize(); });
  handle.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finishDrag(); return; }
    if (!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key)) return;
    event.preventDefault();
    finishDrag();
    const { min, max } = limits();
    const current = Number(handle.getAttribute('aria-valuenow'));
    const step = event.shiftKey ? 32 : 8;
    remember(event.key === 'Enter' ? null : clamp(event.key === 'Home' ? min : event.key === 'End' ? max : current + (event.key === 'ArrowLeft' ? -step : step)));
    syncSidebarResize();
  });
  window.addEventListener('resize', () => { finishDrag(); syncSidebarResize(); });
  window.addEventListener('blur', () => finishDrag());
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishDrag(); });
}
