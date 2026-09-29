/* PP3S — 페이지 동작
   스크롤 한 축이 페이지 전체를 지휘합니다: 지금 어느 역(섹션)인지, LED 80개가 어떤 모양·상태인지, 모형이 얼마나 조립됐는지. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Scene = () => window.PP3SScene;

  // LED 세그먼트 미터: 켜질 때는 빠르게, 꺼질 때는 천천히, 최고점은 잠시 붙잡아 둡니다
  class SegMeter {
    constructor(el) {
      this.el = el; this.n = parseInt(el.dataset.n, 10) || 40;
      el.style.setProperty('--n', this.n);
      const th = parseFloat(el.dataset.th || '1');
      el.style.setProperty('--th', th);
      this.dots = [];
      for (let i = 0; i < this.n; i++) { const d = document.createElement('i'); el.appendChild(d); this.dots.push(d); }
      const thIdx = Math.min(this.n - 1, Math.round(th * this.n) - 1);
      this.dots[thIdx].classList.add('is-th');
      this.level = 0; this.peak = 0; this.peakT = 0; this.lit = -1; this.pk = -1;
    }
    update(frac, near, dt) {
      const k = frac > this.level ? 14 : 3.2;
      this.level += (frac - this.level) * (1 - Math.exp(-k * dt));
      if (this.level >= this.peak) { this.peak = this.level; this.peakT = 0.9; }
      else if ((this.peakT -= dt) <= 0) this.peak = Math.max(this.level, this.peak - dt * 0.35);
      const lit = Math.round(this.level * this.n), pk = Math.min(this.n - 1, Math.round(this.peak * this.n) - 1);
      this.el.classList.toggle('is-near', near);
      if (lit === this.lit && pk === this.pk) return;
      this.lit = lit; this.pk = pk;
      this.dots.forEach((d, i) => { d.classList.toggle('is-on', i < lit); d.classList.toggle('is-peak', i === pk && pk >= lit); });
    }
  }

  const fontsReady = Promise.race([
    document.fonts ? document.fonts.ready : Promise.resolve(),
    new Promise((r) => setTimeout(r, 1500)),
  ]);

  // ── 선으로 쓰는 글씨 ────────────────────────
  // SVG 글자의 윤곽을 분홍 선이 따라 그린 뒤 채웁니다.
  function fitLine(svg) {
    const t = svg.querySelector('text');
    const b = t.getBBox();
    const pad = 6;
    svg.setAttribute('viewBox', `${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`);
    svg.style.setProperty('--dash', Math.round(b.height * 14));
  }
  function writeLine(svg) {
    fitLine(svg);
    svg.classList.remove('is-writing', 'is-done');
    if (reduce) { svg.classList.add('is-done'); return; }
    void svg.getBoundingClientRect();
    svg.classList.add('is-writing');
  }

  // ── 입장 연출 ──────────────────────────────
  const intro = $('#intro');
  let introDone = false;
  function finishIntro() {
    if (introDone) return;
    introDone = true;
    intro.classList.add('is-open');
    document.body.classList.remove('is-booting');
    document.body.classList.add('is-ready');
    setTimeout(() => writeLine($('#heroMark')), reduce ? 0 : 420);
    setTimeout(() => intro.classList.add('is-gone'), reduce ? 0 : 1500);
  }
  function runIntro() {
    const strip = $('#introStrip'), count = $('#introCount'), word = $('#introWord');
    const leds = [];
    for (let i = 0; i < 80; i++) { const d = document.createElement('i'); strip.appendChild(d); leds.push(d); }
    const t0 = performance.now();
    let phase = 0, lastLit = 0;
    (function step(now) {
      if (introDone) return;
      const t = (now - t0) / 1000;
      if (t < 1.2) {
        const lit = Math.min(80, Math.floor((t / 1.1) * 80));
        for (let i = lastLit; i < lit; i++) leds[i].classList.add('is-on');
        lastLit = lit;
        count.textContent = String(lit).padStart(2, '0');
      } else if (phase === 0) {
        phase = 1; count.textContent = '80';
        intro.classList.add('is-word');
        writeLine(word);
      } else if (phase === 1 && t > 3.0) {
        phase = 2;
        const txt = word.querySelector('text');
        txt.textContent = 'PP3S'; txt.style.fontFamily = 'var(--f-dot)';
        writeLine(word);
      } else if (phase === 2 && t > 4.5) { finishIntro(); return; }
      requestAnimationFrame(step);
    })(t0);
  }
  $('#introSkip').addEventListener('click', finishIntro);
  ['wheel', 'touchmove', 'keydown'].forEach((ev) => window.addEventListener(ev, () => { if (!introDone && performance.now() > 900) finishIntro(); }, { passive: true }));

  // ── 스크롤 글쓰기 ──────────────────────────
  const writes = $$('[data-write]').map((el) => {
    const text = el.textContent.trim();
    el.setAttribute('aria-label', text);
    el.textContent = '';
    const chars = [];
    text.split(/(\s+)/).forEach((word) => {
      if (/^\s+$/.test(word)) { el.appendChild(document.createTextNode(' ')); return; }
      const w = document.createElement('span');
      w.style.whiteSpace = 'nowrap'; w.setAttribute('aria-hidden', 'true');
      Array.from(word).forEach((ch) => { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; w.appendChild(s); chars.push(s); });
      el.appendChild(w);
    });
    return { el, chars, last: -1 };
  });
  function updateWrites(vh) {
    writes.forEach((w) => {
      const r = w.el.getBoundingClientRect();
      const p = reduce ? 1 : clamp((vh * 0.88 - r.top) / (r.height + vh * 0.38));
      const n = Math.floor(p * (w.chars.length + 1));
      if (n === w.last) return;
      w.last = n;
      w.chars.forEach((c, i) => { c.classList.toggle('is-lit', i < n); c.classList.toggle('is-head', i === n - 1 && p < 1); });
    });
  }

  // ── 섹션 · 노선 표시줄 ─────────────────────
  const sections = $$('main > section, footer.end');
  const stations = $$('#routeList a');
  const routeNow = $('#routeNow');
  const routeList = $('#routeList');
  let current = null;
  function setCurrent(sec) {
    if (sec === current) return;
    current = sec;
    const id = sec.id || 'team';
    let idx = stations.findIndex((a) => a.dataset.station === id);
    if (idx < 0) idx = stations.length - 1;
    stations.forEach((a, i) => { a.classList.toggle('is-now', i === idx); a.classList.toggle('is-past', i < idx); if (i === idx) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    routeList.style.setProperty('--route-p', idx / (stations.length - 1));
    routeNow.textContent = stations[idx].textContent.trim();
  }

  // ── 첫 화면: 접근 → 착석 → 하차 반복 시연 ───
  const hero = { dbm: $('#heroDbm'), meter: new SegMeter($('#heroSegs')), state: $('#heroState'), box: $('#heroReadout'), last: '' };
  const STATE_KO = { idle: '대기', approach: '접근 감지', seated: '착석 확인', exit: '하차' };
  function heroLoop(t) {
    const L = 15, x = t % L;
    let dbm, badge, st;
    if (x < 3) { dbm = lerp(-95, -66, x / 3); badge = x / 3; }
    else if (x < 6) { dbm = -64 + Math.sin(x * 3) * 1.5; badge = 1; }
    else if (x < 6.8) { dbm = -61; badge = 1 + (x - 6) / 0.8; }
    else if (x < 10) { dbm = -60 + Math.sin(x * 2) * 1; badge = 2; }
    else if (x < 11.2) { dbm = lerp(-60, -94, (x - 10) / 1.2); badge = lerp(2, 0, (x - 10) / 1.2); }
    else { dbm = -95 + Math.sin(x) * 0.8; badge = 0; }
    if (x < 6.4 && dbm >= -70) st = 'approach';
    else if (x >= 6.4 && x < 10.5) st = 'seated';
    else if (x >= 10.5 && x < 13.6) st = 'exit';
    else st = 'idle';
    return { dbm, badge, st };
  }
  function renderHero(h, dt) {
    hero.dbm.textContent = '−' + Math.abs(Math.round(h.dbm));
    hero.meter.update(clamp((h.dbm + 100) / 42), h.dbm >= -70, dt);
    hero.box.classList.toggle('is-near', h.dbm >= -70);
    if (h.st !== hero.last) { hero.last = h.st; hero.state.dataset.state = h.st; hero.state.textContent = STATE_KO[h.st]; }
  }

  // ── 동작 원리 (스크롤 = 거리) ───────────────
  const flow = { sec: $('#flow'), state: $('#flowState'), frame: $('.flow__frame'), now: $('#flowNow'), dbm: $('#flowDbm'), meter: new SegMeter($('#flowSegs')), nfc: $('#flowNfc'), steps: $$('#flowSteps li'), photos: $$('.flow__frame img'), last: '' };
  const FLOW_TEXT = {
    idle: ['대기', '대기 · 평상시에는 조명이 꺼져 있고 웹에는 ‘비어 있음’이 표시됩니다.'],
    approach: ['접근', '접근 · 뱃지 신호가 −70 dBm을 넘으면 바닥 조명이 분홍빛으로 깜빡이며 양보를 부탁합니다.'],
    seated: ['착석', '착석 · 기둥의 NFC 리더기에 뱃지를 대면 빛이 고정되고, 웹의 좌석이 ‘사용 중’으로 바뀝니다.'],
    exit: ['하차', '하차 · 뱃지 신호가 멀어지면 내린 것으로 보고, 깜빡인 뒤 조명을 끄고 ‘비어 있음’으로 돌립니다.'],
  };
  function flowAt(p) {
    let dbm, st, nfc = false, photo;
    if (p < 0.18) dbm = lerp(-100, -82, p / 0.18);
    else if (p < 0.4) dbm = lerp(-82, -62, (p - 0.18) / 0.22);
    else if (p < 0.7) dbm = -61;
    else if (p < 0.8) dbm = lerp(-61, -97, (p - 0.7) / 0.1);
    else dbm = -98;
    if (p >= 0.43 && p < 0.72) { st = 'seated'; nfc = true; }
    else if (p < 0.43 && dbm >= -70) st = 'approach';
    else if (p >= 0.72 && p < 0.9) st = 'exit';
    else st = 'idle';
    photo = st;
    return { dbm, st, nfc, photo };
  }
  function renderFlow(p, dt) {
    const f = flowAt(p);
    flow.dbm.textContent = '−' + Math.abs(Math.round(f.dbm));
    flow.meter.update(clamp((f.dbm + 100) / 30), f.dbm >= -70, dt);
    flow.sec.classList.toggle('is-near', f.dbm >= -70);
    flow.nfc.textContent = f.nfc ? 'NFC 태그 확인' : 'NFC 대기';
    flow.nfc.classList.toggle('is-on', f.nfc);
    if (f.st !== flow.last) {
      flow.last = f.st;
      flow.sec.classList.toggle('is-seated', f.st === 'seated');
      flow.state.textContent = FLOW_TEXT[f.st][0];
      flow.state.dataset.state = f.st;
      flow.state.classList.remove('is-swap'); void flow.state.offsetWidth; flow.state.classList.add('is-swap');
      flow.now.textContent = FLOW_TEXT[f.st][1];
      flow.steps.forEach((li) => li.classList.toggle('is-now', li.dataset.step === f.st));
      flow.photos.forEach((img) => img.classList.toggle('is-on', img.dataset.photo === f.photo));
    }
    return f.st;
  }

  // ── 조립 ────────────────────────────────────
  const asm = { sec: $('#assembly'), items: $$('#asmList li'), count: $('#asmCount'), last: -2 };
  // 단계마다 스크롤 길이가 다릅니다: 바닥 합판·아크릴·LED는 천천히 보여 줍니다
  const ASM_W = [1.8, 1.8, 2.4, 1, 1, 1, 1, 1, 1.2];
  const ASM_T = ASM_W.reduce((a, b) => a + b, 0);
  function asmProgress(q) {
    let acc = 0;
    for (let i = 0; i < ASM_W.length; i++) {
      const w = ASM_W[i] / ASM_T;
      if (q <= acc + w) return (i + (q - acc) / w) / ASM_W.length;
      acc += w;
    }
    return 1;
  }
  function renderAssembly(p, S) {
    const e = asmProgress(clamp(p / 0.66));
    const n = 9;
    const step = Math.min(n - 1, Math.floor(e * n - 0.02));
    const placed = Math.min(n, Math.floor(e * n + 0.02));
    if (step !== asm.last) {
      asm.last = step;
      asm.items.forEach((li, i) => { li.classList.toggle('is-now', i === step); li.classList.toggle('is-done', i < step); });
    }
    asm.count.textContent = placed;
    const real = p > 0.88;
    asm.sec.classList.toggle('is-real', real);
    if (!S) return;
    const tg = S.target;
    tg.explode = e;
    tg.focus = e < 1 ? step : -1;
    tg.view = 1;
    tg.modelVis = real ? 0 : 1;
    // LED 단계: ㄱ자를 따라 한 칸씩 차오르고, 그 뒤로는 조립이 끝날 때까지 계속 켜져 있습니다
    const le = clamp((e * n - 2) / 0.85);
    tg.ledTest = le;
    tg.modelLed = le >= 1 ? 'seated' : 'idle';
    // 조립 뒤: 뱃지가 다가와 NFC에 태그합니다
    if (p < 0.7) tg.badge = 0;
    else if (p < 0.79) tg.badge = clamp((p - 0.7) / 0.07);
    else tg.badge = 1 + clamp((p - 0.79) / 0.05);
  }

  // ── 결과: 점 80개로 채우는 진행도 ──────────
  const doneDots = [];
  $$('.dots').forEach((d) => { for (let i = 0; i < 80; i++) { const c = document.createElement('i'); d.appendChild(c); doneDots.push(c); } });
  let doneLit = -1;
  function renderDone(p) {
    const lit = Math.round(clamp(p * 1.5) * doneDots.length);
    if (lit === doneLit) return;
    doneLit = lit;
    doneDots.forEach((c, i) => c.classList.toggle('is-on', i < lit));
  }

  // ── 스크롤 루프 ─────────────────────────────
  let heroT = 3.1, lastNow = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastNow) / 1000); lastNow = now;
    const vh = window.innerHeight;
    const y = window.scrollY;
    const S = Scene();
    if (S) S.setScroll(y);
    updateWrites(vh);

    // 지금 역: 화면 가운데를 지나는 섹션
    const mid = vh * 0.5;
    let cur = sections[0];
    for (const s of sections) { const r = s.getBoundingClientRect(); if (r.top <= mid && r.bottom > mid) { cur = s; break; } if (r.top > mid) break; cur = s; }
    setCurrent(cur);

    const tg = S && S.target;
    const scene = cur.dataset.scene;
    const phone = window.innerWidth < 720;
    if (scene === 'hero') {
      heroT += reduce ? 0 : dt;
      const h = heroLoop(reduce ? 7.5 : heroT);
      renderHero(h, dt);
      if (tg) {
        const r = cur.getBoundingClientRect();
        const out = clamp(-r.top / (r.height * 0.8));
        Object.assign(tg, { modelVis: 1 - out, ribbonVis: 0, view: 0, explode: 1, focus: -1, badge: h.badge, modelLed: h.st, ledTest: 0 });
      }
    } else if (scene === 'assembly') {
      const r = cur.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - vh));
      if (tg) { tg.ribbonVis = 0; }
      renderAssembly(p, S);
    } else {
      // LED 80개: 섹션마다 모양(form)·자리(rect)·상태(led)가 바뀝니다
      let form = cur.dataset.form || 'drift', led = cur.dataset.led, rect = null, vis = 1;
      if (led === 'flow') {
        const r = cur.getBoundingClientRect();
        const st = renderFlow(clamp(-r.top / (r.height - vh)), dt);
        led = st;
        form = st === 'approach' ? 'wave' : st === 'seated' || st === 'exit' ? 'frame' : 'drift';
        rect = rectOf(flow.frame, st === 'idle' ? 1.35 : 1);
      } else if (led === 'fill') {
        const r = cur.getBoundingClientRect();
        const p = clamp((vh * 0.9 - r.top) / (vh * 1.1));
        renderDone(p);
        if (tg) tg.fill = clamp(p * 1.5);
        form = 'column';
        rect = { cx: phone ? 0.975 : 0.965, cy: 0.52, w: 0.01, h: 0.72 };
        if (phone) vis = 0.5;
      }
      if (!rect) {
        switch (form) {
          case 'grid': rect = rectOf($('#inventory')); break;
          case 'route': rect = rectOf($('#diagram')); vis = phone ? 0 : 0.55; break;
          case 'seats': rect = rectOf($('.phones')); break;
          case 'ring': form = 'border'; rect = rectOf($('.screen__frame')); break;
          case 'lline': form = 'bar'; rect = rectOf($('#endWord')); break;
          default:
            if (cur.id === 'fixes') rect = { cx: 0.5, cy: 0.55, w: 0.8, h: 0.8 };
            else if (cur.id === 'build') { rect = { cx: 0.8, cy: 0.24, w: 0.26, h: 0.3 }; if (phone) vis = 0; }
            else { rect = { cx: 0.83, cy: 0.5, w: 0.2, h: 0.55 }; if (phone) vis = 0; }
        }
      }
      if (tg) {
        tg.modelVis = 0; tg.view = 0; tg.ribbonVis = vis; tg.ribbonDim = 1;
        tg.form = form; tg.formRect = rect; tg.ribbonLed = led === 'fill' ? 'seated' : led;
      }
    }
    requestAnimationFrame(frame);
  }
  // 요소의 화면 위치를 화면 비율(0~1)로 바꿉니다
  function rectOf(el, grow = 1) {
    const r = el.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
    return { cx: (r.left + r.width / 2) / W, cy: (r.top + r.height / 2) / H, w: (r.width / W) * grow, h: (r.height / H) * grow };
  }

  // ── 보이면 써지는 글씨 ──────────────────────
  new IntersectionObserver((entries, io) => {
    entries.forEach((en) => { if (en.isIntersecting) { writeLine(en.target); io.unobserve(en.target); } });
  }, { threshold: 0.5 }).observe($('#endWord'));

  // ── 부품 칸 ─────────────────────────────────
  $$('#inventory .cell').forEach((cell, _, all) => {
    cell.addEventListener('click', () => {
      const open = cell.getAttribute('aria-expanded') === 'true';
      all.forEach((c) => c.setAttribute('aria-expanded', 'false'));
      cell.setAttribute('aria-expanded', String(!open));
    });
  });

  // ── 제작기 필름 ─────────────────────────────
  const film = $('#film'), filmFill = $('#filmFill');
  function filmRail() {
    const max = film.scrollWidth - film.clientWidth;
    const frac = film.clientWidth / film.scrollWidth;
    filmFill.style.width = frac * 100 + '%';
    filmFill.style.left = (max > 0 ? (film.scrollLeft / max) * (1 - frac) : 0) * 100 + '%';
  }
  film.addEventListener('scroll', filmRail, { passive: true });
  $$('[data-film]').forEach((b) => b.addEventListener('click', () => {
    const fig = film.querySelector('figure');
    film.scrollBy({ left: Number(b.dataset.film) * (fig.getBoundingClientRect().width + 18), behavior: reduce ? 'auto' : 'smooth' });
  }));
  (function drag() {
    let down = false, sx = 0, sl = 0, moved = false;
    film.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') return; down = true; moved = false; sx = e.clientX; sl = film.scrollLeft; });
    window.addEventListener('pointermove', (e) => { if (!down) return; const d = e.clientX - sx; if (Math.abs(d) > 4) { moved = true; film.classList.add('is-drag'); } film.scrollLeft = sl - d; });
    window.addEventListener('pointerup', () => { if (!down) return; down = false; film.classList.remove('is-drag'); });
    film.addEventListener('click', (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); } }, true);
  })();
  film.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); $(`[data-film="${e.key === 'ArrowRight' ? 1 : -1}"]`).click(); }
  });

  // ── 크기 변경 ───────────────────────────────
  let rz;
  window.addEventListener('resize', () => {
    clearTimeout(rz);
    rz = setTimeout(() => { filmRail(); }, 150);
  });

  // ── 시작 ────────────────────────────────────
  fontsReady.then(() => {
    filmRail();
    requestAnimationFrame(frame);
    if (reduce || location.hash) { finishIntro(); } else { runIntro(); }
  });
})();
