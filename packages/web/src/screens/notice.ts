import { esc, itemSvg } from '../render/scene';
import { themeAssets } from '../theme';

export interface NoticeOptions {
  title: string;
  body: string;
  icon?: string;
  actions?: { label: string; href: string; primary?: boolean }[];
}

/** 전체 화면 안내 (없는 방, 삭제된 방, 비활성방, 사용량 초과 등) */
export function noticeScreen(root: HTMLElement, o: NoticeOptions) {
  const theme = themeAssets('pixel');
  const actions = o.actions ?? [{ label: '처음으로', href: '/', primary: true }];
  root.innerHTML = `
    <main class="notice">
      <div class="card" role="alert">
        ${itemSvg(theme, o.icon ?? 'snowflake', 'class="icon" aria-hidden="true"')}
        <h3>${esc(o.title)}</h3>
        <p>${esc(o.body)}</p>
        <div class="row">${actions.map(a => `<a class="pxbtn${a.primary ? ' primary' : ''}" href="${esc(a.href)}" data-link>${esc(a.label)}</a>`).join('')}</div>
      </div>
    </main>`;
}
