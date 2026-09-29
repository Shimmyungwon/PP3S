/* PP3S 3D 장면
   1) 배려석 모듈: 실제 시제품(바닥 합판, ㄱ자 LED, 배선 박스, 투명 아크릴 박스, 분홍 의자, 기둥, NFC 리더기, 뱃지)을 본뜬 모형
   2) LED 띠: WS2812B 80개가 달린 유연한 띠. 섹션마다 대기·접근·착석·하차 상태를 재현합니다.
   main.js가 target 값을 바꾸면, 이 파일은 관성을 두고 그 값으로 따라갑니다. */
(function () {
  if (!window.THREE) { window.PP3SScene = null; return; }
  const T = THREE;
  const canvas = document.getElementById('stage');
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { window.PP3SScene = null; return; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);

  const PINK = new T.Color(0xff1464);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── 반사용 환경: 어두운 객차 천장 조명 두 줄 ──
  (function env() {
    const pm = new T.PMREMGenerator(renderer);
    const es = new T.Scene();
    const room = new T.Mesh(new T.BoxGeometry(20, 8, 20), new T.MeshBasicMaterial({ color: 0x101011, side: T.BackSide }));
    es.add(room);
    const lamp = new T.MeshBasicMaterial({ color: 0xffffff });
    [-2.2, 2.2].forEach((x) => { const m = new T.Mesh(new T.BoxGeometry(0.6, 0.1, 16), lamp); m.position.set(x, 3.9, 0); es.add(m); });
    const side = new T.Mesh(new T.BoxGeometry(0.1, 3, 14), new T.MeshBasicMaterial({ color: 0x8e8e92 }));
    side.position.set(-9.9, 1, 0); es.add(side);
    const pinkStrip = new T.Mesh(new T.BoxGeometry(12, 0.05, 0.3), new T.MeshBasicMaterial({ color: 0x551030 }));
    pinkStrip.position.set(0, -3.9, 3); es.add(pinkStrip);
    scene.environment = pm.fromScene(es, 0.04).texture;
    pm.dispose();
  })();

  scene.add(new T.HemisphereLight(0xe6e4e0, 0x161616, 0.32));
  const key = new T.DirectionalLight(0xfff6f0, 1.35);
  key.position.set(3, 6, 5); scene.add(key);
  const rim = new T.DirectionalLight(0xc4c4c8, 0.7);
  rim.position.set(-5, 3, -4); scene.add(rim);

  // ── 글로우 텍스처 (LED 한 개의 빛) ──
  const glowTex = (function () {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.12, 'rgba(255,210,226,0.95)');
    r.addColorStop(0.3, 'rgba(255,60,130,0.45)');
    r.addColorStop(0.62, 'rgba(255,20,100,0.1)');
    r.addColorStop(1, 'rgba(255,20,100,0)');
    g.fillStyle = r; g.fillRect(0, 0, 128, 128);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; return t;
  })();
  function glowPoints(n, size) {
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('color', new T.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new T.PointsMaterial({
      size, map: glowTex, vertexColors: true, transparent: true, depthWrite: false,
      blending: T.AdditiveBlending, sizeAttenuation: true,
    });
    const p = new T.Points(geo, mat); p.frustumCulled = false; return p;
  }

  // ═════════════ 배려석 모듈 ═════════════
  const seat = new T.Group();
  scene.add(seat);
  const parts = []; // { group, rest: Vector3, ex: Vector3, mats: [] }
  function part(build, ex) {
    const g = new T.Group();
    build(g);
    const mats = [];
    g.traverse((o) => {
      if (o.material) {
        const arr = Array.isArray(o.material) ? o.material : [o.material];
        arr.forEach((m) => { m.transparent = true; m.userData.base = m.opacity; mats.push(m); });
      }
    });
    seat.add(g);
    parts.push({ group: g, ex: new T.Vector3(...ex).multiplyScalar(0.72), mats, alpha: 1 });
    return g;
  }
  const lin = (hex) => new T.Color(hex).convertSRGBToLinear();
  const std = (color, rough, metal, extra) => new T.MeshStandardMaterial(Object.assign({ color: lin(color), roughness: rough, metalness: metal || 0, envMapIntensity: metal ? 1 : 0.5 }, extra || {}));
  const TOP = 0.13; // 바닥 윗면 높이

  // ㄱ자 조명 경로 (앞쪽 가로 → 오른쪽 세로)
  const LA = new T.Vector3(-0.78, 0, 0.64), LB = new T.Vector3(0.66, 0, 0.64), LC = new T.Vector3(0.66, 0, -0.8);
  const segAB = LA.distanceTo(LB), segBC = LB.distanceTo(LC);
  function lPoint(s, y) { // s: 0..1 along ㄱ
    const d = s * (segAB + segBC);
    const p = d < segAB ? LA.clone().lerp(LB, d / segAB) : LB.clone().lerp(LC, (d - segAB) / segBC);
    p.y = y; return p;
  }
  function slab(a, b, w, h, mat, y) {
    const len = a.distanceTo(b);
    const m = new T.Mesh(new T.BoxGeometry(len, h, w), mat);
    m.position.copy(a).lerp(b, 0.5); m.position.y = y;
    m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    return m;
  }

  // 0 바닥 합판 + 시트
  part((g) => {
    const ply = new T.Mesh(new T.BoxGeometry(2.1, 0.11, 2.1), std(0x9c7a52, 0.82));
    ply.position.y = 0.055; g.add(ply);
    const sheet = new T.Mesh(new T.BoxGeometry(2.1, 0.02, 2.1), std(0x6f7379, 0.96));
    sheet.position.y = 0.12; g.add(sheet);
    const slot = std(0x0a0b0d, 0.9);
    g.add(slab(LA, LB, 0.08, 0.006, slot, TOP + 0.003));
    g.add(slab(LB.clone().add(new T.Vector3(0, 0, 0.04)), LC, 0.08, 0.006, slot, TOP + 0.003));
  }, [0, -1.25, 0]);

  // 1 유백색 아크릴 확산판
  const DIFF_OFF = lin(0xd9d5d7), DIFF_ON = new T.Color(1.0, 0.1, 0.42);
  const mkDiff = () => new T.MeshStandardMaterial({ color: DIFF_OFF.clone(), roughness: 0.45, emissive: new T.Color(0xff1464), emissiveIntensity: 0 });
  const diffA = mkDiff(), diffB = mkDiff(); // 앞쪽 가로 구간 / 옆쪽 세로 구간
  part((g) => {
    g.add(slab(LA, LB, 0.064, 0.008, diffA, TOP + 0.01));
    g.add(slab(LB.clone().add(new T.Vector3(0, 0, 0.032)), LC, 0.064, 0.008, diffB, TOP + 0.01));
  }, [0, 0.55, 0.35]);

  // 2 LED 스트립 (80개)
  const seatLeds = glowPoints(80, 0.32);
  seatLeds.material.depthTest = false;
  part((g) => {
    const tape = std(0xdfe2e5, 0.55);
    g.add(slab(LA, LB, 0.045, 0.004, tape, TOP + 0.004));
    g.add(slab(LB.clone().add(new T.Vector3(0, 0, 0.02)), LC, 0.045, 0.004, tape, TOP + 0.004));
    const pkg = new T.InstancedMesh(new T.BoxGeometry(0.028, 0.008, 0.028), std(0xf5f5f5, 0.4), 80);
    const m4 = new T.Matrix4();
    const pos = seatLeds.geometry.attributes.position;
    for (let i = 0; i < 80; i++) {
      const p = lPoint((i + 0.5) / 80, TOP + 0.0);
      m4.makeTranslation(p.x, p.y, p.z); pkg.setMatrixAt(i, m4);
      pos.setXYZ(i, p.x, p.y + 0.03, p.z);
    }
    g.add(pkg); g.add(seatLeds);
  }, [0, 0.2, 0.9]);

  // 3 배선 박스 + ESP32 + PD 보드
  part((g) => {
    const box = new T.Mesh(new T.BoxGeometry(0.56, 0.2, 0.42), std(0x575b62, 0.8));
    box.position.set(0.06, TOP + 0.1, -0.2); g.add(box);
    const esp = new T.Mesh(new T.BoxGeometry(0.3, 0.018, 0.13), std(0x17191d, 0.5));
    esp.position.set(-0.04, TOP + 0.209, -0.2); g.add(esp);
    const chip = new T.Mesh(new T.BoxGeometry(0.1, 0.012, 0.09), std(0xb9c0c8, 0.3, 0.8));
    chip.position.set(-0.1, TOP + 0.222, -0.2); g.add(chip);
    const pd = new T.Mesh(new T.BoxGeometry(0.13, 0.018, 0.13), std(0x23262c, 0.5));
    pd.position.set(0.22, TOP + 0.209, -0.2); g.add(pd);
    const term = new T.Mesh(new T.BoxGeometry(0.05, 0.04, 0.07), std(0x2f9d67, 0.6));
    term.position.set(0.26, TOP + 0.235, -0.2); g.add(term);
  }, [1.35, 1.0, -0.2]);

  // 4 투명 아크릴 박스
  part((g) => {
    const geo = new T.BoxGeometry(0.9, 0.62, 0.74);
    const glass = new T.Mesh(geo, new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, opacity: 0.1, clearcoat: 1, envMapIntensity: 1.4, depthWrite: false }));
    glass.position.set(0.06, TOP + 0.31, -0.2); g.add(glass);
    const edges = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: 0xe9ecef, opacity: 0.55 }));
    edges.position.copy(glass.position); g.add(edges);
  }, [0, 1.55, 0]);

  // 5 분홍 의자: 앉는 면과 등받이가 한 장으로 이어진 셸 의자 (가장자리가 살짝 말려 올라감, 두께 있음)
  function shellChair(mat) {
    // 옆에서 본 단면: 앞쪽 끝 → 앉는 면(살짝 오목) → 둥글게 꺾임 → 뒤로 기운 등받이
    const prof = new T.CatmullRomCurve3([
      new T.Vector3(0, -0.035, 0.3), new T.Vector3(0, 0.0, 0.2), new T.Vector3(0, -0.03, -0.05),
      new T.Vector3(0, -0.01, -0.27), new T.Vector3(0, 0.06, -0.42), new T.Vector3(0, 0.2, -0.52),
      new T.Vector3(0, 0.42, -0.6), new T.Vector3(0, 0.64, -0.7),
    ], false, 'centripetal');
    const NU = 40, NV = 110, TH = 0.03;
    const width = (v) => {
      let w = 0.82 + 0.08 * Math.sin(Math.min(1, v / 0.5) * Math.PI * 0.5);                            // 뒤로 갈수록 약간 넓어짐
      if (v < 0.06) w *= 0.8 + 0.2 * Math.sin((v / 0.06) * Math.PI * 0.5);                               // 앞쪽 모서리 둥글게
      if (v > 0.8) w *= Math.pow(Math.max(0.0, 1 - Math.pow((v - 0.8) / 0.2, 2.6)), 0.42);             // 등받이 윗모서리 크게 둥글게
      return Math.max(w, 0.06);
    };
    const top = [], bot = [];
    const pt = new T.Vector3(), tg = new T.Vector3();
    for (let b = 0; b <= NV; b++) {
      const v = b / NV;
      prof.getPointAt(v, pt); prof.getTangentAt(v, tg);
      const ny = -tg.z, nz = tg.y; // 단면의 안쪽(앉는 쪽) 방향
      const w = width(v);
      // 등받이일수록 옆이 앞으로 감싸고, 앉는 면은 옆이 살짝 올라감
      const wrap = (0.045 + 0.06 * Math.min(1, Math.max(0, (v - 0.35) / 0.35))) * (v > 0.8 ? 1 - (v - 0.8) / 0.2 * 0.7 : 1);
      for (let a = 0; a <= NU; a++) {
        const u = (a / NU) * 2 - 1;
        const lift = wrap * Math.pow(Math.abs(u), 3);
        const x = u * w / 2;
        // 옆면은 앞쪽(앉는 쪽)으로만 감싸 윗모서리가 들뜨지 않게 합니다
        const y = pt.y + ny * lift * (v > 0.5 ? 0.35 : 1), z = pt.z + nz * lift;
        top.push(x, y, z);
        bot.push(x, y - ny * TH, z - nz * TH);
      }
    }
    const pos = [], idx = [];
    const add = (arr) => { const base = pos.length / 3; for (let k = 0; k < arr.length; k++) pos.push(arr[k]); return base; };
    const tb = add(top), bb = add(bot), row = NU + 1;
    for (let b = 0; b < NV; b++) for (let a = 0; a < NU; a++) {
      const i0 = b * row + a, i1 = i0 + 1, i2 = i0 + row, i3 = i2 + 1;
      idx.push(tb + i0, tb + i2, tb + i1, tb + i1, tb + i2, tb + i3);
      idx.push(bb + i0, bb + i1, bb + i2, bb + i1, bb + i3, bb + i2);
    }
    // 가장자리 두께 면
    const rim = (ia, ib) => { const a0 = add([top[ia * 3], top[ia * 3 + 1], top[ia * 3 + 2], top[ib * 3], top[ib * 3 + 1], top[ib * 3 + 2], bot[ia * 3], bot[ia * 3 + 1], bot[ia * 3 + 2], bot[ib * 3], bot[ib * 3 + 1], bot[ib * 3 + 2]]); idx.push(a0, a0 + 2, a0 + 1, a0 + 1, a0 + 2, a0 + 3); };
    for (let b = 0; b < NV; b++) { rim(b * row, (b + 1) * row); rim(b * row + NU, (b + 1) * row + NU); }
    for (let a = 0; a < NU; a++) { rim(a, a + 1); rim(NV * row + a, NV * row + a + 1); }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    return new T.Mesh(geo, mat);
  }
  part((g) => {
    const pinkMat = std(0xe29aac, 0.52, 0, { side: T.DoubleSide });
    const chair = shellChair(pinkMat);
    chair.position.set(0.06, TOP + 0.66, 0.02);
    g.add(chair);
  }, [0, 2.45, -0.2]);

  // 6 PVC 기둥 + 플랜지 (은색 도색)
  const POLE = new T.Vector3(-0.86, 0, 0.86);
  part((g) => {
    const steel = std(0xd9dde2, 0.26, 0.7);
    const pole = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 1.95, 28), steel);
    pole.position.set(POLE.x, TOP + 0.975, POLE.z); g.add(pole);
    const fl = new T.Mesh(new T.CylinderGeometry(0.17, 0.18, 0.035, 36), steel);
    fl.position.set(POLE.x, TOP + 0.018, POLE.z); g.add(fl);
  }, [-1.35, 0.9, 0.5]);

  // 7 NFC 리더기 케이스
  const nfcRing = new T.MeshBasicMaterial({ color: 0xe9ecef, opacity: 0.35, toneMapped: false });
  part((g) => {
    const cs = new T.Mesh(new T.BoxGeometry(0.2, 0.3, 0.1), std(0x121418, 0.55));
    cs.position.set(POLE.x + 0.02, TOP + 1.62, POLE.z + 0.08); cs.rotation.y = 0.5; g.add(cs);
    const ring = new T.Mesh(new T.RingGeometry(0.045, 0.058, 36), nfcRing);
    ring.position.set(POLE.x + 0.046, TOP + 1.63, POLE.z + 0.125); ring.rotation.y = 0.5; g.add(ring);
  }, [-1.5, 2.3, 0.5]);

  // 8 임산부 뱃지: 둥근 흰색 iBeacon E7 (NTAG213 스티커는 뒷면에 부착)
  const badge = part((g) => {
    const white = std(0xf2f2f0, 0.5);
    const puck = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.07, 48), white);
    puck.rotation.x = Math.PI / 2; g.add(puck);
    const face = new T.Mesh(new T.CylinderGeometry(0.108, 0.108, 0.012, 48), std(0xfafafa, 0.42));
    face.rotation.x = Math.PI / 2; face.position.z = 0.038; g.add(face);
    const groove = new T.Mesh(new T.TorusGeometry(0.112, 0.0035, 8, 64, Math.PI * 1.86), std(0xd6d6d4, 0.6));
    groove.position.z = 0.044; groove.rotation.z = Math.PI * 1.07; g.add(groove);
  }, [1.6, 1.9, 0.8]);
  const BADGE_AWAY = new T.Vector3(2.6, 1.0, 2.0);
  const BADGE_NEAR = new T.Vector3(0.95, 1.0, 1.05);
  const BADGE_TAP = new T.Vector3(POLE.x + 0.13, TOP + 1.63, POLE.z + 0.28);

  const seatLight = new T.PointLight(0xff1464, 0, 1.9, 1.8);
  seatLight.position.set(0.1, TOP + 0.25, 0.35); seat.add(seatLight);

  // ═════════════ LED 80개 무리 ═════════════
  // 실제 LED 개수인 80개가 섹션마다 다른 모양으로 모입니다.
  // 대기: 흩어져 떠다님 · 접근: BLE 신호처럼 물결로 퍼짐 · 착석: ㄱ자 빛 줄 · 부품: 격자 · 구성: 신호가 흐르는 길 …
  const swarmScene = new T.Scene();
  const swarmCam = new T.PerspectiveCamera(30, 1, 0.1, 60);
  swarmCam.position.set(0, 0, 10); swarmCam.lookAt(0, 0, 0);
  const swarm = glowPoints(80, 0.34);
  swarmScene.add(swarm);
  const N = 80;
  const P = new Float32Array(N * 3), V = new Float32Array(N * 3), SEED = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    SEED[i * 3] = Math.random() - 0.5; SEED[i * 3 + 1] = Math.random() - 0.5; SEED[i * 3 + 2] = Math.random() - 0.5;
    P[i * 3] = SEED[i * 3] * 6 + 3; P[i * 3 + 1] = SEED[i * 3 + 1] * 5; P[i * 3 + 2] = SEED[i * 3 + 2] * 2;
  }
  const OUT = { x: 0, y: 0, z: 0, b: 0 };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  // 사각형(월드 단위) 둘레를 따라가는 점: ┘ 모양(아래 → 오른쪽 위)
  function alongL(s, R, m) {
    const w = R.w + m * 2, h = R.h + m * 2, L = w + h, d = s * L;
    if (d < w) return [R.x - w / 2 + d, R.y - h / 2];
    return [R.x + w / 2, R.y - h / 2 + (d - w)];
  }
  function alongRect(s, R, m) {
    const w = R.w + m * 2, h = R.h + m * 2, L = 2 * (w + h); let d = s * L;
    if (d < w) return [R.x - w / 2 + d, R.y + h / 2]; d -= w;
    if (d < h) return [R.x + w / 2, R.y + h / 2 - d]; d -= h;
    if (d < w) return [R.x + w / 2 - d, R.y - h / 2]; d -= w;
    return [R.x - w / 2, R.y - h / 2 + d];
  }
  function formTarget(form, i, t, R, fill) {
    const sx = SEED[i * 3], sy = SEED[i * 3 + 1], sz = SEED[i * 3 + 2];
    const o = OUT; o.z = 0; o.b = -1;
    switch (form) {
      case 'wave': { // BLE 광고 신호: 네 겹의 고리가 바깥으로 퍼집니다
        const k = i % 4, j = Math.floor(i / 4), a = (j / 20) * Math.PI * 2 + k * 0.4;
        const ph = (t * 0.42 + k / 4) % 1;
        const rx = R.w / 2 + 0.15 + ph * 1.25, ry = R.h / 2 + 0.15 + ph * 1.25;
        o.x = R.x + Math.cos(a) * rx; o.y = R.y + Math.sin(a) * ry; o.z = -0.4 + ph * 0.6;
        o.b = Math.pow(1 - ph, 1.6);
        break;
      }
      case 'frame': { // 바닥의 ㄱ자 조명처럼 사진 아래와 옆을 감쌉니다
        const [x, y] = alongL((i + 0.5) / N, R, 0.16);
        o.x = x; o.y = y; o.z = 0.2;
        break;
      }
      case 'border': { // 영상 자리 둘레를 도는 불빛
        const s = (i + 0.5) / N;
        const [x, y] = alongRect(s, R, 0.14);
        o.x = x; o.y = y;
        o.b = 0.12 + 0.88 * Math.pow(Math.max(0, Math.cos(Math.PI * 2 * (s * 3 - t * 0.22))), 10);
        break;
      }
      case 'grid': { // 부품 인벤토리처럼 반듯한 10 × 8 격자, 물결이 지나갑니다
        const c = i % 10, r = Math.floor(i / 10), sp = Math.min(R.w / 10, R.h / 8);
        const gx = (c - 4.5) * sp, gy = (r - 3.5) * sp, d = Math.hypot(gx, gy);
        const w = Math.sin(d * 2.4 - t * 2.2);
        o.x = R.x + gx; o.y = R.y + gy; o.z = w * 0.35;
        o.b = 0.12 + 0.88 * Math.pow((w + 1) / 2, 3);
        break;
      }
      case 'route': { // 신호가 흐르는 길
        const s = (i / N + t * 0.05) % 1;
        o.x = R.x + (s - 0.5) * R.w; o.y = R.y + Math.sin(s * Math.PI * 3 + t * 0.4) * R.h * 0.28; o.z = Math.cos(s * Math.PI * 2) * 0.4;
        o.b = 0.1 + 0.9 * Math.pow(Math.max(0, Math.sin(s * Math.PI * 10 - t * 3.2)), 6);
        break;
      }
      case 'seats': { // 웹 화면처럼 양쪽 좌석 줄, 배려석 한 자리만 켜짐
        const left = i < 40, k = i % 40;
        o.x = R.x + (left ? -1 : 1) * (R.w / 2 + 0.22); o.y = R.y - R.h / 2 + ((k + 0.5) / 40) * R.h;
        o.b = !left && k >= 5 && k <= 9 ? -1 : 0.1;
        break;
      }
      case 'bar': { // 글자 아래에 놓인 LED 한 줄 (바닥 조명처럼)
        const s = (i + 0.5) / N;
        o.x = R.x + (s - 0.5) * R.w * 1.15; o.y = R.y - R.h / 2 - 0.22; o.z = 0;
        o.b = 0.15 + 0.85 * clamp01((t - sw.changeT) * 1.2 - Math.abs(s - 0.5) * 1.6);
        break;
      }
      case 'column': { // 결과: 아래부터 차오르는 한 줄
        o.x = R.x; o.y = R.y - R.h / 2 + ((i + 0.5) / N) * R.h;
        o.b = clamp01(fill * N - i);
        break;
      }
      default: { // drift: 흩어져 떠다니다 가끔 하나씩 반짝
        o.x = R.x + sx * R.w + Math.sin(t * 0.35 + sy * 20) * 0.14;
        o.y = R.y + sy * R.h + Math.cos(t * 0.3 + sx * 20) * 0.14;
        o.z = sz * 1.6 + Math.sin(t * 0.25 + sz * 30) * 0.25;
        const tw = Math.max(0, Math.sin(t * 0.9 + sx * 90 + sy * 50));
        o.b = 0.1 + Math.pow(tw, 14) * 0.9;
      }
    }
    return o;
  }
  const sw = { form: 'none', prev: 'none', changeT: 0, R: { x: 3, y: 0, w: 2, h: 3 }, prevR: { x: 3, y: 0, w: 2, h: 3 } };
  let mouseX = 0, mouseY = 0;
  window.addEventListener('pointermove', (e) => { mouseX = e.clientX / window.innerWidth - 0.5; mouseY = e.clientY / window.innerHeight - 0.5; }, { passive: true });

  // ═════════════ 상태 · 목표값 ═════════════
  const target = {
    modelVis: 1, ribbonVis: 0, explode: 1, focus: -1, view: 0, // view 0 = 첫 화면, 1 = 조립
    modelLed: 'idle', ribbonLed: 'idle', fill: 0, badge: 0, // badge 0 멀리, 1 가까이, 2 NFC 태그
    ledTest: 0, ribbonDim: 1,
    form: 'none', formRect: { cx: 0.8, cy: 0.5, w: 0.2, h: 0.5 },
  };
  const cur = { modelVis: 1, ribbonVis: 0, explode: 1, view: 0, badge: 0, modelLevel: 0, ribbonLevel: 0, ledTest: 0, ribbonDim: 1, fill: 0 };
  const since = { modelLed: 0, ribbonLed: 0 };
  let lastModelLed = 'idle', lastRibbonLed = 'idle';
  let scrollY = 0;

  function ledLevel(state, dt) {
    switch (state) {
      case 'approach': return Math.floor(dt / 0.5) % 2 === 0 ? 1 : 0.04;
      case 'seated': return 1;
      case 'exit': return dt < 3 ? (Math.floor(dt / 0.5) % 2 === 0 ? 1 : 0.04) : 0;
      default: return 0;
    }
  }
  const approach = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

  // ═════════════ 레이아웃 ═════════════
  let W = 1, H = 1, visW = 10, mobile = false;
  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    swarmCam.aspect = W / H; swarmCam.updateProjectionMatrix();
    mobile = W < 720 || (W < 1080 && H > W); // 휴대폰과 세로 태블릿은 모형을 위쪽에 둡니다
    visW = 2 * Math.tan((camera.fov * Math.PI) / 360) * 8 * camera.aspect;
  }
  window.addEventListener('resize', resize);
  resize();

  const camHero = { pos: new T.Vector3(0, 2.2, 7.4), look: new T.Vector3(0, 0.62, 0) };
  const camAsm = { pos: new T.Vector3(0, 3.0, 10.4), look: new T.Vector3(0, 0.95, 0) };
  const camPos = new T.Vector3(), camLook = new T.Vector3();

  // ═════════════ 렌더 루프 ═════════════
  const clock = new T.Clock();
  let elapsed = 0;
  // 숨겨진 탭에서는 브라우저가 requestAnimationFrame을 알아서 멈춥니다
  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += reduce ? 0 : dt;
    const t = elapsed;

    if (target.modelLed !== lastModelLed) { since.modelLed = t; lastModelLed = target.modelLed; }
    if (target.ribbonLed !== lastRibbonLed) { since.ribbonLed = t; lastRibbonLed = target.ribbonLed; }

    cur.modelVis = approach(cur.modelVis, target.modelVis, 5, dt);
    cur.ribbonVis = approach(cur.ribbonVis, target.ribbonVis, 3.5, dt);
    cur.explode = approach(cur.explode, target.explode, 7, dt);
    cur.view = approach(cur.view, target.view, 3, dt);
    cur.badge = approach(cur.badge, target.badge, 3.2, dt);
    cur.ledTest = approach(cur.ledTest, target.ledTest, 6, dt);
    cur.ribbonDim = approach(cur.ribbonDim, target.ribbonDim, 3, dt);
    cur.fill = approach(cur.fill, target.fill, 4, dt);
    // 빛은 순간이동하지 않습니다: 켜질 때 빠르게, 꺼질 때 조금 느리게
    const mT = ledLevel(target.modelLed, t - since.modelLed);
    cur.modelLevel = approach(cur.modelLevel, mT, mT > cur.modelLevel ? 28 : 14, dt);
    const rT = ledLevel(target.ribbonLed, t - since.ribbonLed);
    cur.ribbonLevel = approach(cur.ribbonLevel, rT, rT > cur.ribbonLevel ? 22 : 10, dt);

    // 카메라
    camPos.copy(camHero.pos).lerp(camAsm.pos, cur.view);
    camLook.copy(camHero.look).lerp(camAsm.look, cur.view);
    if (mobile) { camPos.multiplyScalar(1.28); camPos.y += 0.5; }
    camera.position.copy(camPos); camera.lookAt(camLook);

    // ── 배려석 모듈 ──
    const mv = cur.modelVis;
    seat.visible = mv > 0.01;
    if (seat.visible) {
      const sx = mobile ? 0 : visW * (0.2 - cur.view * 0.04);
      seat.position.set(sx, mobile ? 1.62 - cur.view * 1.2 : 0, 0);
      const ms = mobile ? 0.64 + cur.view * 0.36 : 1;
      seat.scale.set(ms, ms, ms);
      seat.rotation.y = -0.55 + (reduce ? 0 : Math.sin(t * 0.18) * 0.32) + cur.view * 0.12;
      const e = cur.explode; // 0 = 흩어짐, 1 = 조립 완료
      const n = parts.length;
      parts.forEach((p, i) => {
        // 부품 i는 e가 i/n → (i+1)/n 구간에서 제자리로 들어옵니다
        const k = Math.max(0, Math.min(1, e * n - i));
        const ease = 1 - Math.pow(1 - k, 3);
        p.group.position.copy(p.ex).multiplyScalar(1 - ease);
        if (i === 8) {
          // 뱃지는 조립이 끝난 뒤 badge 값에 따라 움직입니다
          const b = cur.badge;
          const bp = b < 1 ? BADGE_AWAY.clone().lerp(BADGE_NEAR, b) : BADGE_NEAR.clone().lerp(BADGE_TAP, b - 1);
          p.group.position.copy(bp).add(p.ex.clone().multiplyScalar(1 - ease));
          p.group.rotation.set(0, 0.5, 0);
          if (!reduce) p.group.position.y += Math.sin(t * 1.6) * 0.03 * (b < 1.9 ? 1 : 0);
        }
        const placed = k >= 0.999;
        const focus = target.focus;
        let a = placed ? 1 : 0.22 + 0.78 * ease;
        if (focus >= 0 && i === focus) a = Math.max(a, 0.9);
        if (focus >= 0 && i > focus + 1) a = 0.12;
        p.alpha = approach(p.alpha, a, 8, dt);
        p.mats.forEach((m) => { m.opacity = m.userData.base * p.alpha * mv; });
      });
      // 바닥 LED
      const lvl = Math.max(cur.modelLevel, 0);
      // 점검 중에는 빛이 지나간 구간만 켜집니다 (앞 40개 = 가로, 뒤 40개 = 세로)
      const head = cur.ledTest * 80;
      const aLit = Math.max(lvl, Math.min(1, head / 40)), bLit = Math.max(lvl, Math.min(1, (head - 40) / 40));
      diffA.color.copy(DIFF_OFF).lerp(DIFF_ON, aLit); diffA.emissiveIntensity = aLit * 1.6;
      diffB.color.copy(DIFF_OFF).lerp(DIFF_ON, Math.max(0, bLit)); diffB.emissiveIntensity = Math.max(0, bLit) * 1.6;
      seatLight.intensity = Math.max(lvl, cur.ledTest) * 1.3 * mv;
      nfcRing.color.setRGB(1, 1, 1).lerp(PINK, target.badge >= 1.9 ? 1 : 0);
      nfcRing.opacity = (0.35 + (target.badge >= 1.9 ? 0.6 : 0)) * mv;
      const col = seatLeds.geometry.attributes.color;
      for (let i = 0; i < 80; i++) {
        let v = lvl;
        if (cur.ledTest > 0.001) v = Math.max(v, Math.max(0, Math.min(1, head - i))); // 한 칸씩 차오름
        v *= mv;
        col.setXYZ(i, v, v * 0.08, v * 0.4);
      }
      col.needsUpdate = true;
      seatLeds.material.size = mobile ? 0.4 : 0.32;
    }

    // ── LED 80개 무리 ──
    const rv = cur.ribbonVis * cur.ribbonDim;
    swarm.visible = rv > 0.005;
    if (swarm.visible) {
      const sH = 2 * Math.tan((swarmCam.fov * Math.PI) / 360) * 10, sW = sH * swarmCam.aspect;
      const fr = target.formRect;
      const R = { x: (fr.cx - 0.5) * sW, y: (0.5 - fr.cy) * sH, w: fr.w * sW, h: fr.h * sH };
      if (target.form !== sw.form) { sw.prev = sw.form; sw.prevR = sw.R; sw.form = target.form; sw.changeT = t; }
      sw.R = R;
      const pos = swarm.geometry.attributes.position, col = swarm.geometry.attributes.color;
      const lvl = cur.ribbonLevel;
      for (let i = 0; i < N; i++) {
        // 모양이 바뀔 때 한꺼번에가 아니라 차례로 출발합니다
        const late = t < sw.changeT + (i % 40) * 0.012;
        const f = late && sw.prev !== 'none' ? sw.prev : sw.form;
        const o = formTarget(f === 'none' ? 'drift' : f, i, t, late ? sw.prevR : R, cur.fill);
        const k = 16 + (i % 7) * 2.2, c = 6.5, i3 = i * 3;
        V[i3] += ((o.x - P[i3]) * k - V[i3] * c) * dt;
        V[i3 + 1] += ((o.y - P[i3 + 1]) * k - V[i3 + 1] * c) * dt;
        V[i3 + 2] += ((o.z - P[i3 + 2]) * k - V[i3 + 2] * c) * dt;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        pos.setXYZ(i, P[i3], P[i3 + 1], P[i3 + 2]);
        const b = (o.b < 0 ? lvl : o.b) * rv;
        const off = 0.05 * rv;
        col.setXYZ(i, off + b, off + b * 0.08, off + b * 0.4);
      }
      pos.needsUpdate = true; col.needsUpdate = true;
      swarm.position.set(reduce ? 0 : mouseX * 0.18, reduce ? 0 : -mouseY * 0.12, 0);
      swarm.material.size = mobile ? 0.28 : 0.34;
    }

    renderer.clear();
    renderer.render(scene, camera);
    if (swarm.visible) { renderer.clearDepth(); renderer.render(swarmScene, swarmCam); }
    requestAnimationFrame(loop);
  }
  loop();
  window.PP3SScene = {
    target,
    setScroll(y) { scrollY = y; },
    get levels() { return { model: cur.modelLevel, ribbon: cur.ribbonLevel }; },
  };
})();
