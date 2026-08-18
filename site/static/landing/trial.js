/* 웹 체험판 — 계정도 서버도 없이 브라우저에서만 돈다.
 *
 * 방문자가 자기 API 키를 넣고, 요청은 브라우저에서 각 회사 서버로 직접 간다.
 * 키는 localStorage 에만 두며 우리 서버로는 아무것도 보내지 않는다.
 * 사용료는 방문자 본인 계정에 청구된다.
 *
 * 여기 담긴 전략 지침은 이 체험판용으로 새로 쓴 것이다.
 * 로컬 프로그램이 쓰는 playbook.md 는 유료 자료라 배포본에 넣지 않는다.
 */
(function () {
  'use strict';

  var panel = document.getElementById('panel-trial');
  if (!panel) return;

  var $ = function (id) { return document.getElementById(id); };
  var KEYS = 'cardnews.trial.keys.v1';
  var W = 1080, H = 1350;

  var THEME = {
    bg: '#162033', surface: '#1E2B42', ink: '#FFFFFF',
    sub: '#C6CCD8', accent: '#F4D77B',
  };

  var state = { angles: null, topic: '', cards: [], idx: 0, caption: '', tags: [], cta: '' };

  /* ───────── 키 (이 브라우저에만) */
  function keys() {
    try { return JSON.parse(localStorage.getItem(KEYS) || '{}'); } catch (e) { return {}; }
  }
  function saveKeys(a, o) {
    var k = keys();
    if (a) k.anthropic = a;
    if (o) k.openai = o;
    localStorage.setItem(KEYS, JSON.stringify(k));
  }
  function tail(v) { return v && v.length > 4 ? '…' + v.slice(-4) : ''; }

  function paintKeyState() {
    var k = keys();
    var parts = [];
    parts.push(k.anthropic ? 'Anthropic ' + tail(k.anthropic) + ' 저장됨' : 'Anthropic 키 없음');
    parts.push(k.openai ? 'OpenAI ' + tail(k.openai) + ' 저장됨' : 'OpenAI 키 없음(배경 이미지 불가)');
    $('t-keystate').textContent = parts.join(' · ');
  }

  $('t-savekeys').addEventListener('click', function () {
    saveKeys($('t-anthropic').value.trim(), $('t-openai').value.trim());
    $('t-anthropic').value = '';
    $('t-openai').value = '';
    paintKeyState();
  });
  $('t-clearkeys').addEventListener('click', function () {
    localStorage.removeItem(KEYS);
    paintKeyState();
  });
  paintKeyState();

  function say(el, msg, kind) {
    var e = $(el);
    e.textContent = msg;
    e.className = 'tstatus' + (kind ? ' ' + kind : '');
  }

  /* ───────── 지침 (체험판 전용으로 새로 쓴 것) */
  var GUIDE = [
    '당신은 한국어 카드뉴스 기획자입니다. 아래 기준을 지켜 구성합니다.',
    '',
    '[앵글]',
    '- 주제를 볼 수 있는 각도는 여러 개입니다: 기능을 다시 해석하기, 파는 사람의 자격,',
    '  쓰는 사람의 정체성, 필요해지는 상황, 체험에서 구매로 가는 순서.',
    '- 앵글 3개는 서로 다른 각도여야 합니다. 비슷하면 실패입니다.',
    '',
    '[글의 목적] 일상글(친밀) · 정보성글(저장) · 구매성글(판매) · 프로모션글(명단수집) 중 하나를 고릅니다.',
    '',
    '[구매성 뼈대] 후킹 → 문제 제기 → 해결 제안 → 상품 연결 + 행동 요청.',
    '- 첫 줄은 눈을 멈추게 합니다. 통념을 뒤집거나 숫자를 씁니다.',
    '- 마지막은 손을 움직이게 합니다. 진입장벽이 낮은 한 가지 행동만 요청합니다.',
    '',
    '[카드 글자 수 — 넘으면 카드가 깨집니다]',
    '- 타이틀: 한 줄 12자 내외, 최대 2줄',
    '- 서브: 한 줄 20자 내외, 최대 2줄',
    '- 본문: 한 줄 22자 내외, 최대 3줄',
    '- 줄바꿈은 \\n 으로 직접 넣어 통제합니다. 어려운 말과 전문가 티를 뺍니다.',
    '',
    '[금지] 링크를 카드에 넣지 않습니다. 근거 없는 수치·효능·의학적 단정을 만들지 않습니다.',
    '건강·행동 주제라면 마지막 카드에 전문가 상담 안내를 넣습니다.',
    '',
    '출력은 유효한 JSON 하나뿐입니다.',
  ].join('\n');

  /* ───────── API 호출 (브라우저 → 각 회사 서버 직접) */
  async function claudeJSON(system, user, schema) {
    var k = keys().anthropic;
    if (!k) throw new Error('Anthropic 키를 먼저 넣어주세요.');
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': k,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        system: system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: schema } },
      }),
    });
    var j = await res.json();
    if (!res.ok) throw new Error(readErr(res.status, j));
    if (j.stop_reason === 'refusal') throw new Error('이 주제는 처리할 수 없습니다. 주제를 바꿔보세요.');
    var t = (j.content || []).find(function (b) { return b.type === 'text'; });
    if (!t) throw new Error('빈 응답을 받았습니다.');
    return JSON.parse(t.text);
  }

  function readErr(status, j) {
    var m = (j && j.error && j.error.message) || '';
    if (status === 401) return 'API 키가 올바르지 않습니다.';
    if (status === 403) return '이 키로는 접근할 수 없습니다. 권한을 확인하세요.';
    if (status === 429) return '요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.';
    if (status === 400 && /credit|balance/i.test(m)) return '계정 잔액이 부족합니다.';
    return '오류 ' + status + (m ? ': ' + m : '');
  }

  async function openaiImage(prompt) {
    var k = keys().openai;
    if (!k) throw new Error('OpenAI 키가 없어 배경을 만들 수 없습니다.');
    var res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: prompt, size: '1024x1536', n: 1 }),
    });
    var j = await res.json();
    if (!res.ok) throw new Error(readErr(res.status, j));
    var d = (j.data || [])[0] || {};
    if (d.b64_json) return 'data:image/png;base64,' + d.b64_json;
    if (d.url) return d.url;
    throw new Error('이미지 응답이 비어 있습니다.');
  }

  /* ───────── 2단계 : 전략 */
  var ANGLE_SCHEMA = {
    type: 'object',
    properties: {
      topic_refined: { type: 'string', description: '더 좁힌 주제 한 문장' },
      audience: { type: 'string', description: '누구에게 하는 말인지' },
      angles: {
        type: 'array', description: '서로 다른 각도의 앵글 3개',
        items: {
          type: 'object',
          properties: {
            axis: { type: 'string', description: '어떤 각도인지 한 단어' },
            format: { type: 'string', enum: ['일상글', '정보성글', '구매성글', '프로모션글'] },
            hook: { type: 'string', description: '커버 첫 줄. 12자 내외' },
            one_line: { type: 'string', description: '이 앵글이 말하는 것 한 줄' },
            cta_keyword: { type: 'string', description: '댓글 유도용 2~4글자' },
          },
          required: ['axis', 'format', 'hook', 'one_line', 'cta_keyword'],
          additionalProperties: false,
        },
      },
    },
    required: ['topic_refined', 'audience', 'angles'],
    additionalProperties: false,
  };

  $('t-strategy').addEventListener('click', async function () {
    var topic = $('t-topic').value.trim();
    if (!topic) { say('t-strategy-state', '주제를 입력하세요.', 'err'); return; }
    say('t-strategy-state', '전략을 뽑는 중… (10~20초)', 'busy');
    try {
      var d = await claudeJSON(GUIDE, '주제: ' + topic +
        '\n\n이 주제를 더 좁히고, 서로 다른 각도의 앵글 3개를 만드세요. JSON만 출력하세요.',
        ANGLE_SCHEMA);
      state.topic = topic;
      state.angles = d;
      paintAngles(d);
      say('t-strategy-state', '완료 — 아래에서 하나 고르세요', 'ok');
    } catch (e) {
      say('t-strategy-state', e.message, 'err');
    }
  });

  function paintAngles(d) {
    var box = $('t-angles');
    box.innerHTML =
      '<p class="tmeta"><b>좁힌 주제</b> ' + esc(d.topic_refined) +
      ' &nbsp;·&nbsp; <b>타깃</b> ' + esc(d.audience) + '</p>' +
      d.angles.map(function (a, i) {
        return '<button class="tangle" data-i="' + i + '" type="button">' +
          '<span class="ttag">' + esc(a.axis) + ' · ' + esc(a.format) + '</span>' +
          '<b>' + esc(a.hook) + '</b>' +
          '<span class="tone">' + esc(a.one_line) + '</span>' +
          '<span class="tcta">댓글 키워드 · ' + esc(a.cta_keyword) + '</span></button>';
      }).join('');

    box.querySelectorAll('.tangle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        box.querySelectorAll('.tangle').forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        state.angle = d.angles[Number(btn.dataset.i)];
        $('tstep-cards').hidden = false;
        $('tstep-cards').scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }

  /* ───────── 3단계 : 카드 */
  function cardsSchema(n) {
    return {
      type: 'object',
      properties: {
        cards: {
          type: 'array', description: '정확히 ' + n + '장',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['후킹', '문제제기', '해결제안', '상품연결', 'CTA'] },
              badge: { type: 'string', description: '상단 작은 라벨. 없으면 빈 문자열' },
              title: { type: 'string', description: '한 줄 12자 내외 최대 2줄. 줄바꿈은 \\n' },
              subtitle: { type: 'string', description: '한 줄 20자 내외. 없으면 빈 문자열' },
              body: { type: 'string', description: '한 줄 22자 내외 최대 3줄. 없으면 빈 문자열' },
              image_prompt: { type: 'string', description: '이 카드 배경을 만들 영문 프롬프트. 글자 없는 사진' },
            },
            required: ['role', 'badge', 'title', 'subtitle', 'body', 'image_prompt'],
            additionalProperties: false,
          },
        },
        caption: { type: 'string', description: 'SNS 캡션. 짧은 문장 위주, 링크 금지' },
        hashtags: { type: 'array', items: { type: 'string' }, description: '# 포함 8~15개' },
        cta_comment: { type: 'string', description: '댓글 유도 한 줄' },
      },
      required: ['cards', 'caption', 'hashtags', 'cta_comment'],
      additionalProperties: false,
    };
  }

  $('t-compose').addEventListener('click', async function () {
    if (!state.angle) { say('t-compose-state', '앵글을 먼저 고르세요.', 'err'); return; }
    var n = Number($('t-count').value);
    say('t-compose-state', '카드를 만드는 중… (20~40초)', 'busy');
    try {
      var a = state.angle;
      var d = await claudeJSON(GUIDE,
        '주제: ' + (state.angles.topic_refined || state.topic) +
        '\n타깃: ' + state.angles.audience +
        '\n고른 앵글: [' + a.axis + '/' + a.format + '] ' + a.hook + ' — ' + a.one_line +
        '\nCTA 키워드: ' + a.cta_keyword +
        '\n\n이 앵글로 카드 ' + n + '장을 구성하세요. 첫 장은 후킹, 마지막 장은 CTA 입니다.' +
        '\n글자 수 하드룰을 반드시 지키고 줄바꿈을 직접 넣으세요. JSON만 출력하세요.',
        cardsSchema(n));
      state.cards = d.cards.map(function (c) { return Object.assign({ image: null }, c); });
      state.caption = d.caption;
      state.tags = d.hashtags;
      state.cta = d.cta_comment;
      state.idx = 0;
      $('tstep-result').hidden = false;
      draw();
      paintCaption();
      say('t-compose-state', d.cards.length + '장 완성', 'ok');
      $('tstep-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      say('t-compose-state', e.message, 'err');
    }
  });

  /* ───────── 카드 그리기 (앱과 같은 인상) */
  function layers(c) {
    var L = [];
    if (c.badge) L.push({ t: c.badge, y: 7.5, size: 24, w: 800, color: THEME.accent, ls: 0.08 });
    if (c.title) L.push({ t: c.title, y: 13, size: 66, w: 800, color: THEME.ink, lh: 1.24 });
    if (c.subtitle) L.push({ t: c.subtitle, y: 34, size: 31, w: 500, color: THEME.sub, lh: 1.5 });
    if (c.body) L.push({ t: c.body, y: 72, size: 34, w: 600, color: THEME.ink, lh: 1.5 });
    return L;
  }

  function draw() {
    var c = state.cards[state.idx];
    var st = $('t-stage');
    st.innerHTML = '';
    st.style.background = c.image ? '' : 'linear-gradient(150deg,' + THEME.surface + ',' + THEME.bg + ' 70%)';

    if (c.image) {
      var bg = document.createElement('div');
      bg.className = 'tbg';
      bg.style.backgroundImage = 'url("' + c.image + '")';
      st.appendChild(bg);
      var ov = document.createElement('div');
      ov.className = 'tov';
      st.appendChild(ov);
    }
    layers(c).forEach(function (l) {
      var el = document.createElement('div');
      el.className = 'tlayer';
      el.style.top = l.y + '%';
      el.style.fontSize = (l.size / W * 100) + 'cqw';
      el.style.fontWeight = l.w;
      el.style.color = l.color;
      el.style.lineHeight = l.lh || 1.35;
      el.style.letterSpacing = (l.ls || -0.02) + 'em';
      el.textContent = l.t;
      st.appendChild(el);
    });
    $('t-label').textContent = (state.idx + 1) + ' / ' + state.cards.length;
    $('t-prev').disabled = state.idx === 0;
    $('t-next').disabled = state.idx === state.cards.length - 1;
  }

  $('t-prev').addEventListener('click', function () { if (state.idx > 0) { state.idx--; draw(); } });
  $('t-next').addEventListener('click', function () {
    if (state.idx < state.cards.length - 1) { state.idx++; draw(); }
  });

  function paintCaption() {
    $('t-caption').innerHTML =
      '<b>캡션</b><p>' + esc(state.caption) + '</p>' +
      '<b>댓글 CTA</b><p>' + esc(state.cta) + '</p>' +
      '<b>해시태그</b><p class="ttags">' + esc((state.tags || []).join(' ')) + '</p>';
  }

  /* ───────── 배경 이미지 */
  var STYLE = 'A calm, tidy modern Korean apartment interior. Generous negative space, ' +
    'soft natural window light, muted warm neutrals. Documentary lifestyle photography, ' +
    '50mm lens, shallow depth of field. Photorealistic. Vertical 4:5 framing. ' +
    'Keep the upper half calm and uncluttered so text can sit there. ' +
    'Absolutely no text, letters, numbers, logos, or watermarks anywhere in the image.';

  async function makeImage(i) {
    var c = state.cards[i];
    var said = [c.title, c.subtitle, c.body].filter(Boolean).join(' / ').replace(/\n/g, ' ');
    var prompt = c.image_prompt + '\nThis is the background for a card that reads: "' + said +
      '". The scene must match that message.\n' + STYLE;
    c.image = await openaiImage(prompt);
  }

  $('t-image').addEventListener('click', async function () {
    say('t-image-state', '배경을 만드는 중… (20~40초)', 'busy');
    try {
      await makeImage(state.idx);
      draw();
      say('t-image-state', '완성', 'ok');
    } catch (e) { say('t-image-state', e.message, 'err'); }
  });

  $('t-image-all').addEventListener('click', async function () {
    for (var i = 0; i < state.cards.length; i++) {
      if (state.cards[i].image) continue;
      say('t-image-state', (i + 1) + '/' + state.cards.length + '번 배경 만드는 중…', 'busy');
      try {
        await makeImage(i);
        if (i === state.idx) draw();
      } catch (e) { say('t-image-state', e.message, 'err'); return; }
    }
    draw();
    say('t-image-state', '전체 완성', 'ok');
  });

  /* ───────── PNG 저장 (캔버스로 직접 그린다 — 브라우저에는 렌더 서버가 없다) */
  $('t-png').addEventListener('click', async function () {
    var c = state.cards[state.idx];
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    g.fillStyle = THEME.bg;
    g.fillRect(0, 0, W, H);

    if (c.image) {
      var img = await loadImage(c.image);
      // cover 맞춤
      var r = Math.max(W / img.width, H / img.height);
      var w = img.width * r, h = img.height * r;
      g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
      var grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, 'rgba(22,32,51,.78)');
      grd.addColorStop(.45, 'rgba(22,32,51,.22)');
      grd.addColorStop(1, 'rgba(22,32,51,.72)');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
    }

    await document.fonts.ready;
    layers(c).forEach(function (l) {
      g.fillStyle = l.color;
      g.font = l.w + ' ' + l.size + 'px Pretendard, sans-serif';
      g.textBaseline = 'top';
      var lh = l.size * (l.lh || 1.35);
      var y = H * (l.y / 100);
      String(l.t).split('\n').forEach(function (line) {
        g.fillText(line, W * 0.08, y);
        y += lh;
      });
    });

    var a = document.createElement('a');
    a.download = 'cardnews-' + String(state.idx + 1).padStart(2, '0') + '.png';
    a.href = cv.toDataURL('image/png');
    a.click();
  });

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error('배경 이미지를 불러오지 못했습니다.')); };
      im.src = src;
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
})();
