let renderer: () => void = () => {};

export function setRenderer(fn: () => void) { renderer = fn; }

export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  renderer();
}
