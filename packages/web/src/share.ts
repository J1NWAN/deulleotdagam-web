// 완성 결과 공유: 방 전체를 PNG로 만든다. 다른 사람의 메모가 퍼지지 않도록 메모는 기본으로 빼고 토글로 넣는다.
// TODO(open-question #11): 공유 형태 미정. 클라이언트 PNG 생성 + 메모 포함 토글 (임시안)
import { itemName, seasonById, type RoomSnapshot } from '@deulleotdagam/shared';
import { forestSvg } from './render/scene';
import { loadBackground, type ThemeAssets } from './theme';
import { $, closeDialog, openDialog, toast } from './ui/dom';

const W = 1200;
const SCENE_H = 760;
const HEAD_H = 130;
const PAD = 48;
const LINE_H = 36;
const COLORS = { paper: '#fbf3ea', ink: '#2b1a24', soft: '#6b5360', pine: '#1a5a35', line: '#e2cfc5' };
const FONT = '"Gowun Dodum", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

function loadImage(svg: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  return img.decode().then(() => img);
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
  return t + '…';
}

export async function renderShareImage(theme: ThemeAssets, snap: RoomSnapshot, nameOf: (id: string) => string, withMemos: boolean): Promise<Blob> {
  await Promise.all([document.fonts.load(`700 44px ${FONT}`), document.fonts.load(`20px ${FONT}`)]).catch(() => {});
  const memos = withMemos ? snap.placements.filter(p => p.memo).sort((a, b) => a.createdAt - b.createdAt) : [];
  const cols = 2;
  const rows = Math.ceil(memos.length / cols);
  const memoH = memos.length ? 70 + rows * LINE_H + 20 : 0;
  const H = HEAD_H + SCENE_H + memoH + 60;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, W, H);

  // 머리글
  const season = seasonById(snap.seasonId);
  const total = snap.trees.reduce((n, t) => n + t.slots.length, 0);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `700 44px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(fitText(ctx, snap.title, W - PAD * 2 - 220), PAD, 72);
  ctx.font = `20px ${FONT}`;
  ctx.fillStyle = COLORS.soft;
  ctx.fillText(`들렀다감 · ${season?.subtitle ?? ''}`, PAD, 108);
  const done = snap.placements.length === total;
  const badge = done ? '완성!' : `장식 ${snap.placements.length}/${total}`;
  ctx.font = `700 22px ${FONT}`;
  const bw = ctx.measureText(badge).width + 28;
  ctx.fillStyle = done ? COLORS.pine : COLORS.ink;
  ctx.fillRect(W - PAD - bw, 44, bw, 40);
  ctx.fillStyle = '#fff3d6';
  ctx.fillText(badge, W - PAD - bw + 14, 72);

  // 나무 세 그루
  const bg = await loadBackground(snap.background).catch(() => null);
  const scene = await loadImage(forestSvg(theme, snap, W, SCENE_H, { backgroundSvg: bg }));
  ctx.drawImage(scene, 0, HEAD_H);
  ctx.fillStyle = COLORS.ink;
  ctx.fillRect(0, HEAD_H - 3, W, 3);
  ctx.fillRect(0, HEAD_H + SCENE_H, W, 3);

  // 메모 목록
  if (memos.length) {
    let y = HEAD_H + SCENE_H + 56;
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText('남겨진 메모', PAD, y);
    y += 16;
    const colW = (W - PAD * 2) / cols;
    ctx.font = `19px ${FONT}`;
    memos.forEach((p, i) => {
      const x = PAD + (i % cols) * colW;
      const ly = y + Math.floor(i / cols) * LINE_H + 28;
      ctx.fillStyle = COLORS.soft;
      const head = `${itemName(theme.geometry, p.itemId)} · ${nameOf(p.authorId)}  `;
      const headText = fitText(ctx, head, colW * 0.45);
      ctx.fillText(headText, x, ly);
      const hw = ctx.measureText(headText).width;
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(fitText(ctx, p.memo, colW - hw - 16), x + hw, ly);
    });
  }

  ctx.fillStyle = COLORS.soft;
  ctx.font = `18px ${FONT}`;
  ctx.fillText(`${location.host} · 친구 방에 들러 장식 하나 달고 가요`, PAD, H - 24);

  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

let dlg: HTMLElement | null = null;
let url: string | null = null;

export function openShareDialog(theme: ThemeAssets, snap: RoomSnapshot, nameOf: (id: string) => string) {
  if (!dlg || !document.body.contains(dlg)) {
    dlg = document.createElement('div');
    dlg.className = 'scrim';
    dlg.id = 'shareDlg';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'shareTitle');
    dlg.innerHTML = `
      <div class="card wide">
        <h3 id="shareTitle">사진으로 남기기</h3>
        <p>지금 방 모습을 이미지로 저장하거나 공유해요.</p>
        <div class="share-preview" id="sharePreview"><span>이미지를 만드는 중…</span></div>
        <label class="toggle"><input type="checkbox" id="shareMemo"> 메모도 함께 넣기 <small>(다른 사람이 쓴 메모도 보여요)</small></label>
        <div class="row">
          <button class="pxbtn" id="shareClose">닫기</button>
          <button class="pxbtn" id="shareNative" hidden>공유하기</button>
          <a class="pxbtn primary" id="shareSave" download="deulleotdagam.png">이미지 저장</a>
        </div>
      </div>`;
    document.body.appendChild(dlg);
  }
  const d = dlg;
  const memo = d.querySelector<HTMLInputElement>('#shareMemo')!;
  memo.checked = false;
  let blob: Blob | null = null;

  const build = async () => {
    $('sharePreview').innerHTML = '<span>이미지를 만드는 중…</span>';
    try {
      blob = await renderShareImage(theme, snap, nameOf, memo.checked);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      $('sharePreview').innerHTML = `<img src="${url}" alt="${snap.title} 방 모습">`;
      const save = $('shareSave') as HTMLAnchorElement;
      save.href = url;
      save.download = `${snap.title.replace(/[\\/:*?"<>|]/g, '')}.png`;
      const file = new File([blob], save.download, { type: 'image/png' });
      $('shareNative').hidden = !(navigator.canShare?.({ files: [file] }));
    } catch (err) {
      console.error(err);
      $('sharePreview').innerHTML = '<span>이미지를 만들지 못했어요</span>';
    }
  };

  memo.onchange = build;
  d.querySelector<HTMLElement>('#shareClose')!.onclick = () => closeDialog(d);
  d.querySelector<HTMLElement>('#shareNative')!.onclick = async () => {
    if (!blob) return;
    try {
      await navigator.share({ files: [new File([blob], 'deulleotdagam.png', { type: 'image/png' })], title: snap.title });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') toast('공유하지 못했어요. 이미지 저장을 이용해 주세요');
    }
  };
  openDialog(d, { focus: d.querySelector<HTMLElement>('#shareClose'), onClose: () => { d.remove(); dlg = null; } });
  build();
}
