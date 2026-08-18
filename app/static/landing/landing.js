/* 카드뉴스 스튜디오 랜딩페이지 동작
   FAQ는 아래 배열 하나에서 화면과 구조화 데이터를 함께 만들어,
   페이지 문답과 FAQPage 스키마가 어긋나지 않게 한다. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ───────── FAQ (지침서 10.2 원문) */
  var FAQ = [
    ['어떤 프로그램인가요?',
     '주제 또는 원문을 바탕으로 카드뉴스 전략과 문구·이미지 초안을 만들고, 브라우저 캔버스에서 수정한 뒤 PNG·ZIP·엑셀 DB로 남기는 로컬 웹앱입니다.'],
    ['설치가 필요한가요?',
     'Windows에서 run.bat을 실행합니다. 첫 실행에는 Python 가상환경, 필요한 패키지와 Chromium 설치가 진행되고, 이후 로컬 브라우저 주소에서 사용합니다.'],
    ['API 키가 필요한가요?',
     '텍스트 요약·전략·구성·재작성에는 Anthropic API 키가 필요합니다. 배경 이미지 자동 생성에는 OpenAI API 키가 필요하지만, 수동 모드를 이용하면 프롬프트를 복사하고 외부에서 만든 이미지를 직접 넣을 수 있습니다.'],
    ['API 키는 어디에 저장되나요?',
     '기본 설정에서는 사용자가 입력한 키가 해당 브라우저에 저장되고 요청할 때만 서버로 전달됩니다. 설정에서 이 PC 공용 키 저장을 선택할 수 있으므로, 공용 PC에서는 해당 옵션을 켜지 않는 것이 좋습니다.'],
    ['어떤 파일을 입력할 수 있나요?',
     '주제를 직접 입력하거나 .md·.txt 파일과 붙여넣은 본문을 사용할 수 있습니다. 원문이 매우 길면 프로그램이 사용하는 분량이 제한되고 잘렸다는 안내가 표시됩니다.'],
    ['이미지를 꼭 AI로 만들어야 하나요?',
     '아닙니다. OpenAI API로 생성할 수도 있고, 이미지 프롬프트를 복사해 다른 도구에서 만든 뒤 끌어놓거나 파일로 업로드할 수도 있습니다.'],
    ['어떤 결과물을 받을 수 있나요?',
     '1080×1350 카드별 PNG, PNG와 caption.txt가 든 ZIP, 프로젝트 JSON, 배경 이미지와 엑셀 DB 기록을 남길 수 있습니다.'],
    ['SNS에 자동으로 게시되나요?',
     '현재 확인된 버전은 자동 게시나 예약 발행을 제공하지 않습니다. 완성 PNG와 캡션을 내려받아 사용자가 직접 검토하고 게시합니다.'],
    ['AI가 만든 내용은 그대로 써도 되나요?',
     '내장 제작 기준과 입력 원문을 참고하도록 설계되어 있지만, AI 결과의 정확성을 보증하지는 않습니다. 수치·효능·전문 정보와 최종 문구는 게시 전에 사용자가 확인해야 합니다.'],
    ['여러 사람이 동시에 쓸 수 있나요?',
     '사용자별 브라우저 키 입력 방식은 마련되어 있지만, 현재 확인된 기능만으로는 실시간 공동 편집이나 사용자별 클라우드 작업 공간을 제공한다고 볼 수 없습니다.']
  ];

  var list = document.getElementById('faqList');
  FAQ.forEach(function (qa, i) {
    var item = document.createElement('div');
    item.className = 'faq-item';

    var h = document.createElement('h3');
    h.style.margin = '0';
    var btn = document.createElement('button');
    btn.className = 'faq-q';
    btn.id = 'faqq' + i;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'faqa' + i);
    btn.dataset.ev = 'expand_faq';
    var label = document.createElement('span');
    label.textContent = 'Q' + (i + 1) + '. ' + qa[0];
    btn.appendChild(label);
    h.appendChild(btn);

    var ans = document.createElement('div');
    ans.className = 'faq-a';
    ans.id = 'faqa' + i;
    ans.setAttribute('role', 'region');
    ans.setAttribute('aria-labelledby', 'faqq' + i);
    ans.hidden = true;
    ans.textContent = qa[1];

    item.appendChild(h);
    item.appendChild(ans);
    list.appendChild(item);
  });

  list.addEventListener('click', function (e) {
    var btn = e.target.closest('.faq-q');
    if (!btn) return;
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    document.getElementById(btn.getAttribute('aria-controls')).hidden = open;
  });

  /* 구조화 데이터 — 화면 문답과 같은 배열에서 생성 */
  var ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map(function (qa) {
          return {
            '@type': 'Question',
            name: qa[0],
            acceptedAnswer: { '@type': 'Answer', text: qa[1] }
          };
        })
      },
      {
        '@type': 'SoftwareApplication',
        name: '카드뉴스 스튜디오',
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Windows',
        description: '주제를 입력하면 카드 구성과 문구·이미지 초안을 만들고, 직접 편집해 PNG·ZIP과 엑셀 DB로 남기는 카드뉴스 자동생성기.'
      }
    ]
  });
  document.head.appendChild(ld);

  /* ───────── 모바일 내비 */
  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');
  toggle.addEventListener('click', function () {
    var open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    toggle.setAttribute('aria-label', open ? '메뉴 열기' : '메뉴 닫기');
    nav.classList.toggle('open', !open);
  });
  nav.addEventListener('click', function (e) {
    if (e.target.tagName === 'A') {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  /* ───────── 헤더 축소 + 현재 섹션 표시 */
  var header = document.getElementById('siteHeader');
  addEventListener('scroll', function () {
    header.classList.toggle('shrink', window.scrollY > 40);
  }, { passive: true });

  var links = Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]'));
  var targets = links
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && targets.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) {
          a.setAttribute('aria-current',
            a.getAttribute('href') === '#' + en.target.id ? 'true' : 'false');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    targets.forEach(function (t) { spy.observe(t); });
  }

  /* ───────── 전체 기능 보기 */
  var more = document.getElementById('moreFeatures');
  var hiddenCards = Array.prototype.slice.call(
    document.querySelectorAll('#featureGrid .fcard[hidden]'));
  more.addEventListener('click', function () {
    var open = more.getAttribute('aria-expanded') === 'true';
    hiddenCards.forEach(function (c) { c.hidden = open; });
    more.setAttribute('aria-expanded', String(!open));
    more.textContent = open ? '전체 기능 보기' : '기능 접기';
  });

  /* ───────── 탭 (좌우 화살표 키 지원) */
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function selectTab(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(tab); });
    tab.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var nextTab = tabs[(i + d + tabs.length) % tabs.length];
      nextTab.focus();
      selectTab(nextTab);
    });
  });

  /* ───────── 결과물 갤러리 */
  var gal = document.getElementById('gallery');
  var prevBtn = document.getElementById('galPrev');
  var nextBtn = document.getElementById('galNext');

  function step(dir) {
    var card = gal.querySelector('.gcard');
    var w = card ? card.offsetWidth + 18 : 250;
    gal.scrollBy({ left: dir * w, behavior: reduced ? 'auto' : 'smooth' });
  }
  prevBtn.addEventListener('click', function () { step(-1); });
  nextBtn.addEventListener('click', function () { step(1); });

  function syncNav() {
    prevBtn.disabled = gal.scrollLeft <= 2;
    nextBtn.disabled = gal.scrollLeft + gal.clientWidth >= gal.scrollWidth - 2;
  }
  gal.addEventListener('scroll', syncNav, { passive: true });
  addEventListener('resize', syncNav);
  syncNav();

  /* ───────── 라이트박스 */
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var lbCap = document.getElementById('lbCap');
  var lbClose = document.getElementById('lbClose');
  var opener = null;

  gal.addEventListener('click', function (e) {
    var card = e.target.closest('.gcard');
    if (!card) return;
    opener = card;
    lbImg.src = card.dataset.full;
    lbImg.alt = card.querySelector('img').alt;
    lbCap.textContent = card.dataset.cap;
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    lbClose.focus();
  });

  function closeLb() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    if (opener) opener.focus();
  }
  lbClose.addEventListener('click', closeLb);
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  addEventListener('keydown', function (e) {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape') closeLb();
    if (e.key === 'Tab') { e.preventDefault(); lbClose.focus(); }
  });

  /* ───────── 등장 효과 (한 번만) */
  var revealables = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
  if (reduced || !('IntersectionObserver' in window)) {
    /* 아무것도 하지 않는다 — CSS 기본값이 이미 보이는 상태다 */
  } else {
    document.documentElement.classList.add('has-reveal');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
      });
    }, { rootMargin: '0px 0px -12% 0px' });
    revealables.forEach(function (el) { io.observe(el); });
  }
})();
