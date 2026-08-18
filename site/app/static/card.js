/* 카드 1장을 1080x1350 스테이지에 그린다.
   편집 화면 미리보기와 PNG 내보내기가 같은 코드를 쓴다. */

const CANVAS_W = 1080;
const CANVAS_H = 1350;

export function renderCard(stage, project, card, opts = {}) {
  const theme = project.theme || {};

  stage.className = 'stage';
  stage.style.width = CANVAS_W + 'px';
  stage.style.height = CANVAS_H + 'px';
  stage.style.background = theme.bg || '#162033';
  stage.innerHTML = '';

  // 배경 이미지
  const bg = document.createElement('div');
  bg.className = 'card-bg';
  if (card.image) {
    const focus = card.focus || [0.5, 0.5];
    bg.style.backgroundImage = `url("${card.image}")`;
    bg.style.backgroundPosition = `${(focus[0] * 100).toFixed(1)}% ${(focus[1] * 100).toFixed(1)}%`;
  } else {
    bg.style.background = `linear-gradient(150deg, ${theme.surface || '#1E2B42'} 0%, ${theme.bg || '#162033'} 70%)`;
  }
  stage.appendChild(bg);

  // 가독성 오버레이
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';
  const strength = card.overlay == null ? 0.55 : Number(card.overlay);
  overlay.style.background =
    `linear-gradient(180deg, ${hexA(theme.bg, strength + 0.2)} 0%, ` +
    `${hexA(theme.bg, strength * 0.35)} 45%, ${hexA(theme.bg, strength + 0.15)} 100%)`;
  stage.appendChild(overlay);

  // 페이지 번호와 브랜드 표기(MYOHAN CUSHION / 묘한쿠션)는 넣지 않는다.
  // 카드에 들어가는 글자는 아래 레이어가 전부이며, 모두 편집·삭제할 수 있다.

  // 텍스트 레이어
  (card.layers || []).forEach((layer) => {
    const el = document.createElement('div');
    el.className = 'layer' + (layer.sticker ? ' sticker' : '');
    el.dataset.layerId = layer.id;
    el.style.left = layer.x + '%';
    el.style.top = layer.y + '%';
    el.style.width = layer.w + '%';
    el.style.fontSize = layer.size + 'px';
    el.style.fontWeight = layer.weight;
    el.style.color = layer.color;
    el.style.textAlign = layer.align;
    el.style.lineHeight = layer.lineHeight;
    el.style.letterSpacing = (layer.letterSpacing || 0) + 'em';
    if (layer.sticker) {
      el.style.background = theme.accent || '#F4D77B';
    }
    el.textContent = layer.text;
    if (opts.editable) {
      el.classList.add('editable');
      el.setAttribute('tabindex', '0');
    }
    stage.appendChild(el);
  });

  return stage;
}

/* #RRGGBB + alpha → rgba() */
function hexA(hex, alpha) {
  const clean = String(hex || '#162033').replace('#', '');
  const n = parseInt(clean.length === 3 ? clean.replace(/./g, '$&$&') : clean, 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export { CANVAS_W, CANVAS_H };
