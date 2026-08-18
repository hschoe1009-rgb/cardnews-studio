/* 웹앱용 서버 대역 — 브라우저 안에서 /api/* 를 직접 구현한다.
 *
 * 로컬앱은 FastAPI 가 하던 일(생성 호출·프로젝트 저장·PNG 렌더·ZIP·엑셀)을
 * 여기서 전부 브라우저가 한다. 서버가 없으므로 배포자에게 비용이 들지 않고,
 * API 사용료는 각 사용자가 자기 키로 직접 부담한다.
 *
 *   생성 호출 : 브라우저 → Anthropic / OpenAI 로 직접
 *   저장      : IndexedDB (프로젝트 JSON + 배경 이미지)
 *   PNG       : 캔버스로 직접 그림 (Chromium 렌더 서버가 없다)
 *   ZIP       : 무압축 ZIP 을 직접 조립
 *   엑셀      : 최소 xlsx(= XML 들이 든 ZIP)를 직접 조립
 *
 * app.js 는 이 파일이 있으면 fetch 대신 여기로 온다. 나머지 코드는 그대로다.
 */
/* 이 파일이 실린 <script> 주소에서 앱 뿌리를 구한다.
   주소가 /app/ 이든 /app 이든(슬래시 없음) brand.json 을 제대로 찾게 하려는 것. */
var APP_ROOT = (function () {
  var s = document.currentScript;
  var src = (s && s.src) || '';
  var cut = src.indexOf('static/webapi.js');
  return cut > -1 ? src.slice(0, cut) : './';
})();

(function () {
  'use strict';

  var W = 1080, H = 1350;
  var KEY_STORE = 'myohan.keys.v1';          // app.js 와 같은 저장소를 쓴다
  var CFG = 'cardnews.web.settings.v1';

  /* ─────────────────────────────── 설정 */
  var DEFAULTS = {
    CLAUDE_MODEL: 'claude-sonnet-5',
    OPENAI_TEXT_MODEL: 'gpt-5.6-terra',
    OPENAI_TEXT_EFFORT: 'medium',
    TEXT_PROVIDER: 'auto',
    IMAGE_MODEL: 'gpt-image-2',
    IMAGE_SIZE: '1024x1536',
    IMAGE_MODE: 'api',
  };
  function cfg() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG) || '{}')); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function setCfg(patch) {
    var c = cfg();
    Object.keys(patch).forEach(function (k) { if (patch[k]) c[k] = patch[k]; });
    localStorage.setItem(CFG, JSON.stringify(c));
    return c;
  }
  function keys() {
    try { return JSON.parse(localStorage.getItem(KEY_STORE) || '{}'); } catch (e) { return {}; }
  }
  function tail(v) { return v && v.length >= 4 ? '…' + v.slice(-4) : ''; }

  function provider() {
    var c = cfg(), k = keys();
    if (c.TEXT_PROVIDER === 'anthropic') return k.anthropic ? 'anthropic' : 'none';
    if (c.TEXT_PROVIDER === 'openai') return k.openai ? 'openai' : 'none';
    if (k.anthropic) return 'anthropic';
    if (k.openai) return 'openai';
    return 'none';
  }

  function err(msg) { var e = new Error(msg); e.__api = true; return e; }

  function readErr(status, j) {
    var m = (j && j.error && j.error.message) || '';
    if (status === 401) return 'API 키가 올바르지 않습니다.';
    if (status === 403) return '이 키로는 접근할 수 없습니다. 권한을 확인하세요.';
    if (status === 404) return '모델을 찾을 수 없습니다. 설정에서 모델 이름을 확인하세요.';
    if (status === 429) return '요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요.';
    if (status === 400 && /credit|balance|quota/i.test(m)) return '계정 잔액이 부족합니다.';
    return '오류 ' + status + (m ? ': ' + m : '');
  }

  /* ─────────────────────────────── 생성 지침
     로컬앱의 playbook.md 는 유료 자료라 배포본에 넣지 않는다.
     아래는 같은 뼈대를 배포용으로 새로 쓴 것이다. */
  var GUIDE = [
    '당신은 한국어 카드뉴스 기획자입니다. 아래 기준을 지켜 구성합니다.',
    '',
    '[앵글] 주제를 볼 각도는 여러 개입니다 — 기능을 다시 해석하기, 파는 사람의 자격,',
    '쓰는 사람의 정체성, 필요해지는 상황, 체험에서 구매로 가는 순서.',
    '앵글 3개는 서로 다른 각도여야 합니다. 비슷하면 실패입니다.',
    '',
    '[글의 목적] 일상글(친밀) · 정보성글(저장) · 구매성글(판매) · 프로모션글(명단수집) 중 하나.',
    '',
    '[구매성 뼈대] 후킹 → 문제 제기 → 해결 제안 → 상품 연결 + 행동 요청.',
    '첫 줄은 눈을 멈추게 합니다(통념 뒤집기 또는 숫자). 마지막은 진입장벽 낮은 행동 하나만 요청합니다.',
    '',
    '[카드 글자 수 — 넘으면 카드가 깨집니다]',
    '타이틀 한 줄 12자 내외 최대 2줄 / 서브 한 줄 20자 내외 최대 2줄 / 본문 한 줄 22자 내외 최대 3줄.',
    '줄바꿈은 \\n 으로 직접 넣어 통제합니다. 어려운 말과 전문가 티를 뺍니다.',
    '',
    '[금지] 링크를 카드에 넣지 않습니다. 근거 없는 수치·효능·의학적 단정을 만들지 않습니다.',
    '건강·행동 주제라면 마지막 카드에 전문가 상담 안내를 넣습니다.',
    '',
    '출력은 유효한 JSON 하나뿐입니다.',
  ].join('\n');

  var brandCache = null;
  async function brand() {
    if (brandCache) return brandCache;
    var res = await fetch(APP_ROOT + 'brand.json');
    brandCache = await res.json();
    return brandCache;
  }

  async function systemPrompt() {
    var b = await brand();
    return GUIDE + '\n\n=== 브랜드 정보 ===\n' + JSON.stringify(b, null, 2);
  }

  /* ─────────────────────────────── 생성 호출 */
  async function callJSON(system, user, schema, effort) {
    var who = provider();
    if (who === 'none') throw err('API 키가 없습니다. 설정 탭에서 키를 넣어주세요.');
    var c = cfg(), k = keys();

    if (who === 'openai') {
      var r = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.openai },
        body: JSON.stringify({
          model: c.OPENAI_TEXT_MODEL,
          instructions: system,
          input: user,
          reasoning: { effort: ['low', 'medium', 'high'].indexOf(effort) >= 0 ? effort : 'medium' },
          text: { format: { type: 'json_schema', name: 'cardnews', schema: schema, strict: true } },
        }),
      });
      var j = await r.json();
      if (!r.ok) throw err(readErr(r.status, j));
      var msg = (j.output || []).find(function (o) { return o.type === 'message'; });
      var txt = msg ? (msg.content || []).map(function (x) { return x.text; }).join('') : '';
      if (!txt) throw err('빈 응답을 받았습니다.');
      return JSON.parse(txt);
    }

    var r2 = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': k.anthropic,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: c.CLAUDE_MODEL,
        max_tokens: 16000,
        system: system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema: schema } },
      }),
    });
    var j2 = await r2.json();
    if (!r2.ok) throw err(readErr(r2.status, j2));
    if (j2.stop_reason === 'refusal') throw err('이 주제는 처리할 수 없습니다. 주제를 바꿔보세요.');
    if (j2.stop_reason === 'max_tokens') throw err('응답이 잘렸습니다. 카드 수를 줄여보세요.');
    var t = (j2.content || []).find(function (b2) { return b2.type === 'text'; });
    if (!t) throw err('빈 응답을 받았습니다.');
    return JSON.parse(t.text);
  }

  async function genImage(prompt) {
    var c = cfg(), k = keys();
    if (c.IMAGE_MODE === 'manual')
      throw err("지금은 '프롬프트만 (수동)' 모드입니다. 프롬프트를 복사해 외부에서 만든 뒤 끌어놓으세요.");
    if (!k.openai) throw err('OpenAI 키가 없습니다. 설정 탭에서 입력하거나 프롬프트 복사를 쓰세요.');
    var r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + k.openai },
      body: JSON.stringify({ model: c.IMAGE_MODEL, prompt: prompt, size: c.IMAGE_SIZE, n: 1 }),
    });
    var j = await r.json();
    if (!r.ok) throw err(readErr(r.status, j));
    var d = (j.data || [])[0] || {};
    if (d.b64_json) return 'data:image/png;base64,' + d.b64_json;
    if (d.url) {
      var blob = await (await fetch(d.url)).blob();
      return await blobToDataURL(blob);
    }
    throw err('이미지 응답이 비어 있습니다.');
  }

  function blobToDataURL(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }

  /* ─────────────────────────────── 저장 (IndexedDB) */
  var DB = null;
  function db() {
    if (DB) return DB;
    DB = new Promise(function (res, rej) {
      var q = indexedDB.open('cardnews-studio', 1);
      q.onupgradeneeded = function () {
        q.result.createObjectStore('projects', { keyPath: 'id' });
      };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(err('브라우저 저장소를 열지 못했습니다.')); };
    });
    return DB;
  }
  async function tx(mode, fn) {
    var d = await db();
    return new Promise(function (res, rej) {
      var t = d.transaction('projects', mode);
      var out = fn(t.objectStore('projects'));
      t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); };
      t.onerror = function () { rej(err('저장소 오류가 발생했습니다.')); };
    });
  }
  var putProject = function (p) { return tx('readwrite', function (s) { return s.put(p); }); };
  var getProject = function (id) { return tx('readonly', function (s) { return s.get(id); }); };
  var delProject = function (id) { return tx('readwrite', function (s) { return s.delete(id); }); };
  var allProjects = function () { return tx('readonly', function (s) { return s.getAll(); }); };

  /* ─────────────────────────────── 레이어 (로컬앱 store.py 와 같은 규칙) */
  function layersFor(card, theme) {
    var accent = theme.accent, ink = theme.ink, sub = theme.ink_sub, out = [];
    function add(id, text, o) {
      if (!String(text || '').trim()) return;
      out.push(Object.assign({
        id: id, text: String(text), x: 8, y: 10, w: 84, size: 44, weight: 700,
        color: ink, align: 'left', lineHeight: 1.35, letterSpacing: -0.02,
      }, o));
    }
    add('badge', card.badge, { y: 7.5, size: 24, weight: 800, color: accent, letterSpacing: 0.08 });
    if (card.template === 'cover') {
      add('title', card.title, { y: 13, size: 82, weight: 800, lineHeight: 1.22 });
      add('subtitle', card.subtitle, { y: 36, size: 36, weight: 500, color: sub, lineHeight: 1.5 });
      add('body', card.body, { y: 50, size: 30, weight: 400, color: sub, lineHeight: 1.55 });
    } else if (card.template === 'final') {
      add('title', card.title, { y: 14, size: 64, weight: 800, lineHeight: 1.28 });
      add('subtitle', card.subtitle, { y: 34, size: 32, weight: 500, color: sub, lineHeight: 1.5 });
      add('body', card.cta || card.body, { y: 70, size: 36, weight: 700, color: accent, lineHeight: 1.45 });
      add('note', card.note, { y: 84, size: 24, weight: 400, color: sub, lineHeight: 1.5 });
    } else {
      add('title', card.title, { y: 12, size: 62, weight: 800, lineHeight: 1.26 });
      add('subtitle', card.subtitle, { y: 31, size: 30, weight: 500, color: sub, lineHeight: 1.5 });
      add('body', card.body, { y: 72, size: 34, weight: 600, lineHeight: 1.5 });
      add('note', card.note, { y: 88, size: 23, weight: 400, color: sub, lineHeight: 1.5 });
    }
    if (String(card.tip || '').trim()) {
      out.push({
        id: 'tip', text: String(card.tip), x: 74, y: 55, w: 20, size: 28, weight: 800,
        color: theme.bg, align: 'center', lineHeight: 1.25, letterSpacing: 0, sticker: true,
      });
    }
    return out;
  }

  function slug(s) {
    return (String(s).replace(/[^\w가-힣]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cardnews').toLowerCase();
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
           p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /* ─────────────────────────────── PNG (캔버스) */
  function hexA(hex, a) {
    var c = String(hex || '#162033').replace('#', '');
    if (c.length === 3) c = c.replace(/./g, '$&$&');
    var n = parseInt(c, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' +
           Math.max(0, Math.min(1, a)) + ')';
  }
  function loadImage(src) {
    return new Promise(function (res, rej) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { res(im); };
      im.onerror = function () { rej(err('배경 이미지를 불러오지 못했습니다.')); };
      im.src = src;
    });
  }
  function wrap(ctx, text, maxW) {
    var lines = [];
    String(text).split('\n').forEach(function (para) {
      var words = para.split(' '), cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !cur) { cur = t; }
        else { lines.push(cur); cur = w; }
      });
      lines.push(cur);
    });
    return lines;
  }

  async function renderCanvas(project, card) {
    var th = project.theme || {};
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');

    g.fillStyle = th.bg || '#162033';
    g.fillRect(0, 0, W, H);

    if (card.image) {
      var im = await loadImage(card.image);
      var f = card.focus || [0.5, 0.5];
      var r = Math.max(W / im.width, H / im.height);
      var w = im.width * r, h = im.height * r;
      g.drawImage(im, (W - w) * f[0], (H - h) * f[1], w, h);
    } else {
      var lg = g.createLinearGradient(0, 0, W, H);
      lg.addColorStop(0, th.surface || '#1E2B42');
      lg.addColorStop(0.7, th.bg || '#162033');
      g.fillStyle = lg; g.fillRect(0, 0, W, H);
    }

    var s = card.overlay == null ? 0.55 : Number(card.overlay);
    var ov = g.createLinearGradient(0, 0, 0, H);
    ov.addColorStop(0, hexA(th.bg, s + 0.2));
    ov.addColorStop(0.45, hexA(th.bg, s * 0.35));
    ov.addColorStop(1, hexA(th.bg, s + 0.15));
    g.fillStyle = ov; g.fillRect(0, 0, W, H);

    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    (card.layers || []).forEach(function (l) {
      var boxX = W * (l.x / 100), boxW = W * (l.w / 100), y = H * (l.y / 100);
      g.font = l.weight + ' ' + l.size + 'px Pretendard, "Noto Sans KR", sans-serif';
      g.textBaseline = 'top';

      if (l.sticker) {
        var d = boxW, cx = boxX + d / 2, cy = y + d / 2;
        g.save();
        g.translate(cx, cy); g.rotate(-8 * Math.PI / 180);
        g.fillStyle = th.accent || '#F4D77B';
        g.beginPath(); g.arc(0, 0, d / 2, 0, Math.PI * 2); g.fill();
        g.fillStyle = l.color; g.textAlign = 'center';
        var sl = String(l.text).split('\n'), lh0 = l.size * (l.lineHeight || 1.25);
        sl.forEach(function (line, i) {
          g.fillText(line, 0, -(sl.length * lh0) / 2 + i * lh0 + lh0 * 0.12);
        });
        g.restore();
        return;
      }

      g.fillStyle = l.color;
      g.textAlign = l.align === 'center' ? 'center' : l.align === 'right' ? 'right' : 'left';
      var tx = l.align === 'center' ? boxX + boxW / 2 : l.align === 'right' ? boxX + boxW : boxX;
      var lh = l.size * (l.lineHeight || 1.35);
      g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = 18; g.shadowOffsetY = 2;
      wrap(g, l.text, boxW).forEach(function (line) { g.fillText(line, tx, y); y += lh; });
      g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
    });

    return await new Promise(function (res) { cv.toBlob(res, 'image/png'); });
  }

  /* ─────────────────────────────── ZIP (무압축) */
  function crc32(buf) {
    var t = crc32.t;
    if (!t) {
      t = crc32.t = new Uint32Array(256);
      for (var i = 0; i < 256; i++) {
        var c = i;
        for (var j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var k = 0; k < buf.length; k++) crc = t[(crc ^ buf[k]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    function u32(n) { return [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]; }
    function u16(n) { return [n & 255, (n >> 8) & 255]; }

    files.forEach(function (f) {
      var name = enc.encode(f.name), data = f.data, crc = crc32(data);
      var local = [].concat([80, 75, 3, 4], u16(20), u16(0), u16(0), u16(0), u16(0),
                            u32(crc), u32(data.length), u32(data.length),
                            u16(name.length), u16(0));
      parts.push(new Uint8Array(local), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += local.length + name.length + data.length;
    });

    var dir = [], dirLen = 0;
    central.forEach(function (c) {
      var h = [].concat([80, 75, 1, 2], u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                        u32(c.crc), u32(c.size), u32(c.size), u16(c.name.length),
                        u16(0), u16(0), u16(0), u16(0), u32(0), u32(c.offset));
      dir.push(new Uint8Array(h), c.name);
      dirLen += h.length + c.name.length;
    });
    var end = new Uint8Array([].concat([80, 75, 5, 6], u16(0), u16(0),
                             u16(central.length), u16(central.length),
                             u32(dirLen), u32(offset), u16(0)));
    return new Blob(parts.concat(dir, [end]), { type: 'application/zip' });
  }

  /* ─────────────────────────────── 엑셀 (최소 xlsx) */
  function xesc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }
  function colName(i) {
    var s = '';
    do { s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26) - 1; } while (i >= 0);
    return s;
  }
  function sheetXml(rows) {
    var body = rows.map(function (row, r) {
      var cells = row.map(function (v, c) {
        return '<c r="' + colName(c) + (r + 1) + '" t="inlineStr"><is><t xml:space="preserve">' +
               xesc(v) + '</t></is></c>';
      }).join('');
      return '<row r="' + (r + 1) + '">' + cells + '</row>';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetData>' + body + '</sheetData></worksheet>';
  }
  function makeXlsx(sheets) {
    var enc = new TextEncoder(), files = [];
    var names = Object.keys(sheets);
    files.push({ name: '[Content_Types].xml', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      names.map(function (_, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
               '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') + '</Types>') });
    files.push({ name: '_rels/.rels', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>') });
    files.push({ name: 'xl/workbook.xml', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map(function (n, i) {
        return '<sheet name="' + xesc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
      }).join('') + '</sheets></workbook>') });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: enc.encode(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map(function (_, i) {
        return '<Relationship Id="rId' + (i + 1) +
               '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
      }).join('') + '</Relationships>') });
    names.forEach(function (n, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(sheets[n])) });
    });
    return makeZip(files);
  }

  function save(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  window.__WEBAPI_SAVE__ = save;

  /* ─────────────────────────────── 스키마 (로컬앱과 동일 계약) */
  var S = {};
  S.keywords = {
    type: 'object',
    properties: {
      topic_refined: { type: 'string' }, audience: { type: 'string' },
      core_keywords: { type: 'array', items: { type: 'string' } },
      search_keywords: { type: 'array', items: { type: 'string' } },
      pain_points: { type: 'array', items: { type: 'string' } },
      angles: {
        type: 'array', description: '서로 다른 각도의 앵글 3개',
        items: {
          type: 'object',
          properties: {
            concept_axis: { type: 'string' },
            post_format: { type: 'string', enum: ['일상글', '정보성글', '구매성글', '프로모션글'] },
            funnel_stage: { type: 'string' }, hook: { type: 'string' },
            one_line: { type: 'string' }, why: { type: 'string' }, cta_keyword: { type: 'string' },
          },
          required: ['concept_axis', 'post_format', 'funnel_stage', 'hook', 'one_line', 'why', 'cta_keyword'],
          additionalProperties: false,
        },
      },
    },
    required: ['topic_refined', 'audience', 'core_keywords', 'search_keywords', 'pain_points', 'angles'],
    additionalProperties: false,
  };
  S.cards = function (n) {
    return {
      type: 'object',
      properties: {
        title: { type: 'string' }, concept_sentence: { type: 'string' },
        cards: {
          type: 'array', description: '정확히 ' + n + '장',
          items: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              role: { type: 'string', enum: ['후킹', '문제제기', '해결제안', '상품연결', 'CTA'] },
              template: { type: 'string', enum: ['cover', 'content', 'list', 'quote', 'final'] },
              badge: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' },
              body: { type: 'string' }, note: { type: 'string' }, tip: { type: 'string' },
              image_prompt: { type: 'string' },
            },
            required: ['slug', 'role', 'template', 'badge', 'title', 'subtitle', 'body', 'note', 'tip', 'image_prompt'],
            additionalProperties: false,
          },
        },
        caption: { type: 'string' },
        hashtags: { type: 'array', items: { type: 'string' } },
        cta_comment: { type: 'string' }, next_teaser: { type: 'string' },
        self_check: {
          type: 'array',
          items: {
            type: 'object',
            properties: { item: { type: 'string' }, pass: { type: 'boolean' }, reason: { type: 'string' } },
            required: ['item', 'pass', 'reason'], additionalProperties: false,
          },
        },
        strategy_notes: { type: 'string' },
      },
      required: ['title', 'concept_sentence', 'cards', 'caption', 'hashtags',
                 'cta_comment', 'next_teaser', 'self_check', 'strategy_notes'],
      additionalProperties: false,
    };
  };
  S.source = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      kind: { type: 'string', enum: ['블로그', '노트', '전자책', '후기', '상세페이지', '기타'] },
      summary: { type: 'string' },
      key_points: { type: 'array', items: { type: 'string' } },
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: { claim: { type: 'string' }, detail: { type: 'string' } },
          required: ['claim', 'detail'], additionalProperties: false,
        },
      },
      quotes: { type: 'array', items: { type: 'string' } },
      suggested_topics: {
        type: 'array',
        items: {
          type: 'object',
          properties: { topic: { type: 'string' }, why: { type: 'string' } },
          required: ['topic', 'why'], additionalProperties: false,
        },
      },
      cautions: { type: 'string' },
    },
    required: ['title', 'kind', 'summary', 'key_points', 'facts', 'quotes', 'suggested_topics', 'cautions'],
    additionalProperties: false,
  };
  S.rewrite = {
    type: 'object',
    properties: {
      badge: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' },
      body: { type: 'string' }, note: { type: 'string' }, tip: { type: 'string' },
      image_prompt: { type: 'string' }, why: { type: 'string' },
    },
    required: ['badge', 'title', 'subtitle', 'body', 'note', 'tip', 'image_prompt', 'why'],
    additionalProperties: false,
  };
  S.scene = {
    type: 'object',
    properties: { image_prompt: { type: 'string' }, scene_ko: { type: 'string' }, why: { type: 'string' } },
    required: ['image_prompt', 'scene_ko', 'why'], additionalProperties: false,
  };

  function sourceBlock(src) {
    if (!src) return '';
    return '\n\n=== 원문 근거 (이 범위 안에서만 씁니다) ===\n제목: ' + src.title +
      '\n요약:\n' + src.summary +
      '\n핵심:\n' + (src.key_points || []).map(function (p) { return '  - ' + p; }).join('\n') +
      '\n원문에 적힌 사실:\n' + ((src.facts || []).map(function (f) {
        return '  - ' + f.claim + ' (' + f.detail + ')'; }).join('\n') || '  (없음)') +
      '\n인용 가능한 문장:\n' + ((src.quotes || []).map(function (q) { return '  - ' + q; }).join('\n') || '  (없음)') +
      '\n주의: ' + src.cautions +
      '\n\n원문에 없는 사실을 만들지 마세요.';
  }

  async function imagePrompt(project, card, extra) {
    var b = await brand();
    var said = [card.title, card.subtitle, card.body, card.note]
      .filter(Boolean).join(' / ').replace(/\n/g, ' ');
    return [
      card.image_prompt || 'A calm, softly lit urban interior with a pet resting comfortably.',
      said ? 'This image is the background for a card that reads: "' + said +
             '". The scene must match that message.' : '',
      extra ? 'Also include: ' + extra : '',
      'Style: ' + (b.image_style_en || b.image_style || ''),
      'Avoid: ' + (b.image_avoid_en || b.image_avoid || ''),
      'Photorealistic. Vertical 4:5 framing. Leave calm space where text sits. ' +
      'Absolutely no text, letters, numbers, logos, or watermarks anywhere in the image.',
    ].filter(function (x) { return x && x.trim(); }).join('\n');
  }

  /* ─────────────────────────────── 라우터 */
  var exported = {};   // 프로젝트별 렌더된 PNG blob

  async function route(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var body = opts.body ? JSON.parse(opts.body) : {};
    var m;

    if (path === '/api/settings' && method === 'GET') {
      var c = cfg(), k = keys(), who = provider();
      return {
        claude_model: c.CLAUDE_MODEL, image_model: c.IMAGE_MODEL, image_size: c.IMAGE_SIZE,
        image_mode: c.IMAGE_MODE, require_user_key: true,
        text_provider_pref: c.TEXT_PROVIDER, text_provider: who,
        text_model: who === 'anthropic' ? c.CLAUDE_MODEL : who === 'openai' ? c.OPENAI_TEXT_MODEL : '',
        openai_text_model: c.OPENAI_TEXT_MODEL, openai_text_effort: c.OPENAI_TEXT_EFFORT,
        has_anthropic_key: !!k.anthropic, has_openai_key: !!k.openai,
        anthropic_source: k.anthropic ? 'user' : 'none',
        openai_source: k.openai ? 'user' : 'none',
        anthropic_tail: tail(k.anthropic), openai_tail: tail(k.openai),
        strategy_dirs: [], strategy_dirs_exist: [],
        db_path: '브라우저 저장소 (IndexedDB)',
      };
    }
    if (path === '/api/settings' && method === 'POST') {
      setCfg(body);
      return route('/api/settings', { method: 'GET' });
    }
    if (path === '/api/brand') {
      var b = await brand();
      return { brand: b, theme_keys: Object.keys(b.themes || {}) };
    }
    if (path === '/api/test-key') {
      var k2 = keys();
      if (body.provider === 'anthropic') {
        if (!k2.anthropic) throw err('Anthropic 키가 없습니다.');
        var r = await fetch('https://api.anthropic.com/v1/models/' + cfg().CLAUDE_MODEL, {
          headers: { 'x-api-key': k2.anthropic, 'anthropic-version': '2023-06-01',
                     'anthropic-dangerous-direct-browser-access': 'true' } });
        var j = await r.json();
        if (!r.ok) throw err(readErr(r.status, j));
        return { ok: true, model: j.id, display_name: j.display_name };
      }
      if (!k2.openai) throw err('OpenAI 키가 없습니다.');
      var r2 = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: 'Bearer ' + k2.openai } });
      var j2 = await r2.json();
      if (!r2.ok) throw err(readErr(r2.status, j2));
      var ids = (j2.data || []).map(function (x) { return x.id; });
      var want = cfg().IMAGE_MODEL;
      if (ids.indexOf(want) < 0)
        throw err("키는 정상이지만 '" + want + "' 을(를) 쓸 수 없습니다. 계정 인증을 확인하세요.");
      return { ok: true, model: want, available: ids.filter(function (x) { return /image/.test(x); }) };
    }
    if (path === '/api/image-models') {
      var k3 = keys();
      if (!k3.openai) throw err('OpenAI 키가 없습니다.');
      var r3 = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: 'Bearer ' + k3.openai } });
      var j3 = await r3.json();
      if (!r3.ok) throw err(readErr(r3.status, j3));
      return { models: (j3.data || []).map(function (x) { return x.id; })
                 .filter(function (x) { return /image|dall-e/.test(x); }).sort() };
    }

    if (path === '/api/summarize') {
      var text = (body.text || '').trim();
      if (text.length < 50) throw err('원문이 너무 짧습니다. 50자 이상 붙여넣어 주세요.');
      var MAX = 60000, cut = text.length > MAX;
      var out = await callJSON(await systemPrompt(),
        '아래 원문을 카드뉴스용으로 정리하세요. 원문에 없는 내용을 지어내지 마세요.\n출처: ' +
        (body.origin || '(직접 붙여넣음)') + '\n\n--- 원문 ---\n' + text.slice(0, MAX) +
        '\n--- 끝 ---\n\nJSON만 출력하세요.', S.source, 'high');
      out.origin = body.origin || ''; out.char_count = text.length; out.truncated = cut;
      if (cut) out.warning = '원문이 ' + text.length.toLocaleString() + '자여서 앞 ' +
        MAX.toLocaleString() + '자만 요약했습니다.';
      return out;
    }

    if (path === '/api/keywords') {
      var topic = (body.topic || '').trim();
      if (!topic) throw err('주제를 입력하세요.');
      var kw = await callJSON(await systemPrompt(),
        '주제: ' + topic + '\n추가 메모: ' + (body.note || '(없음)') + sourceBlock(body.source) +
        '\n\n주제를 더 좁히고, 타깃의 고민과 키워드를 뽑고, ' +
        '서로 다른 각도의 앵글 3개를 만드세요. JSON만 출력하세요.', S.keywords, 'high');
      kw._sources = ['웹앱 내장 지침'];
      return kw;
    }

    if (path === '/api/compose') {
      var n = Number(body.card_count || 7);
      if (n < 3 || n > 10) throw err('카드 수는 3~10장 사이여야 합니다.');
      var a = body.angle || {}, kws = body.keywords || {};
      var comp = await callJSON(await systemPrompt(),
        '주제: ' + (kws.topic_refined || body.topic) + '\n타깃: ' + (kws.audience || '') +
        '\n고민: ' + (kws.pain_points || []).join(', ') +
        '\n앵글: [' + a.concept_axis + '/' + a.post_format + '] ' + a.hook + ' — ' + a.one_line +
        '\nCTA 키워드: ' + a.cta_keyword + '\n추가 요청: ' + (body.note || '(없음)') +
        sourceBlock(body.source) +
        '\n\n이 앵글로 카드 ' + n + '장을 구성하세요. 1번은 template "cover", 마지막은 "final".' +
        '\n글자 수 하드룰을 지키고 줄바꿈을 직접 넣으세요. image_prompt 는 영문으로 씁니다.' +
        '\nJSON만 출력하세요.', S.cards(n), 'high');

      var b2 = await brand();
      var theme = Object.assign({}, (b2.themes || {})[body.theme || 'navy']);
      theme.key = body.theme || 'navy';
      comp.cards.forEach(function (c, i) {
        c.index = i + 1; c.image = ''; c.focus = [0.5, 0.5]; c.overlay = 0.55;
        c.layers = layersFor(c, theme);
      });
      var now = new Date();
      var project = {
        id: stamp() + '-' + slug(body.topic), created: now.toISOString().slice(0, 10),
        updated: now.toISOString().slice(0, 19), topic: body.topic,
        topic_refined: kws.topic_refined || body.topic, audience: kws.audience || '',
        keywords: kws, angle: a, theme: theme, canvas: { w: W, h: H },
        brand: { name: b2.brand, product: b2.product, product_en: b2.product_en },
        title: comp.title, concept_sentence: comp.concept_sentence, cards: comp.cards,
        caption: comp.caption, hashtags: comp.hashtags, cta_comment: comp.cta_comment,
        next_teaser: comp.next_teaser, self_check: comp.self_check,
        strategy_notes: comp.strategy_notes, sources: kw_sources(kws),
        source: body.source || null, status: '작성중', memo: '',
      };
      await putProject(project);
      return project;
    }

    if (path === '/api/projects' && method === 'GET') {
      var all = (await allProjects()) || [];
      return all.map(function (p) {
        return { id: p.id, created: p.created, updated: p.updated, topic: p.topic,
                 title: p.title, concept_axis: (p.angle || {}).concept_axis || '',
                 post_format: (p.angle || {}).post_format || '',
                 cards: (p.cards || []).length, status: p.status };
      }).sort(function (x, y) { return y.updated.localeCompare(x.updated); });
    }

    m = path.match(/^\/api\/projects\/([^/]+)$/);
    if (m) {
      var id = decodeURIComponent(m[1]);
      if (method === 'GET') {
        var p2 = await getProject(id);
        if (!p2) throw err('프로젝트를 찾을 수 없습니다.');
        return p2;
      }
      if (method === 'PUT') {
        body.updated = new Date().toISOString().slice(0, 19);
        await putProject(body);
        return { ok: true, updated: body.updated, db: '브라우저 저장소' };
      }
      if (method === 'DELETE') { await delProject(id); delete exported[id]; return { ok: true }; }
    }

    m = path.match(/^\/api\/projects\/([^/]+)\/cards\/(\d+)\/(rewrite|image|upload|refine-prompt)$/);
    if (m) {
      var pid = decodeURIComponent(m[1]), idx = Number(m[2]), what = m[3];
      var pr = await getProject(pid);
      if (!pr) throw err('프로젝트를 찾을 수 없습니다.');
      var card = (pr.cards || [])[idx - 1];
      if (!card) throw err('카드를 찾을 수 없습니다.');

      if (what === 'rewrite') {
        return await callJSON(await systemPrompt(),
          '주제: ' + pr.topic + '\n\n현재 카드:\n' + JSON.stringify(card, null, 2) +
          '\n\n요청: ' + (body.instruction || '') +
          '\n\n이 카드 한 장만 다시 씁니다. 글자 수 하드룰을 지키고 비울 항목은 빈 문자열로 두세요.' +
          '\nJSON만 출력하세요.', S.rewrite, 'medium');
      }
      if (what === 'refine-prompt') {
        ['badge', 'title', 'subtitle', 'body', 'note', 'role', 'template'].forEach(function (k4) {
          if (k4 in body) card[k4] = body[k4];
        });
        var b3 = await brand();
        var res = await callJSON(
          '당신은 카드뉴스 아트 디렉터입니다. 카드에 적힌 글이 말하는 장면을 사진으로 옮기는 ' +
          '영문 프롬프트를 씁니다. 스톡 사진이 아니라 그 문장이 묘사하는 상황이어야 합니다.\n' +
          '스타일: ' + (b3.image_style_en || '') + '\n피할 것: ' + (b3.image_avoid_en || '') +
          '\n이미지 안에 글자·로고가 절대 없어야 합니다. 세로 4:5, 글이 올라갈 자리는 비웁니다.\n' +
          '출력은 유효한 JSON 하나뿐입니다.',
          '주제: ' + pr.topic + '\n카드 ' + idx + ' [' + (card.role || '') + ']\n' +
          '타이틀: ' + card.title + '\n서브: ' + card.subtitle + '\n본문: ' + card.body +
          '\n기존 프롬프트: ' + (card.image_prompt || '(없음)') +
          '\n추가 요청: ' + (body.extra || '(없음)') +
          '\n\n이 카드 글에 가장 맞는 장면을 다시 쓰세요. JSON만 출력하세요.', S.scene, 'medium');
        card.image_prompt = res.image_prompt;
        await putProject(pr);
        return res;
      }
      if (what === 'image') {
        card.image = await genImage(await imagePrompt(pr, card, body.extra || ''));
        await putProject(pr);
        return { image: card.image };
      }
      if (what === 'upload') {
        var du = body.data_url || '';
        if (du.indexOf('data:image/') !== 0) throw err('이미지 파일이 아닙니다.');
        card.image = du;
        await putProject(pr);
        return { image: du };
      }
    }

    m = path.match(/^\/api\/projects\/([^/]+)\/image-prompt\/(\d+)/);
    if (m) {
      var pid2 = decodeURIComponent(m[1]), i2 = Number(m[2]);
      var pr2 = await getProject(pid2);
      if (!pr2) throw err('프로젝트를 찾을 수 없습니다.');
      var c2 = (pr2.cards || [])[i2 - 1];
      if (!c2) throw err('카드를 찾을 수 없습니다.');
      var extra = (path.split('extra=')[1] || '');
      return { prompt: await imagePrompt(pr2, c2, decodeURIComponent(extra)) };
    }

    m = path.match(/^\/api\/projects\/([^/]+)\/export$/);
    if (m) {
      var pid3 = decodeURIComponent(m[1]);
      var pr3 = await getProject(pid3);
      if (!pr3) throw err('프로젝트를 찾을 수 없습니다.');
      var list = body.indexes || pr3.cards.map(function (_, i) { return i + 1; });
      exported[pid3] = [];
      for (var i = 0; i < list.length; i++) {
        var blob = await renderCanvas(pr3, pr3.cards[list[i] - 1]);
        exported[pid3].push({ name: 'card-' + String(list[i]).padStart(2, '0') + '.png', blob: blob });
      }
      pr3.status = '내보냄';
      await putProject(pr3);
      return { files: exported[pid3].map(function (f) { return f.name; }),
               folder: '브라우저에서 생성 — ZIP 받기로 저장하세요', db: '브라우저 저장소' };
    }

    throw err('지원하지 않는 요청입니다: ' + method + ' ' + path);
  }

  function kw_sources(kws) { return kws && kws._sources ? kws._sources : ['웹앱 내장 지침']; }

  /* ─────────────────────────────── 다운로드 (window.location 대체) */
  async function download(path) {
    var m = path.match(/^\/api\/projects\/([^/]+)\/download$/);
    if (m) {
      var pid = decodeURIComponent(m[1]);
      var pr = await getProject(pid);
      if (!pr) throw err('프로젝트를 찾을 수 없습니다.');
      var files = exported[pid];
      if (!files || !files.length) {
        // 아직 안 만들었으면 지금 만든다
        await route('/api/projects/' + encodeURIComponent(pid) + '/export', { method: 'POST', body: '{}' });
        files = exported[pid];
      }
      var entries = [];
      for (var i = 0; i < files.length; i++) {
        entries.push({ name: files[i].name, data: new Uint8Array(await files[i].blob.arrayBuffer()) });
      }
      var caption = [pr.caption, '', pr.cta_comment, '', (pr.hashtags || []).join(' ')].join('\n');
      entries.push({ name: 'caption.txt', data: new TextEncoder().encode(caption) });
      save(makeZip(entries), pr.id + '.zip');
      return;
    }
    if (path === '/api/db') {
      var all = (await allProjects()) || [];
      var main = [['ID', '작성일', '수정일시', '주제', '좁힌 주제', '타깃', '컨셉축', '글포맷',
                   '퍼널단계', '후킹', 'CTA키워드', '카드수', '테마', '제목', '컨셉문장',
                   '핵심키워드', '해시태그', '캡션', '댓글CTA', '다음편예고', '자가진단',
                   '전략메모', '원문제목', '상태', '메모']];
      var cards = [['ID', '작성일', '주제', '카드번호', '슬러그', '역할', '템플릿', '배지',
                    '타이틀', '서브', '본문', '노트', '팁', '이미지프롬프트']];
      all.forEach(function (p) {
        var a = p.angle || {}, s = p.source || {};
        main.push([p.id, p.created, p.updated, p.topic, p.topic_refined, p.audience,
                   a.concept_axis || '', a.post_format || '', a.funnel_stage || '',
                   a.hook || '', a.cta_keyword || '', String((p.cards || []).length),
                   (p.theme || {}).label || '', p.title, p.concept_sentence,
                   ((p.keywords || {}).core_keywords || []).join(', '),
                   (p.hashtags || []).join(' '), p.caption, p.cta_comment, p.next_teaser,
                   (p.self_check || []).map(function (c) { return (c.pass ? 'O ' : 'X ') + c.item; }).join(' / '),
                   p.strategy_notes, s.title || '', p.status, p.memo]);
        (p.cards || []).forEach(function (c) {
          cards.push([p.id, p.created, p.topic, String(c.index), c.slug, c.role, c.template,
                      c.badge, c.title, c.subtitle, c.body, c.note, c.tip, c.image_prompt]);
        });
      });
      save(makeXlsx({ '카드뉴스': main, '카드': cards }), 'cardnews_db.xlsx');
      return;
    }
    throw err('지원하지 않는 다운로드입니다: ' + path);
  }

  window.__WEBAPI__ = { route: route, download: download, renderCanvas: renderCanvas, save: save };
})();
