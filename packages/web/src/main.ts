import './styles/base.css';
import './styles/room.css';
import './styles/pages.css';
import { closeAllDialogs } from './ui/dom';
import { landingScreen } from './screens/landing';
import { roomScreen } from './screens/room';
import { archiveScreen } from './screens/archive';
import { privacyScreen } from './screens/privacy';
import { noticeScreen } from './screens/notice';
import { navigate, setRenderer } from './router';

type Cleanup = (() => void) | void;
let cleanup: Cleanup;


function render() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  closeAllDialogs();
  document.body.className = '';
  document.title = '들렀다감 · 겨울 트리 꾸미기';
  const root = document.getElementById('app')!;
  const p = decodeURIComponent(location.pathname).replace(/\/+$/, '') || '/';
  let m: RegExpExecArray | null;
  if (p === '/') cleanup = landingScreen(root);
  else if ((m = /^\/r\/([^/]+)$/.exec(p))) cleanup = roomScreen(root, { code: m[1] });
  else if (p === '/archive') cleanup = archiveScreen(root);
  else if ((m = /^\/archive\/([0-9a-f]{32})$/.exec(p))) cleanup = roomScreen(root, { archiveRoomId: m[1] });
  else if (p === '/privacy') cleanup = privacyScreen(root);
  else cleanup = noticeScreen(root, { title: '페이지를 찾을 수 없어요', body: '주소를 다시 확인해 주세요.' });
  window.scrollTo(0, 0);
}

// 같은 앱 안의 링크는 새로고침 없이 이동
document.addEventListener('click', e => {
  const a = (e.target as Element).closest?.('a[data-link]') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href')!);
});
window.addEventListener('popstate', render);
setRenderer(render);

render();
