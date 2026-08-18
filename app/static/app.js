import { renderCard, CANVAS_W, CANVAS_H } from '/static/card.js';

const $ = (id) => document.getElementById(id);
const state = {
  keywords: null,
  angle: null,
  project: null,
  cardIndex: 0,
  layerId: null,
  settings: null,
  source: null,   // 원문 요약 결과 (원문 모드일 때만)
};

/* ─────────────────────────────────────────── 유틸 */

function status(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}

/* ── 내 API 키는 내 브라우저에만 둔다. 서버로는 요청할 때만 헤더로 보낸다. */
const KEY_STORE = 'myohan.keys.v1';

function myKeys() {
  try { return JSON.parse(localStorage.getItem(KEY_STORE) || '{}'); }
  catch { return {}; }
}
function setMyKey(name, value) {
  const keys = myKeys();
  if (value) keys[name] = value; else delete keys[name];
  localStorage.setItem(KEY_STORE, JSON.stringify(keys));
}
function keyHeaders() {
  const k = myKeys();
  const h = {};
  if (k.anthropic) h['X-Anthropic-Key'] = k.anthropic;
  if (k.openai) h['X-OpenAI-Key'] = k.openai;
  return h;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...keyHeaders(), ...(options.headers || {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* 본문 없음 */ }
    throw new Error(detail);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

async function run(label, fn) {
  status(label + '…', 'busy');
  try {
    const out = await fn();
    status(label + ' 완료', 'ok');
    return out;
  } catch (err) {
    status(err.message, 'error');
    throw err;
  }
}

function showView(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'library') loadLibrary();
  if (name === 'editor') requestAnimationFrame(fitStage);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});
document.querySelectorAll('.itab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.itab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.ipanel').forEach((p) => {
      p.classList.toggle('active', p.id === 'panel-' + tab.dataset.panel);
    });
  });
});

/* ─────────────────────────────────────────── 0. 원문 붙여넣기 */

document.querySelectorAll('.mode').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('active', b === btn));
    const useSource = btn.dataset.mode === 'source';
    $('source-box').hidden = !useSource;
    if (!useSource) clearSource();
  });
});

function clearSource() {
  state.source = null;
  $('source-text').value = '';
  $('source-origin').value = '';
  $('source-meta').textContent = '';
  $('source-summary').hidden = true;
  $('source-summary').innerHTML = '';
}
$('btn-clear-source').addEventListener('click', clearSource);

$('source-text').addEventListener('input', () => {
  const n = $('source-text').value.length;
  $('source-meta').textContent = n ? `${n.toLocaleString()}자` : '';
});

$('source-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $('source-text').value = reader.result;
    $('source-text').dispatchEvent(new Event('input'));
    if (!$('source-origin').value) $('source-origin').value = file.name;
    status(`${file.name} 을 불러왔습니다.`, 'ok');
  };
  reader.onerror = () => status('파일을 읽지 못했습니다.', 'error');
  reader.readAsText(file, 'utf-8');
  e.target.value = '';   // 같은 파일을 다시 고를 수 있게
});

$('btn-summarize').addEventListener('click', async () => {
  const text = $('source-text').value;
  if (text.trim().length < 50) { status('원문을 50자 이상 붙여넣어 주세요.', 'error'); return; }
  const data = await run('원문 요약', () =>
    api('/api/summarize', {
      method: 'POST',
      body: JSON.stringify({ text, origin: $('source-origin').value }),
    }));
  state.source = data;
  renderSourceSummary(data);
});

function renderSourceSummary(s) {
  const box = $('source-summary');
  box.hidden = false;
  const facts = s.facts.length
    ? s.facts.map((f) => `<li>${esc(f.claim)} <span style="opacity:.6">— ${esc(f.detail)}</span></li>`).join('')
    : '<li style="opacity:.6">원문에 인용할 만한 구체적 사실이 없습니다.</li>';
  box.innerHTML = `
    <dl>
      <dt>원문</dt><dd><b>${esc(s.title)}</b> <span class="chip">${esc(s.kind)}</span></dd>
      <dt>요약</dt><dd style="white-space:pre-wrap">${esc(s.summary)}</dd>
      <dt>핵심</dt><dd><ul style="margin:0;padding-left:18px">${s.key_points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></dd>
      <dt>인용 가능</dt><dd><ul style="margin:0;padding-left:18px">${facts}</ul></dd>
      <dt>주의</dt><dd style="opacity:.8">${esc(s.cautions)}</dd>
    </dl>
    <h2 style="margin:18px 0 8px;font-size:14px">주제 후보 — 누르면 아래 주제 칸에 들어갑니다</h2>
    ${s.suggested_topics.map((t, i) =>
      `<button class="topic-pick" data-i="${i}"><b>${esc(t.topic)}</b><span>${esc(t.why)}</span></button>`).join('')}`;

  box.querySelectorAll('.topic-pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('topic').value = s.suggested_topics[Number(btn.dataset.i)].topic;
      $('topic').focus();
      status('주제를 채웠습니다. 아래에서 키워드를 뽑으세요.', 'ok');
    });
  });

  if (s.warning) status(s.warning, 'error');
  $('source-meta').textContent =
    `${s.char_count.toLocaleString()}자 요약 완료` + (s.truncated ? ' (일부만 사용)' : '');
}

/* ─────────────────────────────────────────── 1. 주제 */

$('btn-keywords').addEventListener('click', async () => {
  const topic = $('topic').value.trim();
  if (!topic) { status('주제를 입력하세요.', 'error'); return; }
  const data = await run('키워드·전략 분석', () =>
    api('/api/keywords', {
      method: 'POST',
      body: JSON.stringify({ topic, note: $('topic-note').value, source: state.source }),
    }));
  state.keywords = data;
  state.angle = null;
  renderKeywords(data);
  showView('angle');
});

function renderKeywords(data) {
  $('keyword-summary').innerHTML = `
    <dl>
      <dt>좁힌 주제</dt><dd>${esc(data.topic_refined)}</dd>
      <dt>타깃</dt><dd>${esc(data.audience)}</dd>
      <dt>고민</dt><dd>${data.pain_points.map(esc).join(' · ')}</dd>
      <dt>핵심 키워드</dt><dd class="chips">${data.core_keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</dd>
      <dt>검색 키워드</dt><dd class="chips">${data.search_keywords.map((k) => `<span class="chip">${esc(k)}</span>`).join('')}</dd>
      <dt>참고 노트</dt><dd>${(data._sources || []).map(esc).join(' · ') || '—'}</dd>
    </dl>`;

  $('angles').innerHTML = data.angles.map((a, i) => `
    <div class="angle" data-i="${i}">
      <div class="tagline">
        <span class="chip">${esc(a.concept_axis)} 컨셉</span>
        <span class="chip">${esc(a.post_format)}</span>
        <span class="chip">퍼널 ${esc(a.funnel_stage)}</span>
      </div>
      <div class="hook">${esc(a.hook)}</div>
      <div class="oneline">${esc(a.one_line)}</div>
      <div class="why">${esc(a.why)}</div>
      <div class="cta">CTA 키워드 · ${esc(a.cta_keyword)}</div>
    </div>`).join('');

  document.querySelectorAll('.angle').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.angle').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      state.angle = data.angles[Number(el.dataset.i)];
      $('btn-compose').disabled = false;
    });
  });
  $('btn-compose').disabled = true;
}

/* ─────────────────────────────────────────── 2. 구성 */

$('btn-compose').addEventListener('click', async () => {
  if (!state.angle) return;
  const project = await run('카드 구성 생성', () =>
    api('/api/compose', {
      method: 'POST',
      body: JSON.stringify({
        topic: $('topic').value.trim(),
        angle: state.angle,
        keywords: state.keywords,
        card_count: Number($('card-count').value),
        theme: $('theme-key').value,
        note: $('compose-note').value,
        source: state.source,
      }),
    }));
  openProject(project);
});

/* ─────────────────────────────────────────── 3. 편집 */

function openProject(project) {
  state.project = project;
  state.cardIndex = 0;
  state.layerId = null;
  // fitStage()가 실제 크기를 재려면 편집 뷰가 먼저 보여야 한다
  showView('editor');
  renderFilmstrip();
  renderStage();
  fillPostPanel();
}

function card() { return state.project.cards[state.cardIndex]; }

function renderFilmstrip() {
  const strip = $('filmstrip');
  strip.innerHTML = state.project.cards.map((c, i) => `
    <div class="film ${i === state.cardIndex ? 'active' : ''}" data-i="${i}"
         style="${c.image ? `background-image:url('${c.image}')` : ''}">
      <b>${String(i + 1).padStart(2, '0')}</b>
      <span>${esc((c.title || '').replace(/\n/g, ' '))}</span>
    </div>`).join('');
  strip.querySelectorAll('.film').forEach((el) => {
    el.addEventListener('click', () => {
      state.cardIndex = Number(el.dataset.i);
      state.layerId = null;
      renderFilmstrip();
      renderStage();
    });
  });
}

function renderStage() {
  const stage = $('stage');
  renderCard(stage, state.project, card(), { editable: true });
  $('card-label').textContent = `${state.cardIndex + 1} / ${state.project.cards.length}`;
  bindLayerInteractions(stage);
  fitStage();
  fillCardPanel();
  fillImagePanel();
  selectLayer(state.layerId);
}

function fitStage() {
  const scroll = document.querySelector('.canvas-scroll');
  if (!scroll || !state.project) return;
  // 뷰가 아직 안 보이면 clientWidth/Height가 0이라 배율이 음수가 된다. 그때는 건너뛴다.
  if (scroll.clientWidth < 40 || scroll.clientHeight < 40) return;
  const scale = Math.max(0.05, Math.min(
    (scroll.clientWidth - 24) / CANVAS_W,
    (scroll.clientHeight - 12) / CANVAS_H,
    1));
  const stage = $('stage');
  stage.style.transform = `scale(${scale})`;
  const scaler = $('scaler');
  scaler.style.width = CANVAS_W * scale + 'px';
  scaler.style.height = CANVAS_H * scale + 'px';
  scaler.dataset.scale = scale;
}
window.addEventListener('resize', fitStage);

/* 드래그 이동 + 더블클릭 인라인 편집 */
function bindLayerInteractions(stage) {
  stage.querySelectorAll('.layer').forEach((el) => {
    el.addEventListener('mousedown', (ev) => {
      if (el.isContentEditable) return;
      ev.preventDefault();
      selectLayer(el.dataset.layerId);
      const layer = findLayer(el.dataset.layerId);
      const scale = Number($('scaler').dataset.scale) || 1;
      const startX = ev.clientX, startY = ev.clientY;
      const originX = layer.x, originY = layer.y;

      const move = (e) => {
        layer.x = clamp(originX + ((e.clientX - startX) / scale / CANVAS_W) * 100, -10, 100);
        layer.y = clamp(originY + ((e.clientY - startY) / scale / CANVAS_H) * 100, -5, 100);
        el.style.left = layer.x + '%';
        el.style.top = layer.y + '%';
        $('l-x').value = layer.x.toFixed(1);
        $('l-y').value = layer.y.toFixed(1);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });

    el.addEventListener('dblclick', () => {
      el.contentEditable = 'true';
      el.focus();
      document.execCommand('selectAll', false, null);
    });
    el.addEventListener('blur', () => {
      if (!el.isContentEditable) return;
      el.contentEditable = 'false';
      const layer = findLayer(el.dataset.layerId);
      layer.text = el.innerText;
      $('l-text').value = layer.text;
      renderFilmstrip();
    });
  });
}

function findLayer(id) {
  return (card().layers || []).find((l) => l.id === id);
}

function selectLayer(id) {
  state.layerId = id;
  document.querySelectorAll('#stage .layer').forEach((el) => {
    el.classList.toggle('selected', el.dataset.layerId === id);
  });
  const layer = id ? findLayer(id) : null;
  $('layer-empty').hidden = !!layer;
  $('layer-form').hidden = !layer;
  if (!layer) return;
  $('l-text').value = layer.text;
  $('l-x').value = layer.x.toFixed(1);
  $('l-y').value = layer.y.toFixed(1);
  $('l-w').value = layer.w;
  $('l-size').value = layer.size;
  $('l-weight').value = String(layer.weight);
  $('l-lh').value = layer.lineHeight;
  $('l-align').value = layer.align;
  $('l-color').value = toHex(layer.color);
}

const LAYER_FIELDS = {
  'l-text': ['text', String],
  'l-x': ['x', Number], 'l-y': ['y', Number], 'l-w': ['w', Number],
  'l-size': ['size', Number], 'l-weight': ['weight', Number],
  'l-lh': ['lineHeight', Number], 'l-align': ['align', String], 'l-color': ['color', String],
};
Object.entries(LAYER_FIELDS).forEach(([id, [key, cast]]) => {
  $(id).addEventListener('input', () => {
    const layer = state.layerId && findLayer(state.layerId);
    if (!layer) return;
    layer[key] = cast($(id).value);
    renderStage();
  });
});

$('btn-del-layer').addEventListener('click', () => {
  const c = card();
  c.layers = c.layers.filter((l) => l.id !== state.layerId);
  state.layerId = null;
  renderStage();
});

$('btn-prev').addEventListener('click', () => step(-1));
$('btn-next').addEventListener('click', () => step(1));
function step(delta) {
  const next = state.cardIndex + delta;
  if (next < 0 || next >= state.project.cards.length) return;
  state.cardIndex = next;
  state.layerId = null;
  renderFilmstrip();
  renderStage();
}

/* ── 카드 패널 */
const CARD_FIELDS = { 'c-badge': 'badge', 'c-title': 'title', 'c-subtitle': 'subtitle', 'c-body': 'body', 'c-note': 'note', 'c-tip': 'tip' };
function fillCardPanel() {
  const c = card();
  $('c-role').value = c.role || '';
  Object.entries(CARD_FIELDS).forEach(([id, key]) => { $(id).value = c[key] || ''; });
}
Object.entries(CARD_FIELDS).forEach(([id, key]) => {
  $(id).addEventListener('input', () => { card()[key] = $(id).value; renderFilmstrip(); });
});

$('btn-relayout').addEventListener('click', async () => {
  const c = card();
  const layers = c.layers || [];
  // 텍스트만 현재 필드 값으로 되돌리고 위치/스타일은 유지한다
  const map = { badge: 'badge', title: 'title', subtitle: 'subtitle', body: 'body', note: 'note', tip: 'tip' };
  Object.entries(map).forEach(([lid, key]) => {
    const layer = layers.find((l) => l.id === lid);
    if (layer) layer.text = c[key] || '';
  });
  c.layers = layers.filter((l) => String(l.text).trim());
  renderStage();
  renderFilmstrip();
});

$('btn-rewrite').addEventListener('click', async () => {
  const instruction = $('c-instruction').value.trim();
  if (!instruction) { status('무엇을 고칠지 적어주세요.', 'error'); return; }
  const result = await run('카드 다시 쓰기', () =>
    api(`/api/projects/${state.project.id}/cards/${state.cardIndex + 1}/rewrite`, {
      method: 'POST', body: JSON.stringify({ instruction }),
    }));
  const c = card();
  ['badge', 'title', 'subtitle', 'body', 'note', 'tip', 'image_prompt'].forEach((k) => { c[k] = result[k]; });
  $('btn-relayout').click();
  status('다시 씀 · ' + result.why, 'ok');
});

/* ── 이미지 패널 */
function fillImagePanel() {
  const c = card();
  $('scene-note').textContent = '';
  $('img-thumb').style.backgroundImage = c.image ? `url('${c.image}')` : '';
  $('img-fx').value = (c.focus || [0.5, 0.5])[0];
  $('img-fy').value = (c.focus || [0.5, 0.5])[1];
  $('img-overlay').value = c.overlay == null ? 0.55 : c.overlay;
}
['img-fx', 'img-fy'].forEach((id, i) => {
  $(id).addEventListener('input', () => {
    const c = card();
    c.focus = c.focus || [0.5, 0.5];
    c.focus[i] = Number($(id).value);
    renderStage();
  });
});
$('img-overlay').addEventListener('input', () => { card().overlay = Number($('img-overlay').value); renderStage(); });

$('btn-refine-prompt').addEventListener('click', async () => {
  const c = card();
  const res = await run('장면 다시 잡기', () =>
    api(`/api/projects/${state.project.id}/cards/${state.cardIndex + 1}/refine-prompt`, {
      method: 'POST',
      body: JSON.stringify({
        // 편집 중인 최신 문구를 기준으로 잡는다
        badge: c.badge, title: c.title, subtitle: c.subtitle,
        body: c.body, note: c.note, role: c.role, template: c.template,
        extra: $('img-extra').value,
      }),
    }));
  c.image_prompt = res.image_prompt;
  $('scene-note').textContent = `🎬 ${res.scene_ko}\n   ${res.why}`;
  status('장면을 다시 잡았습니다. 이제 이미지를 생성하세요.', 'ok');
});

$('btn-gen-image').addEventListener('click', async () => {
  const res = await run('이미지 생성', () =>
    api(`/api/projects/${state.project.id}/cards/${state.cardIndex + 1}/image`, {
      method: 'POST', body: JSON.stringify({ extra: $('img-extra').value }),
    }));
  card().image = res.image + '?t=' + Date.now();
  renderStage();
  renderFilmstrip();
});

$('btn-copy-prompt').addEventListener('click', async () => {
  const extra = encodeURIComponent($('img-extra').value);
  const res = await api(`/api/projects/${state.project.id}/image-prompt/${state.cardIndex + 1}?extra=${extra}`);
  await navigator.clipboard.writeText(res.prompt);
  status('프롬프트를 복사했습니다. ChatGPT에 붙여넣으세요.', 'ok');
});

const drop = $('img-drop');
drop.addEventListener('click', () => $('img-file').click());
$('img-file').addEventListener('change', (e) => e.target.files[0] && uploadImage(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('over');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.remove('over');
}));
drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && uploadImage(e.dataTransfer.files[0]));

function uploadImage(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const res = await run('이미지 등록', () =>
      api(`/api/projects/${state.project.id}/cards/${state.cardIndex + 1}/upload`, {
        method: 'POST', body: JSON.stringify({ data_url: reader.result }),
      }));
    card().image = res.image + '?t=' + Date.now();
    renderStage();
    renderFilmstrip();
  };
  reader.readAsDataURL(file);
}

/* ── 발행 패널 */
const POST_FIELDS = { 'p-caption': 'caption', 'p-cta': 'cta_comment', 'p-teaser': 'next_teaser', 'p-status': 'status', 'p-memo': 'memo' };
function fillPostPanel() {
  const p = state.project;
  Object.entries(POST_FIELDS).forEach(([id, key]) => { $(id).value = p[key] || ''; });
  $('p-tags').value = (p.hashtags || []).join(' ');
  const checks = (p.self_check || []).map((c) =>
    `<div>${c.pass ? '✅' : '⚠️'} ${esc(c.item)} <span style="opacity:.6">— ${esc(c.reason)}</span></div>`).join('');
  const src = p.source
    ? `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #2b3240">
         📄 원문 · <b>${esc(p.source.title || '')}</b>
         <span style="opacity:.6">${esc(p.source.origin || '직접 붙여넣음')}</span></div>`
    : '';
  $('strategy-box').innerHTML = src +
    `<div style="margin-bottom:10px"><b>${esc(p.concept_sentence || '')}</b></div>` +
    `<div style="white-space:pre-wrap;margin-bottom:12px">${esc(p.strategy_notes || '')}</div>` + checks;
}
Object.entries(POST_FIELDS).forEach(([id, key]) => {
  $(id).addEventListener('input', () => { state.project[key] = $(id).value; });
});
$('p-tags').addEventListener('input', () => {
  state.project.hashtags = $('p-tags').value.split(/\s+/).filter(Boolean);
});
$('btn-copy-caption').addEventListener('click', async () => {
  const p = state.project;
  await navigator.clipboard.writeText(
    [p.caption, '', p.cta_comment, '', (p.hashtags || []).join(' ')].join('\n'));
  status('캡션을 복사했습니다.', 'ok');
});

/* ── 저장 · 내보내기 */
$('btn-save').addEventListener('click', async () => {
  const res = await run('저장', () =>
    api(`/api/projects/${state.project.id}`, { method: 'PUT', body: JSON.stringify(state.project) }));
  status(`저장 완료 · 엑셀 DB 갱신 (${res.db})`, 'ok');
});

$('btn-export').addEventListener('click', async () => {
  await api(`/api/projects/${state.project.id}`, { method: 'PUT', body: JSON.stringify(state.project) });
  const res = await run('PNG 내보내기', () =>
    api(`/api/projects/${state.project.id}/export`, { method: 'POST', body: JSON.stringify({}) }));
  status(`${res.files.length}장 저장 · ${res.folder}`, 'ok');
});

$('btn-download').addEventListener('click', () => {
  window.location = `/api/projects/${state.project.id}/download`;
});

/* ─────────────────────────────────────────── 보관함 */

async function loadLibrary() {
  const rows = await api('/api/projects');
  $('lib-body').innerHTML = rows.map((r) => `
    <tr data-id="${esc(r.id)}">
      <td>${esc(r.created)}</td>
      <td>${esc(r.topic)}</td>
      <td>${esc(r.concept_axis)}</td>
      <td>${esc(r.post_format)}</td>
      <td>${r.cards}</td>
      <td>${esc(r.status)}</td>
      <td><button class="open">열기</button> <button class="danger del">삭제</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="color:#98a2b3">아직 없습니다.</td></tr>';

  $('lib-body').querySelectorAll('.open').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      openProject(await api('/api/projects/' + encodeURIComponent(id)));
    });
  });
  $('lib-body').querySelectorAll('.del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      if (!confirm(`"${id}" 프로젝트를 폴더째 삭제합니다. 계속할까요?`)) return;
      await run('삭제', () => api('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' }));
      loadLibrary();
    });
  });
}
$('btn-open-db').addEventListener('click', () => { window.location = '/api/db'; });

/* ─────────────────────────────────────────── 설정 */

/* 어떤 키가 실제로 쓰이는지 한눈에. 키 값은 뒤 4자리만 보여준다. */
function keyLabel(source, tail) {
  if (source === 'user') return `· 내 키 ${tail} 사용 중 (이 브라우저)`;
  if (source === 'shared') return `· 이 PC 공용 키 ${tail} 사용 중`;
  if (source === 'env') return `· OS 환경변수 ${tail} 사용 중`;
  return '· 없음 — 본인 키를 입력하세요';
}

async function loadSettings() {
  const s = await api('/api/settings');
  state.settings = s;
  $('s-model').value = s.claude_model;
  $('s-provider').value = s.text_provider_pref;
  $('s-otext').value = s.openai_text_model;
  $('s-oeffort').value = s.openai_text_effort;
  $('text-active').textContent = s.text_provider === 'none'
    ? '· 키가 없어 글쓰기를 할 수 없습니다'
    : `· 지금은 ${s.text_provider === 'anthropic' ? 'Claude' : 'OpenAI'} ${s.text_model} 사용 중`;
  $('s-imodel').value = s.image_model;
  $('s-isize').value = s.image_size;
  $('s-imode').value = s.image_mode;
  $('s-require').checked = s.require_user_key;
  $('s-dirs').value = s.strategy_dirs.join('\n');
  $('k-anthropic').textContent = keyLabel(s.anthropic_source, s.anthropic_tail);
  $('k-openai').textContent = keyLabel(s.openai_source, s.openai_tail);
  $('db-path').textContent = s.db_path;
  $('dirs-status').textContent = s.strategy_dirs
    .map((d, i) => `${s.strategy_dirs_exist[i] ? '✅' : '❌ 없음'}  ${d}`).join('\n');
  if (!s.has_anthropic_key) {
    $('create-hint').textContent = '⚠ Anthropic API 키가 없습니다. 설정 탭에서 먼저 등록하세요.';
  } else {
    $('create-hint').textContent = '';
  }
}

async function testKey(provider, boxId, label) {
  const box = $(boxId);
  box.textContent = '확인 중…';
  try {
    const r = await api('/api/test-key', {
      method: 'POST', body: JSON.stringify({ provider }),
    });
    box.textContent = `✅ ${label} 연결 성공 — ${r.display_name || r.model}`;
    status(`${label} 연결 성공`, 'ok');
  } catch (err) {
    box.textContent = `❌ ${err.message}`;
    status(`${label} 연결 실패`, 'error');
  }
}
$('btn-test-anthropic').addEventListener('click', () => testKey('anthropic', 'r-anthropic', 'Claude'));
$('btn-test-openai').addEventListener('click', () => testKey('openai', 'r-openai', 'OpenAI'));

$('btn-list-models').addEventListener('click', async () => {
  const box = $('imodel-status');
  box.textContent = '불러오는 중…';
  try {
    const { models } = await api('/api/image-models');
    $('imodel-list').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
    const current = $('s-imodel').value.trim();
    box.textContent =
      `사용 가능: ${models.join(', ')}` +
      (models.includes(current) ? `\n✅ 지금 설정된 '${current}' 사용 가능`
                                : `\n⚠ 지금 설정된 '${current}' 은(는) 목록에 없습니다`);
  } catch (err) {
    box.textContent = `❌ ${err.message}`;
  }
});

$('btn-save-settings').addEventListener('click', async () => {
  const anth = $('s-anthropic').value.trim();
  const oai = $('s-openai').value.trim();
  const share = $('s-share').checked;

  // 키는 먼저 내 브라우저에 저장한다 (서버에 남기지 않음)
  if (anth) setMyKey('anthropic', anth);
  if (oai) setMyKey('openai', oai);

  await run('설정 저장', () => api('/api/settings', {
    method: 'POST',
    body: JSON.stringify({
      CLAUDE_MODEL: $('s-model').value.trim(),
      TEXT_PROVIDER: $('s-provider').value,
      OPENAI_TEXT_MODEL: $('s-otext').value.trim(),
      OPENAI_TEXT_EFFORT: $('s-oeffort').value,
      IMAGE_MODEL: $('s-imodel').value.trim(),
      IMAGE_SIZE: $('s-isize').value,
      IMAGE_MODE: $('s-imode').value,
      REQUIRE_USER_KEY: $('s-require').checked ? 'true' : 'false',
      OBSIDIAN_STRATEGY_DIRS: $('s-dirs').value.split('\n').map((v) => v.trim()).filter(Boolean),
      // 혼자 쓰는 PC일 때만 공용 .env 에도 저장
      share_keys: share,
      ANTHROPIC_API_KEY: share ? anth : '',
      OPENAI_API_KEY: share ? oai : '',
    }),
  }));
  $('s-anthropic').value = '';
  $('s-openai').value = '';
  loadSettings();
});

$('btn-forget-keys').addEventListener('click', () => {
  if (!confirm('이 브라우저에 저장된 내 API 키를 지웁니다. 계속할까요?')) return;
  localStorage.removeItem(KEY_STORE);
  loadSettings();
  status('내 키를 이 브라우저에서 지웠습니다.', 'ok');
});

async function loadBrand() {
  const { brand, theme_keys } = await api('/api/brand');
  $('theme-key').innerHTML = theme_keys
    .map((k) => `<option value="${k}">${esc(brand.themes[k].label || k)}</option>`).join('');
}

/* ─────────────────────────────────────────── 보조 */

function esc(str) {
  return String(str ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function toHex(color) {
  if (!color) return '#ffffff';
  if (color.startsWith('#')) {
    return color.length === 4
      ? '#' + color.slice(1).replace(/./g, '$&$&')
      : color.slice(0, 7);
  }
  const m = color.match(/\d+/g);
  if (!m) return '#ffffff';
  return '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

loadSettings();
loadBrand();
