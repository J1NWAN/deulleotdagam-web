// TODO(open-question #13): 개인정보처리방침 문구는 법률 전문가 상담 후 채운다. 지금은 자리만 둔다.
export function privacyScreen(root: HTMLElement) {
  document.title = '개인정보처리방침 · 들렀다감';
  root.innerHTML = `
    <div class="page">
      <header class="page-top"><a class="brand" href="/" data-link>들렀다감</a><span class="sub">개인정보처리방침</span></header>
      <main class="main">
        <article class="doc">
          <h1>개인정보처리방침</h1>
          <p>준비 중이에요. 정식 문구는 곧 올라와요.</p>
        </article>
      </main>
    </div>`;
}
