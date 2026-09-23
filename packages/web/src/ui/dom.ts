export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg);
  } catch {
    toast(`${text} — 직접 복사해 주세요`, 4000);
  }
}

// ---------- 대화상자: 포커스 이동/복귀, ESC 닫기, Tab 가두기 ----------

const stack: { el: HTMLElement; back: Element | null; locked: boolean; onClose?: () => void }[] = [];

export function openDialog(el: HTMLElement, opts: { focus?: HTMLElement | null; locked?: boolean; onClose?: () => void } = {}) {
  stack.push({ el, back: document.activeElement, locked: !!opts.locked, onClose: opts.onClose });
  el.classList.add('open');
  (opts.focus ?? el.querySelector<HTMLElement>('input, textarea, button'))?.focus();
}

export function closeDialog(el: HTMLElement) {
  const i = stack.findIndex(s => s.el === el);
  if (i < 0) return;
  const [s] = stack.splice(i, 1);
  el.classList.remove('open');
  s.onClose?.();
  if (s.back instanceof HTMLElement && document.contains(s.back)) s.back.focus();
}

export function closeAllDialogs() {
  while (stack.length) closeDialog(stack[stack.length - 1].el);
}

export const topDialog = () => stack[stack.length - 1];

document.addEventListener('keydown', e => {
  const top = topDialog();
  if (!top) return;
  if (e.key === 'Escape' && !top.locked) { e.preventDefault(); closeDialog(top.el); return; }
  if (e.key === 'Tab') {
    const f = [...top.el.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea, a[href], [tabindex]:not([tabindex="-1"])')]
      .filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

document.addEventListener('click', e => {
  const top = topDialog();
  if (top && e.target === top.el && !top.locked) closeDialog(top.el);
});
