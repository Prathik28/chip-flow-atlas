/* =====================================================================================
   Learn STA: Static Timing Analysis from zero to advanced, with animated visuals.
   All timing maths lives in STA_CALC (tested by scripts/check-sta.mjs). Times are in ns.
   CSS classes used inside the drawings all start with "sx-" so they can't clash with the site.
   ===================================================================================== */
(() => {   // keeps every name in this file private, except the STA_* values shared at the end

const STA_CALC = {
  // setup: data must ARRIVE before the next capture edge, minus the setup time
  setup({ T, tcq, comb, tsu, skew = 0, unc = 0 }) {
    const arrival = tcq + comb, required = T + skew - tsu - unc;
    return { arrival, required, slack: required - arrival };
  },
  // hold: new data must NOT arrive until the same capture edge is safely past
  hold({ tcqMin, combMin, th, skew = 0, unc = 0 }) {
    const arrival = tcqMin + combMin, required = th + skew + unc;
    return { arrival, required, slack: arrival - required };
  },
  minPeriod({ tcq, comb, tsu, skew = 0, unc = 0 }) { return tcq + comb + tsu + unc - skew; },
  fmaxMHz(periodNs) { return 1000 / periodNs; },
  // is a data change at 'dt' (relative to the clock edge) inside the forbidden window?
  window(dt, tsu, th) {
    if (dt <= -tsu + 1e-9) return 'new';        // arrived early enough: the new value is captured
    if (dt >= th - 1e-9) return 'old';          // changed late enough: the old value is captured
    return 'bad';                               // changed inside the window
  },
  // multicycle paths: which clock edges are used for the two checks
  mcpEdges(mode, T) {
    if (mode === 'one') return { setupEdge: T, holdEdge: 0 };
    if (mode === 'setup2') return { setupEdge: 2 * T, holdEdge: T };   // hold follows setup!
    return { setupEdge: 2 * T, holdEdge: 0 };                          // -setup 2 and -hold 1
  },
  // on-chip variation: launch + data made LATE, capture clock made EARLY
  ocvSetup({ T, common, branchL, branchC, data, tsu, late, early, crpr }) {
    const arrival = (common + branchL) * late + data * late;
    const credit = crpr ? common * (late - early) : 0;
    const required = T + (common + branchC) * early - tsu + credit;
    return { arrival, required, credit, slack: required - arrival };
  },
  borrow({ tcq, comb, tsu, opens, closes }) {
    // data leaves a flip-flop at 0, passes a latch that is transparent from 'opens' to 'closes',
    // and is captured by a flip-flop at 'closes'
    const arrival = tcq + comb;
    const borrowed = Math.max(0, arrival - opens), ok = arrival <= closes - tsu + 1e-9;
    return { arrival, borrowed, ok, nextStageTime: closes - Math.max(arrival, opens) };
  },
  // ---- delay models (simplified, for teaching) ----
  cellDelay({ intrinsic, load, slew, kLoad = 0.08, kSlew = 0.2 }) {
    return { intrinsic, fromLoad: kLoad * load, fromSlew: kSlew * slew, total: intrinsic + kLoad * load + kSlew * slew };
  },
  // Elmore delay of an evenly spread RC wire driving a load: R x (C/2 + CL).  kOhm x pF = ns
  elmore({ R, C: Cw, CL }) { return R * (Cw / 2 + CL); },
  wire({ len, repeater, rPerMm = 0.5, cPerMm = 0.2, CL = 0.05, repDelay = 0.05 }) {
    const piece = l => STA_CALC.elmore({ R: rPerMm * l, C: cPerMm * l, CL });
    return repeater ? 2 * piece(len / 2) + repDelay : piece(len);
  },
  // crosstalk: a share 'coupling' of the victim's capacitance goes to the neighbour. It counts twice if the
  // neighbour moves the opposite way, not at all if it moves the same way, and once if it is quiet
  crosstalk({ base, coupling, neighbour, overlap }) {
    const k = !overlap ? 1 : neighbour === 'opposite' ? 2 : neighbour === 'same' ? 0 : 1;
    const delay = base * ((1 - coupling) + k * coupling);
    return { delay, delta: delay - base };
  },
  // ---- more timing equations ----
  // set_output_delay values: what the outside world needs after the output port
  outputDelay({ tsu = 0, th = 0, wireMax = 0, wireMin = 0 }) { return { max: wireMax + tsu, min: wireMin - th }; },
  inputPath({ T, idly, comb, tsu, unc = 0, skew = 0 }) {
    const arrival = idly + comb, required = T + skew - tsu - unc;
    return { arrival, required, slack: required - arrival };
  },
  outputPath({ T, tcq, comb, odly, unc = 0 }) {
    const arrival = tcq + comb + odly, required = T - unc;
    return { arrival, required, slack: required - arrival };
  },
  // launched on the rising edge, captured on the next falling edge (50% duty cycle)
  halfCycle({ T, tcq, comb, tsu, tcqMin, combMin, th, skew = 0, unc = 0 }) {
    return {
      setup: T / 2 + skew - tsu - unc - (tcq + comb),
      hold: (tcqMin + combMin) - (-T / 2 + th + skew + unc),
      minPeriod: 2 * (tcq + comb + tsu + unc - skew)
    };
  },
  multicycle({ T, N, holdFixed, tcq, comb, tsu, tcqMin, combMin, th, skew = 0, unc = 0 }) {
    const holdEdge = holdFixed ? 0 : (N - 1) * T;
    return { setup: N * T + skew - tsu - unc - (tcq + comb), hold: (tcqMin + combMin) - (holdEdge + th + skew + unc), holdEdge };
  },
  recovery({ T, rpath, trec, skew = 0, unc = 0 }) { return T + skew - trec - unc - rpath; },
  removal({ rpathMin, trem, skew = 0, unc = 0 }) { return rpathMin - (trem + skew + unc); },
  wnsTns(slacks) {
    const failing = slacks.filter(s => s < -1e-9);
    return { worst: Math.min(...slacks), wns: failing.length ? Math.min(...failing) : 0, tns: failing.reduce((a, b) => a + b, 0), failing: failing.length };
  },
  maxBorrow({ open, tsu, unc = 0 }) { return open - tsu - unc; },
  fixes({ T, tcq, comb, tsu, tcqMin, combMin, th, skew, on }) {
    let c = comb, cmin = combMin, per = T, sk = skew;
    if (on.cells) c *= 0.85;
    if (on.logic) c -= 2;
    if (on.pipe) c /= 2;
    if (on.skew) sk += 1;
    if (on.slow) per += 4;
    if (on.buf) cmin += 0.4;
    return {
      setup: STA_CALC.setup({ T: per, tcq, comb: c, tsu, skew: sk }),
      hold: STA_CALC.hold({ tcqMin, combMin: cmin, th, skew: sk }), T: per, comb: c, combMin: cmin, skew: sk
    };
  }
};

/* ---------- drawing helpers (return SVG text) ---------- */
const sn = v => String(Math.round(v * 100) / 100);
const sx = {
  svg: (h, body, w = 640) => `<svg viewBox="0 0 ${w} ${h}" role="img" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
  t: (x, y, s, cls = '', anchor = 'start') => `<text x="${x}" y="${y}" class="sx-t ${cls}" text-anchor="${anchor}">${s}</text>`,
  rect: (x, y, w, h, cls, r = 8) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${h}" rx="${r}" class="${cls}"/>`,
  path: (d, cls) => `<path d="${d}" class="${cls}"/>`,
  line: (x1, y1, x2, y2, cls) => `<path d="M${x1} ${y1}L${x2} ${y2}" class="${cls}"/>`,
  dot: (x, y, cls, r = 8) => `<circle cx="${x}" cy="${y}" r="${r}" class="${cls}"/>`,
  // a flip-flop box with D, Q and the clock triangle
  ff: (x, y, name, lit) => sx.rect(x, y, 62, 74, 'sx-ff' + (lit ? ' sx-lit' : ''))
    + sx.t(x + 8, y + 24, 'D', 'sx-b') + sx.t(x + 54, y + 24, 'Q', 'sx-b', 'end')
    + sx.path(`M${x + 22} ${y + 74}L${x + 31} ${y + 62}L${x + 40} ${y + 74}`, 'sx-wire')
    + sx.t(x + 31, y - 8, name, 'sx-b', 'middle'),
  cloud: (x, y, w, h, label, lit) => sx.rect(x, y, w, h, 'sx-logic' + (lit ? ' sx-lit' : ''), h / 2) + sx.t(x + w / 2, y + h / 2 + 5, label, 'sx-b', 'middle'),
  // a clock wave with rising edges at off, off+T, ... ; X maps time to pixels
  clock(X, y, T, off, tmax, cls = 'sx-clk') {
    let d = `M${X(0)} ${y}`;
    for (let e = off; e <= tmax; e += T) {
      if (e < 0) continue;
      const fall = Math.min(e + T / 2, tmax);
      d += `L${X(e)} ${y}L${X(e)} ${y - 26}L${X(fall)} ${y - 26}`;
      if (e + T / 2 <= tmax) d += `L${X(fall)} ${y}`;
    }
    if (!/L[\d.]+ [\d.]+$/.test(d) || d.endsWith(` ${y}`)) d += `L${X(tmax)} ${y}`;
    return sx.path(d, cls);
  },
  // a one-bit signal: starts at v0 and flips at each time in 'flips'
  sig(X, y, v0, flips, tmax, cls = 'sx-sig') {
    let v = v0, d = `M${X(0)} ${v ? y - 26 : y}`;
    for (const f of flips) {
      if (f > tmax) break;
      d += `L${X(f)} ${v ? y - 26 : y}`; v = v ? 0 : 1; d += `L${X(f)} ${v ? y - 26 : y}`;
    }
    return sx.path(d + `L${X(tmax)} ${v ? y - 26 : y}`, cls);
  },
  cursor: (x, y1, y2) => sx.line(x, y1, x, y2, 'sx-cur'),
  // light dotted time guides: 'a' (blue) marks clock edges, 'b' (purple) marks the moment a signal changes
  guides: (X, times, y1, y2, kind) => times.map(v => sx.line(X(v), y1, X(v), y2, 'sx-grid-' + kind)).join(''),
  key(y, items) {
    const width = items.map(i => i[1].length * 6.7 + 46);
    let x = Math.max(8, (640 - width.reduce((a, b) => a + b, 0)) / 2);
    return items.map((it, n) => { const out = sx.line(x, y - 11, x, y + 4, 'sx-grid-' + it[0]) + sx.t(x + 8, y, it[1], 'sx-s'); x += width[n]; return out; }).join('');
  },
  // a labelled bar on a timeline
  bar(X, from, to, y, cls, label, h = 26) {
    const a = X(Math.min(from, to)), w = Math.abs(X(to) - X(from));
    return sx.rect(a, y, w, h, cls, 5) + (w > 30 ? sx.t(a + w / 2, y + h / 2 + 5, label, 'sx-s sx-b', 'middle') : '');
  },
  axis(X, y, tmax, step) {
    let s = sx.line(X(0), y, X(tmax), y, 'sx-axis');
    for (let v = 0; v <= tmax + 1e-9; v += step) s += sx.line(X(v), y - 4, X(v), y + 4, 'sx-axis') + sx.t(X(v), y + 18, sn(v), 'sx-s', 'middle');
    return s + sx.t(X(tmax) + 8, y + 5, 'ns', 'sx-s');
  },
  // move along a polyline: p from 0 to 1
  along(pts, p) {
    const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
    let d = Math.max(0, Math.min(1, p)) * seg.reduce((a, b) => a + b, 0);
    for (let i = 0; i < seg.length; i++) {
      if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? Math.min(1, d / seg[i]) : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k]; }
      d -= seg[i];
    }
    return pts[0];
  },
  poly: (pts, cls) => sx.path('M' + pts.map(p => p.join(' ')).join('L'), cls)
};
const R = (k, label, min, max, step, def, unit = 'ns') => ({ k, label, min, max, step, def, unit });
const verdict = (ok, text) => ({ ok, text });

const STA_LESSONS = [];
const lesson = l => STA_LESSONS.push(l);

/* ================================ LEVEL 1: FOUNDATIONS ================================ */
lesson({
  id: 'race', group: '1 · Foundations', icon: '🏁', title: 'Timing is a race',
  idea: 'On every clock tick, data leaves one flip-flop and must reach the next one before the following tick.',
  params: [R('T', 'Clock period', 4, 16, 0.5, 10), R('logic', 'Logic delay', 1, 14, 0.5, 6)],
  dur: p => Math.max(p.T, p.logic + 1) + 1.5,
  result(p) {
    const need = 1 + p.logic + 1;
    return need <= p.T ? verdict(true, `Data wins the race with ${sn(p.T - need)} ns to spare.`)
      : verdict(false, `Data is ${sn(need - p.T)} ns too late. The chip would capture a wrong value.`);
  },
  say(t, p) {
    if (t < 1) return 'Tick! The launch flip-flop sends the data out (this takes 1 ns).';
    if (t < 1 + p.logic) return 'The data is travelling through the logic gates…';
    if (t < p.T) return 'Data has arrived and is waiting at the capture flip-flop. It needs to be there 1 ns early.';
    return 'Tick! The capture flip-flop takes whatever is at its input right now.';
  },
  draw(t, p) {
    const ok = 1 + p.logic + 1 <= p.T, tmax = this.dur(p), X = v => 40 + v * (550 / tmax);
    const travel = (t - 1) / p.logic;
    const pos = t < 1 ? [112, 72] : sx.along([[112, 72], [210, 72], [430, 72], [528, 72]], travel);
    let s = sx.ff(50, 48, 'Launch FF', t < 1) + sx.ff(528, 48, 'Capture FF', t >= p.T)
      + sx.line(112, 72, 528, 72, 'sx-wire') + sx.cloud(210, 42, 220, 60, `logic: ${sn(p.logic)} ns`, t >= 1 && travel < 1)
      + sx.dot(pos[0], pos[1], t >= p.T && !ok ? 'sx-dot sx-bad' : 'sx-dot', 11);
    s += sx.t(6, 192, 'CLK', 'sx-b') + sx.clock(X, 200, p.T, 0.001, tmax) + sx.axis(X, 226, tmax, tmax > 14 ? 2 : 1);
    s += sx.t(X(p.T), 136, 'next tick', 'sx-s sx-b', 'middle');
    s += sx.bar(X, 0, 1, 250, 'sx-bar-q', 'FF') + sx.bar(X, 1, 1 + p.logic, 250, 'sx-bar-logic', 'logic')
      + sx.bar(X, 1 + p.logic, 2 + p.logic, 250, ok ? 'sx-bar-su' : 'sx-bar-bad', 'setup');
    const guides = sx.guides(X, [0, p.T], 142, 280, 'a') + sx.guides(X, [1, 1 + p.logic], 142, 280, 'b');
    return sx.svg(316, guides + s + sx.cursor(X(t), 140, 280) + sx.key(305, [['a', 'clock edge'], ['b', 'data leaves FF / arrives']]));
  },
  points: ['A <b>flip-flop</b> is a 1-bit memory. It only looks at its input at the moment the clock ticks.',
    'Between two flip-flops sits <b>logic</b> (gates). Signals need time to get through it.',
    '<b>STA</b> checks this race for every path in the chip, using delay numbers, <i>without running any test patterns</i>.'],
  remember: 'Every tick starts a race. The data must finish before the next tick.',
  quiz: { q: 'The logic is too slow for the clock. Which change fixes it without touching the logic?', options: ['Use a longer clock period', 'Use a shorter clock period', 'Add more gates'], answer: 0, why: 'A longer period gives the data more time to arrive. It also means a slower chip.' }
});

lesson({
  id: 'flipflop', group: '1 · Foundations', icon: '⏱️', title: 'Clock and flip-flop',
  idea: 'A D flip-flop copies D to Q only on the rising clock edge, and Q changes a little later.',
  params: [R('tcq', 'Clock-to-Q delay', 0.2, 3, 0.1, 1)],
  dur: () => 40,
  D: { start: 0, flips: [3, 12.5, 22, 31] },
  value(time) { return (this.D.start + this.D.flips.filter(f => f <= time).length) % 2; },
  qFlips(tcq) {
    let q = 0; const out = [];
    for (const e of [5, 15, 25, 35]) { const d = this.value(e); if (d !== q) { out.push(e + tcq); q = d; } }
    return out;
  },
  result: p => verdict(true, `Q follows D only at clock edges, ${sn(p.tcq)} ns after each edge. This delay is called tcq.`),
  say(t) {
    const edge = [5, 15, 25, 35].find(e => t >= e - 0.4 && t <= e + 2.5);
    return edge !== undefined ? `Rising edge at ${edge} ns: the flip-flop samples D = ${this.value(edge)}.` : 'Between edges, D can wiggle as much as it likes. Q does not care.';
  },
  draw(t, p) {
    const X = v => 66 + v * 13.6;
    let s = sx.t(12, 52, 'CLK', 'sx-b') + sx.clock(X, 60, 10, 5, 40) + sx.t(12, 122, 'D', 'sx-b') + sx.sig(X, 130, 0, this.D.flips, 40)
      + sx.t(12, 192, 'Q', 'sx-b') + sx.sig(X, 200, 0, this.qFlips(p.tcq), 40, 'sx-sig sx-q');
    for (const e of [5, 15, 25, 35]) {
      if (t >= e) s += sx.dot(X(e), 130 - (this.value(e) ? 26 : 0), 'sx-sample', 7) + sx.t(X(e), 18, `sample ${this.value(e)}`, 'sx-s sx-b', 'middle');
    }
    s += sx.axis(X, 224, 40, 5) + sx.rect(X(t), 24, 640 - X(t), 197, 'sx-veil', 0) + sx.cursor(X(t), 24, 218);
    const guides = sx.guides(X, [5, 15, 25, 35], 24, 224, 'a') + sx.guides(X, [...this.D.flips, ...this.qFlips(p.tcq)], 24, 224, 'b');
    return sx.svg(278, guides + s + sx.key(267, [['a', 'rising clock edge'], ['b', 'D or Q changes']]));
  },
  points: ['The <b>clock</b> is a steady square wave. Its <b>period</b> is the time from one rising edge to the next.',
    'Frequency = 1 ÷ period. A 10 ns period is 100 MHz.',
    '<b>tcq (clock-to-Q)</b> is the time the flip-flop needs to put the captured value on Q.',
    'Watch D change at 12.5 ns: Q only reacts after the next edge at 15 ns.'],
  remember: 'A flip-flop is a camera: it takes one photo per clock edge, and the photo appears on Q a moment later.',
  quiz: { q: 'A clock has a period of 4 ns. What is its frequency?', options: ['400 MHz', '250 MHz', '40 MHz'], answer: 1, why: '1 ÷ 4 ns = 0.25 GHz = 250 MHz.' }
});

lesson({
  id: 'setup-hold', group: '1 · Foundations', icon: '📸', title: 'Setup and hold time',
  idea: 'D must stay still in a small window around the clock edge: setup time before it, hold time after it.',
  params: [R('dt', 'When D changes (0 = clock edge)', -4, 4, 0.1, -3), R('tsu', 'Setup time', 0.5, 2.5, 0.1, 1.5), R('th', 'Hold time', 0.2, 2, 0.1, 1)],
  dur: () => 10,
  result(p) {
    const w = STA_CALC.window(p.dt, p.tsu, p.th);
    if (w === 'new') return verdict(true, `Safe. D changed ${sn(-p.dt)} ns before the edge (needs at least ${sn(p.tsu)}). Q takes the NEW value.`);
    if (w === 'old') return verdict(true, `Safe. D changed ${sn(p.dt)} ns after the edge (needs at least ${sn(p.th)}). Q keeps the OLD value.`);
    return verdict(false, p.dt < 0 ? 'SETUP violation: D changed too close before the edge. Q may become metastable.' : 'HOLD violation: D changed too soon after the edge. Q may become metastable.');
  },
  say(t, p) {
    if (t < 5) return 'The clock edge is coming. Drag the first slider to move the moment when D changes.';
    return STA_CALC.window(p.dt, p.tsu, p.th) === 'bad' ? 'The flip-flop looked while D was changing: Q wobbles and may settle to either value.' : 'The edge has passed and Q has a clean value.';
  },
  draw(t, p) {
    const X = v => 90 + v * 52, edge = 5, at = edge + p.dt, w = STA_CALC.window(p.dt, p.tsu, p.th), bad = w === 'bad';
    let s = sx.rect(X(edge - p.tsu), 26, p.tsu * 52, 214, 'sx-win-su', 0) + sx.rect(X(edge), 26, p.th * 52, 214, 'sx-win-h', 0)
      + sx.t(X(edge - p.tsu / 2), 20, 'setup', 'sx-s sx-b', 'middle') + sx.t(X(edge + p.th / 2), 20, 'hold', 'sx-s sx-b', 'middle')
      + sx.t(14, 72, 'CLK', 'sx-b') + sx.clock(X, 80, 20, edge, 10)
      + sx.t(14, 142, 'D', 'sx-b') + sx.sig(X, 150, 0, [Math.max(0.05, at)], 10, bad ? 'sx-sig sx-bad' : 'sx-sig')
      + sx.t(X(at), 168, 'D changes', 'sx-s sx-b', 'middle') + sx.t(14, 212, 'Q', 'sx-b');
    const qAt = edge + 0.7;
    if (!bad) s += sx.sig(X, 220, 0, w === 'new' ? [qAt] : [], 10, 'sx-sig sx-q');
    else {
      let d = `M${X(0)} 220L${X(qAt)} 220`;
      for (let i = 0; i <= 40; i++) { const u = qAt + i * 0.07; d += `L${X(u)} ${207 + Math.sin(i * 1.4 + t * 9) * 13 * Math.max(0, 1 - i / 46)}`; }
      s += sx.path(d + `L${X(10)} 207`, 'sx-meta') + sx.t(X(8.4), 188, '??? metastable', 'sx-s sx-bad-t', 'middle');
    }
    const guides = sx.guides(X, [edge], 28, 240, 'a') + sx.guides(X, bad ? [at] : [at, qAt], 28, 240, 'b');
    return sx.svg(284, guides + s + sx.rect(X(t), 26, 640 - X(t), 214, 'sx-veil', 0) + sx.cursor(X(t), 26, 240) + sx.key(270, [['a', 'clock edge'], ['b', bad ? 'D changes' : 'D or Q changes']]));
  },
  points: ['<b>Setup time (tsu)</b>: D must be stable this long <b>before</b> the edge.',
    '<b>Hold time (th)</b>: D must stay stable this long <b>after</b> the edge.',
    'Break either one and the flip-flop can become <b>metastable</b>: stuck between 0 and 1 for an unpredictable time.',
    'Setup and hold are properties of the flip-flop, given in the cell library.'],
  remember: 'Photo rule: hold still BEFORE the click (setup) and just AFTER it (hold), or the picture blurs.',
  quiz: { q: 'Setup time is 1.5 ns. D changes 1 ns before the clock edge. What is this?', options: ['Safe', 'A setup violation', 'A hold violation'], answer: 1, why: 'D needed to be stable 1.5 ns before the edge, but it only was for 1 ns.' }
});

lesson({
  id: 'paths', group: '1 · Foundations', icon: '🗺️', title: 'The four timing paths',
  idea: 'STA cuts the whole chip into paths. Each path has a start point and an end point.',
  options: [{ k: 'kind', label: 'Path type', def: 'rr', choices: [['rr', 'Register → register'], ['ir', 'Input → register'], ['ro', 'Register → output'], ['io', 'Input → output']] }],
  params: [], dur: () => 6,
  info: {
    rr: ['Clock pin of FF 1', 'D pin of FF 2', 'The most common path. The clock period must fit it.'],
    ir: ['Input port', 'D pin of FF 1', 'Needs set_input_delay: how late does the outside world deliver the data?'],
    ro: ['Clock pin of FF 2', 'Output port', 'Needs set_output_delay: how much time does the outside world need?'],
    io: ['Input port', 'Output port', 'Pure combinational path through the chip. Constrain with set_max_delay or virtual clocks.']
  },
  result(p) { const i = this.info[p.kind]; return verdict(true, `Start point: ${i[0]}  →  End point: ${i[1]}. ${i[2]}`); },
  say: () => 'Pick a path type and watch the signal travel from its start point to its end point.',
  draw(t, p) {
    const routes = { ir: [[26, 110], [190, 110]], rr: [[221, 150], [221, 110], [252, 110], [390, 110]], ro: [[421, 150], [421, 110], [452, 110], [614, 110]], io: [[26, 110], [50, 110], [50, 200], [590, 200], [590, 110], [614, 110]] };
    let s = sx.rect(60, 20, 520, 208, 'sx-chip', 18) + sx.t(76, 44, 'CHIP', 'sx-b');
    s += sx.line(26, 110, 190, 110, 'sx-wire') + sx.line(252, 110, 390, 110, 'sx-wire') + sx.line(452, 110, 614, 110, 'sx-wire') + sx.poly(routes.io, 'sx-wire');
    s += sx.poly(routes[p.kind], 'sx-route');
    s += sx.cloud(90, 86, 76, 48, 'logic') + sx.ff(190, 86, 'FF 1') + sx.cloud(282, 86, 78, 48, 'logic') + sx.ff(390, 86, 'FF 2') + sx.cloud(486, 86, 76, 48, 'logic') + sx.cloud(260, 178, 120, 44, 'logic');
    s += sx.dot(26, 110, 'sx-port', 9) + sx.t(26, 92, 'IN', 'sx-s sx-b', 'middle') + sx.dot(614, 110, 'sx-port', 9) + sx.t(614, 92, 'OUT', 'sx-s sx-b', 'middle');
    s += sx.line(100, 250, 421, 250, 'sx-clk') + sx.line(221, 250, 221, 160, 'sx-clk') + sx.line(421, 250, 421, 160, 'sx-clk') + sx.t(76, 255, 'CLK', 'sx-s sx-b');
    const pos = sx.along(routes[p.kind], (t / 5) % 1.2);
    return sx.svg(270, s + sx.dot(pos[0], pos[1], 'sx-dot', 10));
  },
  points: ['<b>Start points</b>: input ports and the <b>clock pins</b> of flip-flops.',
    '<b>End points</b>: output ports and the <b>data pins</b> of flip-flops.',
    'STA checks every <b>constrained</b> end point without needing test patterns. A path with no constraint, or one excluded by an exception, is <b>not</b> checked.'],
  remember: 'Paths start at an input or a clock pin, and end at a D pin or an output.',
  quiz: { q: 'Where does a register-to-register path start?', options: ['At the D pin of the first flip-flop', 'At the clock pin of the first flip-flop', 'At the Q pin of the second flip-flop'], answer: 1, why: 'The clock edge at the first flip-flop is what launches the data.' }
});

/* ============================ LEVEL 2: DELAYS, ONE BY ONE ============================ */
// Every lesson here is told in numbered steps. Time t runs from 0 to the number of steps:
// step k plays while t goes from k to k+1, and ph(t, k) is how far that step has got (0 to 1).
const DELAY_GROUP = '2 · Delays, one by one';
const ph = (t, k) => Math.max(0, Math.min(1, t - k));
const delayLesson = l => lesson({
  group: DELAY_GROUP, ...l,
  dur(p) { return this.steps(p).length; },
  say(t, p) { const s = this.steps(p), k = Math.min(s.length - 1, Math.floor(t)); return `Step ${k + 1} of ${s.length}: ${s[k]}`; }
});
// a voltage wave: f(time) gives 0 (low) to 1 (high); drawn from time 0 up to 'upto'
const wave = (X, base, height, f, tmax, cls, upto = tmax) => {
  const end = Math.max(0, Math.min(tmax, upto)), pts = [];
  for (let i = 0; i <= 160; i++) { const u = end * i / 160; pts.push(`${Math.round(X(u) * 10) / 10} ${Math.round((base - height * f(u)) * 10) / 10}`); }
  return sx.path('M' + pts.join('L'), cls);
};
const rampUp = (mid, full) => u => Math.max(0, Math.min(1, (u - mid) / full + 0.5));
// a measuring bracket between two x positions
const span = (a, b, y, cls) => sx.line(a, y, b, y, cls) + sx.line(a, y - 7, a, y + 7, cls) + sx.line(b, y - 7, b, y + 7, cls);

/* ---------- 1. the map ---------- */
delayLesson({
  id: 'delay-names', icon: '🗺️', title: 'Where every delay lives',
  idea: 'A signal collects several different delays on its journey. First see where each one lives, then study them one at a time.',
  steps: () => [
    'The clock is made by a clock source. The time it takes to reach your design\'s clock pin is SOURCE LATENCY.',
    'Inside the chip, the clock splits and travels to each flip-flop. That is NETWORK LATENCY (insertion delay). Here FF 1 gets the edge sooner than FF 2. That difference is called SKEW.',
    'The clock edge reaches FF 1. A moment later its output changes. That is CLOCK-TO-Q delay.',
    'The data goes through a logic gate. That is CELL DELAY, also called gate delay.',
    'The data travels along a metal wire to the next gate. That is NET delay, also called wire or interconnect delay.',
    'A neighbouring wire that switches at the same time can push or hold your signal. That extra change is CROSSTALK DELAY.',
    'At the edges of the chip, time already used or still needed OUTSIDE is described by INPUT DELAY and OUTPUT DELAY.'
  ],
  result: () => verdict(true, 'Inside the chip, a path\'s delay is the clock-to-Q delay plus every cell delay and net delay along the way.'),
  draw(t) {
    const k = Math.min(6, Math.floor(t)), lit = (n, d) => k === n ? sx.path(d, 'sx-route') : '';
    let s = sx.rect(96, 14, 468, 262, 'sx-chip', 18) + sx.t(112, 38, 'CHIP', 'sx-b');
    // highlights sit under the wires they point at
    s += lit(0, 'M58 236L96 236') + lit(1, 'M96 236L460 236M160 236L160 150M460 236L460 150') + lit(4, 'M312 99L356 99M400 99L430 99') + lit(5, 'M310 64L420 64') + lit(6, 'M20 99L130 99M492 99L624 99');
    s += sx.line(20, 99, 130, 99, 'sx-wire') + sx.line(192, 99, 226, 99, 'sx-wire') + sx.line(298, 99, 356, 99, 'sx-wire') + sx.line(400, 99, 430, 99, 'sx-wire') + sx.line(492, 99, 624, 99, 'sx-wire');
    s += sx.ff(130, 76, 'FF 1', k === 2) + sx.cloud(226, 75, 72, 48, 'gate', k === 3) + sx.cloud(356, 81, 44, 36, 'gate') + sx.ff(430, 76, 'FF 2');
    s += sx.line(310, 64, 420, 64, 'sx-edge') + sx.t(365, 56, 'neighbour wire', 'sx-s', 'middle');
    s += sx.cloud(8, 218, 52, 36, 'PLL', k === 0) + sx.line(60, 236, 460, 236, 'sx-clk') + sx.line(160, 236, 160, 150, 'sx-clk') + sx.line(460, 236, 460, 150, 'sx-clk') + sx.dot(96, 236, 'sx-port', 8) + sx.t(106, 262, 'clk pin', 'sx-s sx-b') + sx.cloud(250, 220, 110, 32, 'clock buffers', k === 1);
    s += sx.dot(20, 99, 'sx-port', 7) + sx.t(10, 82, 'IN', 'sx-s sx-b') + sx.dot(624, 99, 'sx-port', 7) + sx.t(630, 82, 'OUT', 'sx-s sx-b', 'end');
    const names = ['source latency', 'network latency', 'clock-to-Q delay', 'cell delay', 'net (wire) delay', 'crosstalk delay', 'input and output delay'];
    const spot = [[8, 281], [250, 208], [176, 176], [220, 144], [318, 144], [308, 36], [248, 176]][k];
    s += sx.t(spot[0], spot[1], names[k], 'sx-b sx-hold-t');
    const route = [[[60, 236], [96, 236]], [[96, 236], [460, 236], [460, 150]], [[170, 99], [192, 99]], [[226, 99], [298, 99]], [[298, 99], [430, 99]], [[310, 64], [420, 64]], [[20, 99], [130, 99]]][k];
    if (k !== 1) { const at = sx.along(route, ph(t, k)); s += sx.dot(at[0], at[1], k === 0 ? 'sx-dot sx-ck' : 'sx-dot', 9); }
    else {
      // the clock splits: both copies move at the same speed, so the one with the shorter route arrives first
      const paths = [[[96, 236], [160, 236], [160, 150]], route], lengths = [150, 450], gone = 450 * Math.min(1, ph(t, 1) * 1.25);
      paths.forEach((way, i) => { const at = sx.along(way, gone / lengths[i]); s += sx.dot(at[0], at[1], 'sx-dot sx-ck', 9); });
      if (gone >= lengths[0]) s += sx.t(172, 172, 'arrives first', 'sx-s sx-b sx-ok-t');
      if (gone >= lengths[1]) s += sx.t(448, 172, 'arrives later', 'sx-s sx-b sx-bad-t', 'end');
    }
    return sx.svg(290, s);
  },
  tableTitle: '📋 The delays at a glance',
  table: [['Clock-to-Q', 'inside a flip-flop, clock edge to Q'], ['Cell (gate) delay', 'through a gate, input pin to output pin'], ['Propagation / contamination', 'the LATEST and EARLIEST view of a delay'], ['Transition (slew)', 'how long an edge itself takes'], ['Net (wire) delay', 'along the metal, driver to receiver'], ['Crosstalk delay', 'change caused by a switching neighbour wire'], ['Source latency', 'clock source to the clock definition point'], ['Network latency', 'clock definition point to flip-flop clock pins'], ['Input delay', 'time already used before your input port'], ['Output delay', 'time still needed after your output port'], ['Path delay', 'the total from start point to end point']],
  explain: {
    what: 'A <b>delay</b> is the time between a cause and its effect: an input changes, and a little later something else changes. STA never runs your circuit. It <b>adds up delays</b> along every path and compares the total with the time available.',
    analogy: 'Think of a parcel with a deadline. It spends time being packed, then in each sorting office, then on each road. To know if it arrives in time, you add up every part. Missing one part gives the wrong answer.',
    when: ['Every time a signal switches. Cells, wires and the clock all take time.', 'Before layout, tools <b>estimate</b> the delays. After routing, they calculate them from the real wires.'],
    why: ['The longest total decides the <b>fastest clock</b> your chip can use (setup).', 'The shortest total decides whether data can <b>rush through too early</b> (hold). A slower clock does not fix that.', 'When timing fails, knowing <b>which</b> delay is large tells you what to fix.'],
    change: ['Manufacturing process, supply voltage and temperature (together called <b>PVT</b>) change delays.', 'So do the gate you choose, what it drives, how sharp its input is, and where the cells are placed.'],
    sta: ['A timing report lists these delays <b>one line at a time</b> and keeps a running total.', 'Cell delays come from the library file (<code>.lib</code>). Wire values come from extracted parasitics (often a <code>SPEF</code> file).']
  },
  points: ['Open the lessons that follow in order. Each one shows <b>one</b> delay with its own demonstration.', '<b>Setup time</b> and <b>hold time</b> are not delays. They are rules about when data must stay still.', 'The word <b>latency</b> is used for the clock; it is still a delay.'],
  remember: 'STA is adding up delays: first learn what each one is, then learn which total to compare.',
  quiz: { q: 'Which of these is NOT a delay?', options: ['Clock-to-Q', 'Setup time', 'Network latency'], answer: 1, why: 'Setup time is a requirement: how long before the clock edge the data must already be still.' }
});

/* ---------- 2. propagation delay ---------- */
delayLesson({
  id: 'delay-propagation', icon: '🐢', title: 'Propagation delay',
  idea: 'The time a gate takes to respond: from the moment its input changes to the moment its output has changed.',
  params: [R('fall', 'Delay when the output FALLS (tpHL)', 0.4, 2.4, 0.1, 1), R('rise', 'Delay when the output RISES (tpLH)', 0.4, 2.4, 0.1, 1.6)],
  steps: () => [
    'This gate is an inverter: its output is the opposite of its input. Watch the input start to rise.',
    'The output does not jump. The gate must first DRAIN the charge stored on its output. This is a fall.',
    'We measure from the moment the input is half way (50%) to the moment the output is half way. That time is tpHL.',
    'Now the input falls, so the gate must FILL the output with charge again. Measured the same way, that time is tpLH.'
  ],
  result: p => verdict(true, `Falling output: ${sn(p.fall)} ns. Rising output: ${sn(p.rise)} ns. For a setup check, STA keeps the slowest case that can happen on the path (here up to ${sn(Math.max(p.fall, p.rise))} ns).`),
  draw(t, p) {
    const X = v => 78 + v * 53, tmax = 10, a = 1.5, b = 6;
    const upto = [2.2, 1.5 + p.fall + 0.6, 1.5 + p.fall + 1, 10];
    const k = Math.min(3, Math.floor(t)), from = k ? upto[k - 1] : 0, now = from + (upto[k] - from) * Math.min(1, ph(t, k) * 1.25);
    const input = u => rampUp(a, 0.7)(u) * (1 - rampUp(b, 0.7)(u)), output = u => 1 - rampUp(a + p.fall, 0.8)(u) * (1 - rampUp(b + p.rise, 0.8)(u));
    let s = sx.cloud(250, 12, 100, 40, 'inverter', true) + sx.line(190, 32, 250, 32, 'sx-wire') + sx.line(350, 32, 410, 32, 'sx-wire') + sx.t(182, 37, 'A', 'sx-b', 'end') + sx.t(418, 37, 'Y', 'sx-b');
    s += sx.t(10, 106, 'Input A', 'sx-s sx-b') + sx.t(10, 196, 'Output Y', 'sx-s sx-b');
    [[118, 'A'], [208, 'Y']].forEach(r => { s += sx.line(X(0), r[0] - 25, X(tmax), r[0] - 25, 'sx-edge') + sx.t(X(tmax) + 4, r[0] - 21, '50%', 'sx-s'); });
    s += wave(X, 118, 50, input, tmax, 'sx-sig', now) + wave(X, 208, 50, output, tmax, 'sx-sig sx-q', now);
    let guides = sx.guides(X, [a, a + p.fall], 66, 246, 'b');
    if (k >= 2) s += span(X(a), X(a + p.fall), 232, 'sx-arc-su') + sx.t(X(a + p.fall) + 8, 237, `tpHL ${sn(p.fall)} ns`, 'sx-s sx-b');
    if (k >= 3) {
      guides += sx.guides(X, [b, b + p.rise], 66, 246, 'b');
      if (now >= b + p.rise) s += span(X(b), X(b + p.rise), 232, 'sx-arc-su') + sx.t(X(b + p.rise) + 8, 237, `tpLH ${sn(p.rise)} ns`, 'sx-s sx-b');
    }
    return sx.svg(284, guides + s + sx.cursor(X(now), 62, 220) + sx.key(272, [['b', 'a signal crosses half way (50%)']]));
  },
  explain: {
    what: '<b>Propagation delay (tpd)</b> is the time from a change at a gate\'s input to the resulting change at its output. It is usually measured from the input crossing <b>50%</b> to the output crossing 50%. For a rising output it is called <b>tpLH</b> (low to high), for a falling one <b>tpHL</b>.',
    analogy: 'Filling and emptying a water tank through a tap. Opening the tap does not fill the tank instantly. A wider tap fills it sooner, and a bigger tank takes longer.',
    when: ['Every time an input change makes a gate\'s output change.', 'Inside a gate, transistors act like switches with some resistance. The output has some capacitance. Charging or discharging that capacitance <b>takes time</b>.', 'If an input changes but the output keeps its value, there is no output change to delay.'],
    why: ['These delays add up along a path. If the total is too long, the data misses the next clock edge: a <b>setup violation</b>.', 'So it limits the <b>maximum clock frequency</b> of the chip.'],
    change: ['<b>More load</b> (more gates or longer wire to drive): slower.', '<b>Stronger (bigger) gate</b>: usually faster at driving a heavy load.', '<b>Slow input edge</b>: usually slower.', '<b>Lower voltage</b> or a slow process: slower. Temperature matters too, and which way depends on the technology and voltage.', 'Rise and fall differ because different transistors do the pulling up and pulling down.'],
    sta: ['The library stores separate tables for rise and fall, usually named <code>cell_rise</code> and <code>cell_fall</code>.', 'STA follows which edge happens at each pin. After an inverter, a rising input becomes a falling output.', 'The largest (late) delays are used on the data path for <b>setup</b>.']
  },
  points: ['In digital design textbooks, <b>tpd</b> means the <b>longest</b> time until the output has settled.', 'In an STA report you will not see the letters tpd. You see a delay on each cell line.', 'One gate does not have one fixed delay. It depends on the input pin, the edge, the slew, the load and the conditions.'],
  remember: 'Propagation delay is input to output, 50% to 50%. Slowest case: think setup.',
  quiz: { q: 'You connect many more gates to one output. What happens to that gate\'s propagation delay?', options: ['It increases', 'It stays the same', 'It becomes zero'], answer: 0, why: 'More gates mean more capacitance to charge and discharge through the same transistors.' }
});

/* ---------- 3. contamination delay ---------- */
delayLesson({
  id: 'delay-contamination', icon: '⚡', title: 'Contamination (minimum) delay',
  idea: 'The earliest moment an output can start to change. Short delays can be just as dangerous as long ones.',
  params: [R('tcd', 'Contamination delay (earliest change)', 0.2, 2, 0.1, 0.6), R('tpd', 'Propagation delay (settled)', 2, 4.5, 0.1, 2.8), R('th', 'Hold time of the next flip-flop', 0.2, 1.8, 0.1, 1)],
  steps: p => [
    'At 0 ns the clock ticks. The next flip-flop starts to capture the OLD value, and at the same moment new data enters the logic.',
    `For the first ${sn(p.tcd)} ns the output still shows the old value. This is the contamination delay.`,
    `Then the output starts to change and may wiggle. Only after ${sn(p.tpd)} ns is it settled on the new value.`,
    STA_CALC.hold({ tcqMin: 0, combMin: p.tcd, th: p.th }).slack >= -1e-9 ? 'The old value stayed for the whole hold window, so the next flip-flop captured it safely.' : 'The output changed INSIDE the hold window. The next flip-flop may capture a wrong value.'
  ],
  result(p) {
    const r = STA_CALC.hold({ tcqMin: 0, combMin: p.tcd, th: p.th });
    return verdict(r.slack >= -1e-9, `Old value lasts ${sn(p.tcd)} ns, hold needs ${sn(p.th)} ns. Hold slack = ${sn(r.slack)} ns (the launch flip-flop's own delay is left out to keep this simple).`);
  },
  draw(t, p) {
    const X = v => 140 + v * 80, tmax = 5, now = [0.02, p.tcd, p.tpd + 0.4, 5][Math.min(3, Math.floor(t))], prev = [0, 0.02, p.tcd, p.tpd + 0.4][Math.min(3, Math.floor(t))];
    const at = prev + (now - prev) * Math.min(1, ph(t, Math.min(3, Math.floor(t))) * 1.25), bad = p.tcd < p.th - 1e-9;
    let s = sx.rect(X(0), 34, p.th * 80, 158, 'sx-win-h', 0) + sx.t(X(0), 24, `hold window ${sn(p.th)} ns`, 'sx-s sx-b');
    s += sx.t(12, 72, 'Logic input', 'sx-s sx-b') + sx.path(`M${X(-0.4)} 80L${X(0)} 80L${X(0)} 48L${X(tmax)} 48`, 'sx-sig');
    s += sx.t(12, 154, 'Logic output', 'sx-s sx-b') + sx.path(`M${X(-0.4)} 166L${X(Math.min(at, p.tcd))} 166`, 'sx-sig sx-q') + sx.t(X(-0.4) + 2, 186, 'OLD', 'sx-s sx-b');
    if (at > p.tcd) {
      const stop = Math.min(at, p.tpd), n = Math.max(2, Math.round((stop - p.tcd) * 7));
      s += sx.path(`M${X(p.tcd)} 166` + Array.from({ length: n }, (_, i) => `L${X(p.tcd + (stop - p.tcd) * (i + 1) / n)} ${i % 2 ? 166 : 122}`).join(''), bad ? 'sx-meta' : 'sx-sig sx-q') + sx.t(X((p.tcd + p.tpd) / 2), 112, 'unknown', 'sx-s sx-b', 'middle');
      if (at >= p.tpd) s += sx.path(`M${X(p.tpd)} 134L${X(at)} 134`, 'sx-sig sx-q') + sx.t(X(p.tpd) + 6, 126, 'NEW', 'sx-s sx-b');
    }
    s += span(X(0), X(p.tcd), 208, 'sx-arc-h') + sx.t(X(p.tcd) + 8, 213, `contamination ${sn(p.tcd)} ns`, 'sx-s sx-b') + span(X(0), X(p.tpd), 232, 'sx-arc-su') + sx.t(X(p.tpd) + 8, 237, `propagation ${sn(p.tpd)}`, 'sx-s sx-b');
    const guides = sx.guides(X, [0], 34, 246, 'a') + sx.guides(X, [p.tcd, p.tpd], 34, 246, 'b');
    return sx.svg(284, guides + s + sx.cursor(X(at), 34, 192) + sx.key(272, [['a', 'clock edge (0 ns)'], ['b', 'output starts / finishes changing']]));
  },
  explain: {
    what: '<b>Contamination delay (tcd)</b> is the <b>shortest</b> time from an input change until the output <b>starts</b> to change. Until then you can still trust the old value. After it, the output is unknown until the propagation delay has passed.',
    analogy: 'You drop a stone in a pond. The leaf across the pond stays still for a while, then starts to move, and later settles. Contamination delay is how long the leaf is guaranteed to stay still.',
    when: ['At every input change, <b>before</b> the output reacts at all.', 'It matters most when there is <b>very little logic</b> between two flip-flops, such as a shift register or a direct wire.', 'It becomes risky when the capture clock arrives <b>later</b> than the launch clock (positive skew).'],
    why: ['The capture flip-flop needs the old value to stay still for its <b>hold time</b> after the clock edge.', 'If new data arrives too soon, you get a <b>hold violation</b>.', 'Changing the clock period usually <b>cannot</b> fix it, because launch and capture happen at the same edge. A chip with a real hold violation can fail at any speed.'],
    change: ['<b>Fast conditions</b> (fast process, often higher voltage) make it shorter.', '<b>Fewer or stronger gates</b> and shorter wires make it shorter.', 'To fix hold, designers often <b>add delay</b>: delay cells or buffers on the short data path.'],
    sta: ['STA tools do not usually say "contamination delay". They say <b>min delay</b> or <b>early delay</b>.', 'The smallest delays along the data path are used for the <b>hold</b> check.', 'In a report it appears when you ask for minimum timing (for example <code>report_timing -delay_type min</code> in many tools).']
  },
  points: ['Propagation answers "when is it <b>surely finished</b>?". Contamination answers "when <b>could it start</b> to change?".', 'You cannot assume a delay is zero or large just because the typical value is. Hold uses the <b>earliest</b> case.', 'In the real hold equation you also add the launch flip-flop\'s earliest clock-to-Q delay.'],
  remember: 'Contamination = how long the old value survives. It protects hold.',
  quiz: { q: 'A hold check fails. Which change can help?', options: ['Use a slower clock', 'Add some delay to the short data path', 'Remove gates from that path'], answer: 1, why: 'Extra delay keeps the old value at the capture flip-flop for longer.' }
});

/* ---------- 4. transition (slew) ---------- */
delayLesson({
  id: 'delay-transition', icon: '📈', title: 'Transition time (slew)',
  idea: 'A real signal does not jump from 0 to 1. It climbs, and the time it takes to climb changes other delays.',
  params: [R('slew', 'Input transition time (20% to 80%)', 0.2, 2, 0.1, 0.8)],
  steps: () => [
    'The input starts to climb. A real edge is a slope, not a vertical step.',
    'Transition time is measured between two voltage levels of the SAME signal. Here: from 20% to 80%.',
    'The gate responds. Its output has a slope too, partly caused by the input slope.',
    'Cell delay is measured differently: from the input at 50% to the output at 50%. Make the input lazier and watch the delay grow.'
  ],
  result(p) {
    const d = STA_CALC.cellDelay({ intrinsic: 0.4, load: 5, slew: p.slew });
    return verdict(p.slew <= 1.4, `Input transition ${sn(p.slew)} ns gives a cell delay of ${sn(d.total)} ns in this simple model. ${p.slew <= 1.4 ? 'It is inside this example\'s limit of 1.4 ns.' : 'It breaks this example\'s limit of 1.4 ns: a max transition violation.'}`);
  },
  draw(t, p) {
    const X = v => 80 + v * 74, d = STA_CALC.cellDelay({ intrinsic: 0.4, load: 5, slew: p.slew }), in50 = 1.7, out50 = in50 + d.total, outSlew = 0.4 + p.slew * 0.3;
    const k = Math.min(3, Math.floor(t)), upto = [in50 + 0.3, in50 + p.slew, out50 + 0.8, 7], from = k ? upto[k - 1] : 0, now = from + (upto[k] - from) * Math.min(1, ph(t, k) * 1.25);
    const level = (base, f, name) => sx.line(X(0), base - 60 * f, X(7), base - 60 * f, 'sx-edge') + sx.t(X(7) + 4, base - 60 * f + 4, name, 'sx-s');
    let s = sx.t(10, 76, 'Input', 'sx-b') + level(106, 0.2, '20%') + level(106, 0.5, '50%') + level(106, 0.8, '80%') + wave(X, 106, 60, rampUp(in50, p.slew / 0.6), 7, 'sx-sig', now);
    s += sx.t(10, 182, 'Output', 'sx-b') + level(212, 0.5, '50%') + wave(X, 212, 60, rampUp(out50, outSlew / 0.6), 7, 'sx-sig sx-q', now);
    const t20 = in50 - p.slew / 2, t80 = in50 + p.slew / 2;
    let guides = '';
    if (k >= 1) { guides += sx.guides(X, [t20, t80], 22, 112, 'b'); s += span(X(t20), X(t80), 30, 'sx-arc-h') + sx.t(X(t80) + 8, 35, `input transition ${sn(p.slew)} ns`, 'sx-s sx-b'); }
    if (k >= 3) { guides += sx.guides(X, [in50, out50], 76, 246, 'a'); s += span(X(in50), X(out50), 236, 'sx-arc-su') + sx.t(X(out50) + 8, 241, `cell delay ${sn(d.total)} ns`, 'sx-s sx-b'); }
    return sx.svg(284, guides + s + sx.cursor(X(now), 40, 218) + sx.key(272, [['b', 'slew is measured here'], ['a', 'delay is measured here']]));
  },
  explain: {
    what: '<b>Transition time</b>, or <b>slew</b>, is how long a signal takes to change between two voltage levels, such as 20% to 80% (or 10% to 90%). The library chooses the levels. Rising and falling edges each have their own value. It describes <b>one signal\'s edge</b>, not the time from input to output.',
    analogy: 'A door that swings open quickly lets people through almost at once. A heavy door that creeps open keeps them waiting, even after it has started to move.',
    when: ['Every time any signal switches.', 'It gets large when a <b>weak gate</b> drives a <b>heavy load</b>: many inputs (high fanout) or a <b>long wire</b>.', 'It also gets worse along a long wire: the far end has a lazier edge than the near end.'],
    why: ['The next gate sees a lazy input and usually takes <b>longer</b> to respond. Its own output edge can get worse too, so the problem <b>passes down the path</b>.', 'While an input is half way, both pull-up and pull-down transistors can conduct, which <b>wastes power</b>.', 'A slow edge spends longer in the middle, where noise can disturb it more easily.', 'Very slow edges go outside the values the library was measured for, so delay numbers become <b>less trustworthy</b>.'],
    change: ['<b>Make it sharper</b>: use a stronger driver, add a buffer, split a high-fanout net, or shorten the wire.', '<b>Makes it worse</b>: more load, longer wire, a weaker driver, lower voltage.'],
    sta: ['Libraries look up delay using <b>input transition and output load</b>, and they also give the output transition.', 'There is a limit called <b>max transition</b> (SDC: <code>set_max_transition</code>; libraries have limits too). Breaking it is a <b>design rule violation</b> even if setup and hold pass.', 'Reports often show a column named <code>Trans</code> or <code>Slew</code>.']
  },
  points: ['<b>Transition</b> is measured on one signal. <b>Delay</b> is measured between two signals.', 'The delay formula here is a teaching model. Real libraries use tables or current-source models.', 'The 1.4 ns limit is made up. Real limits come from your library and design rules.'],
  remember: 'Slew is the slope of one edge. A lazy edge makes the next gate lazy too.',
  quiz: { q: 'A net has a very slow transition because one gate drives 40 others. What is a good fix?', options: ['Add buffers to split the load', 'Slow the clock down', 'Connect even more gates'], answer: 0, why: 'Each buffer drives only part of the load, so each edge becomes sharper. A slower clock does not change the edge.' }
});

/* ---------- 5. cell delay: intrinsic + load ---------- */
delayLesson({
  id: 'delay-cell', icon: '🧱', title: 'Cell delay: intrinsic and load',
  idea: 'A gate\'s delay has a part it carries with it and a part that depends on what it has to drive.',
  options: [{ k: 'size', label: 'Gate size', def: '1', choices: [['1', 'Small gate (X1)'], ['2', 'Medium gate (X2)'], ['4', 'Big gate (X4)']] }],
  params: [R('load', 'Number of gates being driven (fanout)', 1, 16, 1, 6, 'gates')],
  steps: p => [
    'Even with nothing connected outside, a gate takes some time to switch its own insides. This is INTRINSIC delay.',
    `Now it must charge the inputs of ${sn(p.load)} more gate(s). Each input is a small capacitor. This adds LOAD delay.`,
    'The slope of the input edge adds a little more. Here the input transition is fixed at 0.8 ns.',
    'Choose a bigger gate: it pushes more current, so the load part shrinks. But its own input is bigger, so the gate BEFORE it works harder.'
  ],
  calc(p) { return STA_CALC.cellDelay({ intrinsic: 0.4, load: p.load, slew: 0.8, kLoad: 0.12 / Number(p.size) }); },
  result(p) {
    const d = this.calc(p);
    return verdict(true, `Cell delay = intrinsic ${sn(d.intrinsic)} + load ${sn(d.fromLoad)} + slew ${sn(d.fromSlew)} = ${sn(d.total)} ns. This X${p.size} gate also loads the gate before it ${p.size} time(s) as much as an X1.`);
  },
  draw(t, p) {
    const d = this.calc(p), n = Math.round(p.load), size = Number(p.size);
    let s = sx.line(24, 92, 96, 92, 'sx-wire') + sx.cloud(96, 92 - (18 + size * 6), 96 + size * 10, 36 + size * 12, `gate X${size}`, true);
    const out = 192 + size * 10, shown = Math.floor(1 + (n - 1) * ph(t, 1) + 1e-9);
    s += sx.line(out, 92, 420, 92, 'sx-wire');
    // all the receivers hang on the same net: one trunk, then one branch per row
    if (t >= 1) {
      for (let row = 0; row * 4 < shown; row++) { const y = 33 + row * 40, last = Math.min(4, shown - row * 4) - 1; s += sx.poly([[420, 92], [420, y], [450 + last * 48, y]], 'sx-wire'); }
      for (let i = 0; i < shown; i++) s += sx.cloud(430 + (i % 4) * 48, 18 + Math.floor(i / 4) * 40, 40, 30, 'in');
    }
    s += sx.t(10, 34, 'signal from the gate before', 'sx-s') + sx.t(430, 190, t >= 1 ? `${shown} gate input(s) to charge` : 'nothing connected yet', 'sx-s sx-b');
    const X = v => 90 + v * 185, parts = [[0, d.intrinsic, 'sx-bar-q', 'intrinsic', 0], [d.intrinsic, d.intrinsic + d.fromLoad, 'sx-bar-logic', 'load', 1], [d.intrinsic + d.fromLoad, d.total, 'sx-bar-skew', 'slew', 2]];
    let end = 0;
    s += sx.t(14, 232, 'Delay', 'sx-b');
    for (const q of parts) { const f = ph(t, q[4]); if (f > 0) { end = q[0] + (q[1] - q[0]) * f; s += sx.bar(X, q[0], end, 210, q[2], q[3], 34); } }
    s += sx.axis(X, 262, 2.8, 0.5) + sx.t(Math.min(560, X(end) + 8), 232, `${sn(end)} ns`, 'sx-b');
    return sx.svg(292, s);
  },
  explain: {
    what: '<b>Cell delay</b> (gate delay) is the time through one standard cell. It helps to split it in two. <b>Intrinsic delay</b> is the part caused by the cell\'s own internal transistors and capacitance, with no external load. <b>Load-dependent delay</b> is the extra time needed to drive the wire and the gate inputs connected to the output.',
    analogy: 'Delivering water with a bucket. Picking the bucket up takes time even if there is one plant (intrinsic). Watering more plants takes longer (load). A bigger bucket waters them faster, but it is heavier to fill (a bigger input to drive).',
    when: ['Intrinsic delay is there <b>every time</b> the cell switches.', 'Load delay is large when the output has a <b>high fanout</b> or a <b>long wire</b> attached.'],
    why: ['Cell delays are usually a major part of a path\'s total.', 'It explains the most common timing fix, <b>gate sizing</b>: a bigger cell can drive a heavy load faster.', 'Bigger is <b>not always better</b>: it uses more area and power, and its larger input slows the stage before it.'],
    change: ['<b>Fewer receivers or shorter wire</b>: less load delay.', '<b>Bigger drive strength</b> (X2, X4): less load delay, more input capacitance.', '<b>Buffering</b>: let a buffer drive the heavy load.', 'Faster transistor types (often called low-Vt cells) are quicker but leak more power.'],
    sta: ['Delay comes from the cell\'s table in the <code>.lib</code> file, looked up with input transition and output capacitance. Real tables are <b>not</b> split neatly into these parts and are not straight lines.', 'The output capacitance includes both pin capacitances and wire capacitance.', 'There are limits such as <b>max capacitance</b> and <b>max fanout</b>.']
  },
  points: ['Load is really measured as <b>capacitance</b> (for example in femtofarads), not as a count of gates.', 'The numbers and the "divide by size" rule are a teaching model.', 'The study of how to size a chain of gates for the least delay is called <b>logical effort</b>.'],
  remember: 'Cell delay = its own part + what it has to drive. A bigger gate helps its load but burdens its driver.',
  quiz: { q: 'You swap a gate for a much bigger one. What else can happen?', options: ['The previous gate gets slower, because it now drives a bigger input', 'The wire becomes shorter', 'Intrinsic delay becomes zero'], answer: 0, why: 'A bigger cell usually has more input capacitance, which is extra load for its driver.' }
});

/* ---------- 6. clock-to-Q ---------- */
delayLesson({
  id: 'delay-clk-q', icon: '🚪', title: 'Clock-to-Q delay',
  idea: 'A flip-flop does not change its output the instant the clock ticks. It needs a short time.',
  params: [R('min', 'Earliest clock-to-Q (min)', 0.2, 1, 0.1, 0.4), R('max', 'Latest clock-to-Q (max)', 1.2, 3, 0.1, 1.8)],
  steps: p => [
    'D already holds the new value and waits. Q still shows the old value.',
    'Tick! The rising clock edge arrives at the flip-flop. At this instant Q has not changed yet.',
    `For at least ${sn(p.min)} ns Q keeps the old value. This is the EARLIEST clock-to-Q delay, used for hold.`,
    `By ${sn(p.max)} ns Q is surely showing the new value. This is the LATEST clock-to-Q delay, used for setup. Only now does the next logic have a stable input.`
  ],
  result: p => verdict(true, `Clock-to-Q is between ${sn(p.min)} ns (for hold) and ${sn(p.max)} ns (for setup). With a 10 ns clock, ${sn(p.max)} ns is already used before the logic even starts.`),
  draw(t, p) {
    const X = v => 240 + v * 90, k = Math.min(3, Math.floor(t)), upto = [-0.1, 0.05, p.min, 3.9], from = [-1, -0.1, 0.05, p.min][k], now = from + (upto[k] - from) * Math.min(1, ph(t, k) * 1.25);
    const cx = v => X(Math.min(v, now));
    let s = sx.ff(20, 100, 'FF', now >= 0) + sx.t(96, 68, 'CLK', 'sx-s sx-b') + sx.path(`M${X(-1)} 76L${cx(0)} 76` + (now > 0 ? `L${X(0)} 44L${X(now)} 44` : ''), 'sx-clk');
    s += sx.t(96, 138, 'D', 'sx-s sx-b') + sx.path(`M${X(-1)} 146L${X(-0.7)} 146L${X(-0.7)} 116L${X(4)} 116`, 'sx-sig') + sx.t(96, 208, 'Q', 'sx-s sx-b') + sx.path(`M${X(-1)} 216L${cx(p.min)} 216`, 'sx-sig sx-q');
    if (now > p.min) {
      const stop = Math.min(now, p.max), n = Math.max(2, Math.round((stop - p.min) * 7));
      s += sx.path(`M${X(p.min)} 216` + Array.from({ length: n }, (_, i) => `L${X(p.min + (stop - p.min) * (i + 1) / n)} ${i % 2 ? 216 : 186}`).join(''), 'sx-sig sx-q') + sx.t(X((p.min + p.max) / 2), 176, 'changing', 'sx-s sx-b', 'middle');
      if (now >= p.max) s += sx.path(`M${X(p.max)} 186L${X(now)} 186`, 'sx-sig sx-q') + sx.t(X(p.max) + 6, 178, 'new value', 'sx-s sx-b');
    }
    if (k >= 2) s += span(X(0), X(p.min), 236, 'sx-arc-h') + sx.t(X(p.min) + 8, 241, `min ${sn(p.min)} ns`, 'sx-s sx-b');
    if (k >= 3) s += span(X(0), X(p.max), 258, 'sx-arc-su') + sx.t(X(p.max) + 8, 263, `max ${sn(p.max)} ns`, 'sx-s sx-b');
    const guides = sx.guides(X, [0], 30, 272, 'a') + sx.guides(X, [p.min, p.max], 30, 272, 'b');
    return sx.svg(310, guides + s + sx.cursor(X(now), 30, 220) + sx.key(298, [['a', 'rising clock edge'], ['b', 'Q starts / finishes changing']]));
  },
  explain: {
    what: '<b>Clock-to-Q delay (tcq)</b> is the time from the active clock edge at a flip-flop\'s clock pin until its <b>Q</b> output changes. The latest value is often written <b>tpcq</b> (propagation) and the earliest <b>tccq</b> (contamination).',
    analogy: 'A traffic light controller gets the signal to change. The lamp turns a short moment later, not at exactly the same instant.',
    when: ['At every active clock edge where the flip-flop\'s output changes.', 'The data on D must already have met setup time before that edge.', 'It starts when the edge reaches <b>this flip-flop\'s clock pin</b>, which is later than at the clock source because of clock latency.'],
    why: ['It is the <b>first delay on every register-to-register path</b>. It uses part of the clock period before any logic starts.', 'It limits the top speed even with no logic at all: the period must fit at least clock-to-Q plus setup time.', 'Its <b>earliest</b> value helps hold: it is time during which the old value still survives.'],
    change: ['<b>More load on Q</b>: slower.', '<b>A slow clock edge</b> at the clock pin: usually slower.', 'The flip-flop\'s size and type, and process, voltage and temperature.', 'If D changes too close to the edge, the flip-flop can go <b>metastable</b>, and then Q may take much longer than normal.'],
    sta: ['The library stores it as a timing arc from the clock pin (often <code>CK</code> or <code>CLK</code>) to <code>Q</code>.', 'In a report it is the line where the path moves from the launch flip-flop\'s clock pin to its Q pin.', 'Setup: <code>arrival = tcq(max) + logic(max)</code>. Hold: <code>arrival = tcq(min) + logic(min)</code>.']
  },
  points: ['Clock-to-Q is a <b>delay</b>. Setup and hold are <b>requirements</b> of the same flip-flop.', 'A latch also has this kind of delay, plus a D-to-Q delay while it is open.', 'The minimum period of a simple path is <code>tcq + logic + setup</code> (before skew and uncertainty).'],
  remember: 'Every tick, the race starts a little late: tcq comes first.',
  quiz: { q: 'tcq is 1 ns and setup time is 0.8 ns. With NO logic between two flip-flops (and no skew or uncertainty), what is the smallest clock period?', options: ['1 ns', '1.8 ns', '0.2 ns'], answer: 1, why: 'The data needs 1 ns to appear on Q and must arrive 0.8 ns before the next edge.' }
});

/* ---------- 7. net / wire delay ---------- */
delayLesson({
  id: 'delay-wire', icon: '🧵', title: 'Net (wire) delay',
  idea: 'Metal wires are not instant. The far end of a long wire charges later and more slowly.',
  params: [R('len', 'Wire length', 0.4, 4, 0.2, 2, 'mm')], toggles: [['rep', 'Add a repeater (buffer) in the middle']],
  steps: () => [
    'The driver switches from 0 to 1. The wire has resistance (R) and capacitance (C) spread all along it.',
    'The near end charges first. Charge must squeeze through the wire\'s resistance to reach further.',
    'The middle follows later, and the far end later still, with a lazier edge.',
    'Compare the totals. Without a repeater, a wire twice as long has much more than twice the delay. A repeater splits it into two short pieces.'
  ],
  result(p) {
    const a = STA_CALC.wire({ len: p.len }), b = STA_CALC.wire({ len: p.len, repeater: true });
    return verdict(!p.rep || b <= a, `Wire delay ${sn(p.rep ? b : a)} ns${p.rep ? ` with a repeater (${sn(a)} ns without). ${b < a ? 'The repeater helps on this length.' : 'On a wire this short the repeater makes it SLOWER.'}` : ' without a repeater. Try doubling the length.'}`);
  },
  draw(t, p) {
    const total = STA_CALC.wire({ len: p.len }), withRep = STA_CALC.wire({ len: p.len, repeater: true });
    let s = sx.t(46, 24, 'driver', 'sx-s sx-b', 'middle') + sx.cloud(14, 34, 66, 40, 'out', true) + sx.line(80, 54, 560, 54, 'sx-wire') + sx.cloud(560, 34, 66, 40, 'in') + sx.t(593, 24, 'receiver', 'sx-s sx-b', 'middle');
    for (let i = 0; i < 8; i++) { if (p.rep && (i === 3 || i === 4)) continue; const x = 118 + i * 56; s += sx.rect(x - 16, 47, 24, 14, 'sx-bar-logic', 3) + sx.line(x + 22, 54, x + 22, 78, 'sx-wire') + sx.line(x + 13, 78, x + 31, 78, 'sx-wire') + sx.line(x + 13, 85, x + 31, 85, 'sx-wire'); }
    if (p.rep) s += sx.cloud(286, 36, 74, 36, 'repeater', true);
    s += sx.dot(150, 54, 'sx-dot sx-ink', 6) + sx.dot(320, 54, 'sx-dot sx-bad', 6) + sx.dot(528, 54, 'sx-dot sx-alt', 6) + sx.t(150, 104, 'near', 'sx-s sx-b', 'middle') + sx.t(320, 104, 'middle', 'sx-s sx-b', 'middle') + sx.t(528, 104, 'far', 'sx-s sx-b', 'middle');
    // voltage at the three probe points. Without a repeater: delay to a point a fraction f along the wire (Elmore estimate)
    if (!p.rep) {
      const r = 0.5, c = 0.2, tau = f => r * c * p.len * p.len * (f - f * f / 2) + r * p.len * f * 0.05;
      const window = Math.max(0.1, total * 2.6), X = v => 70 + v * (510 / window), shownTo = window * Math.min(1, t / 3);
      [[0.15, 'sx-sig', 'near'], [0.5, 'sx-sig sx-bad', 'middle'], [1, 'sx-sig sx-q', 'far']].forEach(q => { s += wave(X, 210, 72, u => 1 - Math.exp(-u * 0.69 / tau(q[0])), window, q[1], shownTo); });
      s += sx.line(70, 174, 580, 174, 'sx-edge') + sx.t(584, 178, '50%', 'sx-s') + sx.t(10, 134, 'Voltage', 'sx-s sx-b') + sx.t(580, 228, 'time →', 'sx-s sx-b', 'end') + sx.line(70, 210, 580, 210, 'sx-axis');
      s += sx.t(76, 126, 'black: near  ·  red: middle  ·  green: far', 'sx-s sx-b');
    } else s += sx.t(320, 150, 'The repeater receives a tired signal halfway and sends out a fresh, sharp one.', 'sx-s sx-b', 'middle') + sx.t(320, 178, 'It costs a little delay of its own, plus area and power.', 'sx-s', 'middle');
    const max = Math.max(total, withRep, 0.1), bar = (y, name, v, on) => sx.t(14, y + 17, name, 'sx-s sx-b') + sx.rect(140, y, Math.max(3, 390 * v / max), 24, on ? 'sx-bar-skew' : 'sx-bar-ext', 5) + sx.t(148 + Math.max(3, 390 * v / max), y + 17, `${v.toFixed(3)} ns`, 'sx-s sx-b');
    if (t >= 3) s += bar(240, 'no repeater', total, !p.rep) + bar(272, 'with repeater', withRep, p.rep);
    return sx.svg(306, s);
  },
  explain: {
    what: '<b>Net delay</b> (also <b>wire</b> or <b>interconnect delay</b>) is the time for a signal to travel along the metal from a gate\'s output pin to the input pin of the next gate. Different receivers on the same net can have <b>different</b> net delays.',
    analogy: 'A long, thin garden hose with soft walls. Turn on the tap: water pressure rises quickly near the tap, but slowly at the far end, because the hose itself has to fill up first.',
    when: ['On every connection between pins.', 'It is tiny on short local wires and large on <b>long wires crossing the chip</b>, or on wires that are detoured because the area is crowded.', 'Before routing it is only an <b>estimate</b>. After routing, it is based on the real wire shapes.'],
    why: ['On advanced chip processes wires are very thin, so their resistance is high. On long paths, wire delay can be as important as gate delay, or more.', 'It is why a design can pass timing <b>before layout and fail after</b>.', 'It depends on <b>placement</b>: two connected cells placed far apart give a slow path.'],
    change: ['<b>Longer wire</b>: more R and more C, so delay grows roughly with <b>length squared</b>.', '<b>Wider or higher metal layers</b>: usually lower resistance.', '<b>Repeaters</b> break a long wire into short pieces.', '<b>Better placement</b> and shorter routes help most.'],
    sta: ['The wire\'s R and C are extracted from the layout, commonly into a <code>SPEF</code> file.', 'Tools compute delay and slew at each receiver using accurate methods. <b>Elmore delay</b> is a quick first estimate: for one even wire, <code>R × (C/2 + C_load)</code>. It usually comes out high: in a circuit simulation of the wires in this demo, it was about a third above the true 50% delay.', 'In a report it shows as a line marked <b>net</b>, or it is merged into the next cell\'s line.', 'The wire\'s capacitance is also <b>load</b> for the driving gate, so it increases cell delay too.']
  },
  points: ['A wire slows a path <b>twice</b>: its own net delay, and extra load on the driving cell.', 'The R and C per millimetre here are made up to show the shape of the effect.', 'Clock wires have delay too: that is part of clock network latency.'],
  remember: 'Long wire, big delay: it grows roughly with length squared. Repeaters tame it.',
  quiz: { q: 'Roughly how does the delay of a long unbuffered wire change if its length doubles?', options: ['It stays the same', 'It doubles exactly', 'It becomes about four times larger'], answer: 2, why: 'Both resistance and capacitance double, and their product sets the delay. The receiver load makes it slightly less than four times.' }
});

/* ---------- 8. crosstalk delay ---------- */
delayLesson({
  id: 'delay-crosstalk', icon: '👥', title: 'Crosstalk (delta) delay',
  idea: 'Wires that run side by side disturb each other. A neighbour can make your signal later or earlier.',
  options: [{ k: 'nb', label: 'Neighbour wire', def: 'opposite', choices: [['quiet', 'Neighbour is quiet'], ['opposite', 'Switches the OPPOSITE way'], ['same', 'Switches the SAME way']] }],
  params: [R('cc', 'How strongly the wires are coupled', 0.1, 0.6, 0.05, 0.4, ''), R('gap', 'How far apart in time they switch', 0, 3, 0.1, 0, 'ns')],
  steps: p => [
    'Two long wires run next to each other. Between them is a small unwanted capacitor, the coupling capacitance.',
    'Our wire, the VICTIM, starts to rise. The neighbour is called the AGGRESSOR.',
    p.nb === 'quiet' ? 'The neighbour stays still, so the victim behaves normally.' : p.gap > 1 ? 'The neighbour switches at a very different time, so it does not change the victim\'s delay here.' : p.nb === 'opposite' ? 'The neighbour moves the opposite way. The victim must supply extra charge to the capacitor between them, so it is SLOWER.' : 'The neighbour moves the same way and helps charge the victim, so the victim is FASTER.',
    'The difference from the quiet case is the delta delay. STA must consider the harmful direction for each check.'
  ],
  calc(p) { return STA_CALC.crosstalk({ base: 1, coupling: p.cc, neighbour: p.nb, overlap: p.gap <= 1 }); },
  result(p) {
    const r = this.calc(p);
    return verdict(Math.abs(r.delta) < 1e-9, `Victim wire delay ${sn(r.delay)} ns (1 ns when the neighbour is quiet). Delta delay ${r.delta > 0 ? '+' : ''}${sn(r.delta)} ns. ${r.delta > 1e-9 ? 'Later: dangerous for SETUP on a data path.' : r.delta < -1e-9 ? 'Earlier: dangerous for HOLD on a data path.' : 'No change.'}`);
  },
  draw(t, p) {
    const r = this.calc(p), X = v => 90 + v * 82, start = 1.6, k = Math.min(3, Math.floor(t)), now = [0.5, start + 0.1, 5, 6][k] * 1, shown = k === 0 ? 0.9 * ph(t, 0) : k === 1 ? 0.9 + (start + 0.4 - 0.9) * ph(t, 1) : k === 2 ? start + 0.4 + (6 - start - 0.4) * ph(t, 2) : 6;
    const aggAt = start + (p.nb === 'quiet' ? 0 : p.gap);
    const victim = d => rampUp(start + d, 0.9), agg = u => p.nb === 'quiet' ? 0 : p.nb === 'same' ? rampUp(aggAt, 0.9)(u) : 1 - rampUp(aggAt, 0.9)(u);
    let s = sx.t(10, 52, 'aggressor', 'sx-s sx-b') + wave(X, 70, 40, agg, 6, 'sx-sig sx-bad', shown);
    for (let i = 0; i < 6; i++) { const x = 150 + i * 74; s += sx.line(x, 82, x, 92, 'sx-guide') + sx.line(x - 9, 92, x + 9, 92, 'sx-wire') + sx.line(x - 9, 98, x + 9, 98, 'sx-wire') + sx.line(x, 98, x, 108, 'sx-guide'); }
    s += sx.t(585, 100, 'coupling', 'sx-s') + sx.t(10, 156, 'victim', 'sx-s sx-b') + sx.line(X(0), 150, X(6), 150, 'sx-edge') + sx.t(X(6) + 4, 154, '50%', 'sx-s');
    s += wave(X, 175, 50, victim(1), 6, 'sx-guide', shown) + wave(X, 175, 50, victim(r.delay), 6, 'sx-sig sx-q', shown);
    let guides = '';
    if (k >= 3) {
      guides = sx.guides(X, [start], 24, 236, 'a') + sx.guides(X, [start + 1, start + r.delay], 110, 236, 'b');
      s += span(X(start), X(start + 1), 204, 'sx-arc-h') + sx.t(X(start + Math.max(1, r.delay)) + 10, 209, 'quiet: 1 ns', 'sx-s sx-b') + span(X(start), X(start + r.delay), 228, 'sx-arc-su') + sx.t(X(start + Math.max(1, r.delay)) + 10, 233, `now: ${sn(r.delay)} ns`, 'sx-s sx-b');
    }
    return sx.svg(284, guides + s + sx.cursor(X(shown), 24, 184) + sx.t(14, 250, 'thin dashed line = the victim with a quiet neighbour', 'sx-s') + sx.key(272, [['a', 'victim starts'], ['b', 'victim reaches 50%']]));
  },
  explain: {
    what: '<b>Crosstalk delta delay</b> is the <b>change</b> in a signal\'s delay caused by a nearby wire switching. The wire we care about is the <b>victim</b>, the neighbour is the <b>aggressor</b>. The cause is the <b>coupling capacitance</b> between them. (Crosstalk can also create a voltage bump on a quiet wire, called a <b>glitch</b> or noise, which is a related but separate check.)',
    analogy: 'Walking in a crowded corridor. Someone beside you walking the same way hardly slows you. Someone pushing the opposite way slows you down. Someone who passed a minute ago has no effect.',
    when: ['Wires run <b>close together for a long distance</b>.', 'The victim and the aggressor switch <b>at about the same time</b> (their timing windows overlap).', 'It is stronger on dense, advanced processes, where wires are close and tall.'],
    why: ['An <b>opposite</b> switch makes the victim later. On a data path that can break <b>setup</b>.', 'A <b>same-direction</b> switch makes it earlier. On a data path that can break <b>hold</b>.', 'On a <b>clock wire</b> it shifts the clock edge itself, which can disturb many flip-flops.', 'A design can pass timing without crosstalk and fail once it is included.'],
    change: ['<b>More spacing</b> between the wires.', '<b>Shielding</b>: put a quiet power or ground wire between them. Clocks are often protected this way.', '<b>Shorter parallel runs</b>, or moving one wire to another layer.', '<b>Stronger victim driver</b>, or a weaker (slower) aggressor.'],
    sta: ['This analysis is called <b>signal integrity (SI)</b> analysis. Sign-off timing tools can include it.', 'It needs coupling capacitances from extraction.', 'The tool checks the <b>timing windows</b> to see whether the two nets can really switch together, then adds the delta to late or early arrival times.', 'Reports can show it in a column such as <code>Delta</code>.']
  },
  points: ['The same neighbour can be harmful for setup in one case and for hold in another.', 'The "quiet = 1 ns" model and the 1 ns overlap window are simplifications to show the idea.', 'Crosstalk fixes are mostly done by the place-and-route tool: spacing, shielding and re-routing.'],
  remember: 'Opposite pushes you later, same pulls you earlier, far apart in time does nothing.',
  quiz: { q: 'An aggressor switches opposite to a data-path victim at the same moment. Which check is in more danger?', options: ['Setup, because the data arrives later', 'Hold, because the data arrives earlier', 'Neither'], answer: 0, why: 'The opposite switch slows the victim, which eats setup time.' }
});

/* ---------- 9. clock latency ---------- */
delayLesson({
  id: 'delay-clock', icon: '🕰️', title: 'Clock latency: source and network',
  idea: 'The clock is a signal too. It takes time to reach each flip-flop, and not always the same time.',
  params: [R('src', 'Source latency', 0.2, 2, 0.1, 0.8), R('netA', 'Network latency to FF A', 0.2, 2, 0.1, 1), R('netB', 'Network latency to FF B', 0.2, 2, 0.1, 1.6)],
  steps: p => [
    'The clock edge is created at its source, such as an oscillator or a PLL.',
    `It travels to the point where the clock is defined, here the chip's clk pin. This takes ${sn(p.src)} ns: SOURCE latency.`,
    'From the clk pin it spreads through the clock tree: buffers and wires. This is NETWORK latency. Each flip-flop has its own value.',
    'The two flip-flops see the same edge at different moments. That DIFFERENCE is called clock skew.'
  ],
  result(p) {
    const skew = p.netB - p.netA;
    return verdict(true, `Edge reaches FF A at ${sn(p.src + p.netA)} ns and FF B at ${sn(p.src + p.netB)} ns. Skew (B minus A) = ${skew > 1e-9 ? '+' : ''}${sn(skew)} ns. The shared source latency cancels out of the skew.`);
  },
  draw(t, p) {
    const k = Math.min(3, Math.floor(t));
    let s = sx.cloud(8, 62, 76, 44, 'PLL', k === 0) + sx.line(84, 84, 200, 84, 'sx-clk') + sx.dot(200, 84, 'sx-port', 10) + sx.t(200, 62, 'clk pin', 'sx-s sx-b', 'middle');
    s += sx.line(200, 84, 270, 84, 'sx-clk') + sx.line(270, 40, 270, 136, 'sx-clk') + sx.line(270, 40, 520, 40, 'sx-clk') + sx.line(270, 136, 520, 136, 'sx-clk') + sx.cloud(330, 24, 90, 32, 'buffers') + sx.cloud(330, 120, 90, 32, 'buffers') + sx.cloud(520, 18, 70, 44, 'FF A', t >= 3) + sx.cloud(520, 114, 70, 44, 'FF B', t >= 3);
    const far = Math.max(p.netA, p.netB);
    if (k < 2) { const x = k === 0 ? 84 : 84 + 116 * ph(t, 1); s += sx.dot(x, 84, 'sx-dot sx-ck', 9); }
    else { const gone = far * ph(t, 2); [[p.netA, 40], [p.netB, 136]].forEach(q => { const at = sx.along([[200, 84], [270, 84], [270, q[1]], [520, q[1]]], Math.min(1, gone / q[0])); s += sx.dot(at[0], at[1], 'sx-dot sx-ck', 9); }); }
    const X = v => 100 + v * 108, tmax = 4.2, a = p.src + p.netA, b = p.src + p.netB;
    s += sx.t(10, 192, 'at FF A', 'sx-s sx-b') + sx.bar(X, 0, p.src, 176, 'sx-bar-ext', 'source') + sx.bar(X, p.src, a, 176, 'sx-bar-q', 'network');
    s += sx.t(10, 228, 'at FF B', 'sx-s sx-b') + sx.bar(X, 0, p.src, 212, 'sx-bar-ext', 'source') + sx.bar(X, p.src, b, 212, 'sx-bar-alt', 'network');
    s += sx.axis(X, 252, tmax, 1);
    if (k >= 3) s += span(X(Math.min(a, b)), X(Math.max(a, b)), 168, 'sx-arc-su') + sx.t(X(Math.max(a, b)) + 8, 173, `skew ${sn(p.netB - p.netA)} ns`, 'sx-s sx-b');
    const guides = sx.guides(X, [0, p.src], 164, 262, 'a') + sx.guides(X, [a, b], 164, 262, 'b');
    return sx.svg(302, guides + s + sx.key(290, [['a', 'edge made / at clk pin'], ['b', 'edge arrives at a flip-flop']]));
  },
  explain: {
    what: '<b>Clock latency</b> is how long a clock edge takes to arrive. <b>Source latency</b> is the delay from the real clock origin to the point where you <b>define</b> the clock (such as a port or pin). <b>Network latency</b> is the delay from that point to a flip-flop\'s clock pin. The on-chip clock tree delay is often called <b>insertion delay</b>. Total latency = source + network.',
    analogy: 'A radio announcement of the time. It takes a moment to reach your town (source), then a different moment to reach each house through local speakers (network). Houses that hear it at different moments disagree slightly about "now".',
    when: ['Every clock edge has to travel, so latency is there on <b>every tick</b>.', 'Before the clock tree is built, the tool treats the clock as <b>ideal</b> and you give it <b>estimates</b>.', 'After <b>clock tree synthesis (CTS)</b>, the network latency is calculated from the real buffers and wires.'],
    why: ['The <b>difference</b> between latencies is <b>skew</b>. When the capture clock is later, setup gets more time and hold gets harder.', 'For a path between two flip-flops on the same clock, latency that both share mostly <b>cancels</b>. (With on-chip variation, analysis needs care: see the OCV lesson.)', 'For <b>input and output</b> paths the other end is outside the chip, so the on-chip latency does <b>not</b> automatically cancel.', 'A deeper clock tree has more buffers: more power, and more room for variation.'],
    change: ['Clock tree <b>depth</b>, buffer sizes and wire lengths.', 'How far the flip-flops are from the clock entry point.', 'Clock tree synthesis tries to <b>balance</b> branches, and sometimes adds skew on purpose (<b>useful skew</b>).', 'Process, voltage and temperature.'],
    sta: ['Network latency estimate: <code>set_clock_latency 1.2 [get_clocks clk]</code>', 'Source latency: <code>set_clock_latency -source 0.8 [get_clocks clk]</code>', 'After CTS: <code>set_propagated_clock [get_clocks clk]</code> makes the tool calculate network latency from the real tree. Your source latency value is still used. (Some tools, such as Vivado, calculate it without this command.)', 'Reports show lines such as <code>clock network delay (ideal)</code> or <code>(propagated)</code>. Depending on the report format, source latency has its own line or is included in that one.']
  },
  points: ['<b>Latency</b> is the time to arrive. <b>Skew</b> is a difference in arrival. <b>Jitter</b> is edge-to-edge wobble. They are three different things.', 'Do not add an estimated network latency on top of a real propagated clock tree.', 'On an FPGA, the clock routing is pre-built, and the tool already knows its delays.'],
  remember: 'Source: to the clock definition point. Network: from there to the flip-flop. Their differences make skew.',
  quiz: { q: 'FF A and FF B share the same source latency, and it increases by 1 ns. What happens to the skew between them?', options: ['It increases by 1 ns', 'It does not change', 'It becomes zero'], answer: 1, why: 'Both edges arrive 1 ns later, so the difference between them stays the same.' }
});

/* ---------- 10. input delay ---------- */
delayLesson({
  id: 'delay-input', icon: '📥', title: 'Input delay',
  idea: 'Data from outside your chip has already used part of the clock period. STA cannot see that unless you tell it.',
  params: [R('ext', 'Outside flip-flop clock-to-Q', 0.2, 4, 0.1, 2), R('wire', 'Board wire delay', 0.2, 3, 0.1, 1), R('comb', 'Logic inside your chip', 1, 9, 0.5, 5)],
  steps: p => [
    'A clock tick. A flip-flop in ANOTHER chip sends data. Your tool knows nothing about that chip.',
    `The data crosses the other chip's output (${sn(p.ext)} ns) and the board wire (${sn(p.wire)} ns). It reaches your input port at ${sn(p.ext + p.wire)} ns.`,
    `That time is the INPUT DELAY: ${sn(p.ext + p.wire)} ns. It is already spent when the data enters your chip.`,
    'Only the rest of the clock period is left for your own logic and your flip-flop\'s setup time.'
  ],
  base: { T: 10, tsu: 0.8 },
  calc(p) { return STA_CALC.inputPath({ T: this.base.T, idly: p.ext + p.wire, comb: p.comb, tsu: this.base.tsu }); },
  result(p) {
    const r = this.calc(p);
    return verdict(r.slack >= -1e-9, `Input delay ${sn(p.ext + p.wire)} ns leaves ${sn(this.base.T - p.ext - p.wire - this.base.tsu)} ns for your logic (10 ns clock, 0.8 ns setup). Slack ${sn(r.slack)} ns.`);
  },
  code: p => [`set_input_delay -max ${sn(p.ext + p.wire)} -clock clk [get_ports din]`, '# -min needs the EARLIEST outside clock-to-Q plus the SHORTEST board delay'],
  draw(t, p) {
    const k = Math.min(3, Math.floor(t)), idly = p.ext + p.wire, r = this.calc(p);
    let s = sx.rect(8, 24, 190, 108, 'sx-chip', 14) + sx.t(20, 40, 'OTHER CHIP', 'sx-s sx-b') + sx.rect(330, 24, 302, 108, 'sx-chip', 14) + sx.t(344, 40, 'YOUR CHIP', 'sx-s sx-b');
    s += sx.line(124, 92, 360, 92, 'sx-wire') + sx.line(422, 92, 546, 92, 'sx-wire') + sx.ff(62, 68, 'FF out', k === 0) + sx.dot(330, 92, 'sx-port', 9) + sx.t(322, 118, 'din', 'sx-s sx-b', 'end') + sx.t(264, 80, 'board wire', 'sx-s', 'middle') + sx.cloud(432, 70, 78, 44, 'logic', k === 3) + sx.line(360, 92, 432, 92, 'sx-wire') + sx.ff(546, 68, 'your FF');
    const at = k === 0 ? [124, 92] : k === 1 ? sx.along([[124, 92], [330, 92]], ph(t, 1)) : k === 2 ? [330, 92] : sx.along([[330, 92], [546, 92]], ph(t, 3));
    s += sx.dot(at[0], at[1], 'sx-dot', 10);
    const end = Math.max(this.base.T, r.arrival) + 0.5, X = v => 40 + v * (556 / end);
    s += sx.bar(X, 0, p.ext, 164, 'sx-bar-ext', 'FF') + sx.bar(X, p.ext, idly, 164, 'sx-bar-ext', 'board');
    if (k >= 2) s += span(X(0), X(idly), 204, 'sx-arc-h') + sx.t(X(idly) + 8, 209, `input delay ${sn(idly)} ns`, 'sx-s sx-b');
    if (k >= 3) s += sx.bar(X, idly, r.arrival, 164, r.slack >= -1e-9 ? 'sx-bar-logic' : 'sx-bar-bad', 'your logic') + sx.bar(X, this.base.T - this.base.tsu, this.base.T, 222, 'sx-bar-su', 'setup');
    s += sx.axis(X, 262, Math.floor(end), end > 14 ? 2 : 1);
    const guides = sx.guides(X, [0, this.base.T], 154, 272, 'a') + sx.guides(X, [idly], 154, 272, 'b');
    return sx.svg(312, guides + s + sx.key(300, [['a', 'clock edge'], ['b', 'data reaches your input port']]));
  },
  explain: {
    what: '<b>Input delay</b> tells STA when data arrives at an input port, measured <b>from a clock edge</b>. It stands for everything outside your design: the sending device\'s clock-to-Q, any logic out there, and the board wire. It is a <b>constraint you write</b>, not something the tool can calculate from your chip.',
    analogy: 'You get 10 minutes to finish a task, but the file reaches your desk 3 minutes late. You really have 7. If nobody tells your planner about the 3 minutes, the plan will wrongly say you have 10.',
    when: ['On every input port that is captured by a clock inside your design.', 'The data comes from another chip on the board, or from another block that will be joined to yours later.', 'It is not for clock ports. Truly asynchronous inputs need synchronizers and suitable exceptions instead.'],
    why: ['<b>Without it, the input path is not properly checked.</b> The report can look clean while the real board fails.', 'Too small a value is <b>optimistic</b>: your logic seems to have more time than it has.', 'Too large a value is <b>pessimistic</b>: tools work hard to fix a problem that does not exist.'],
    change: ['<code>-max</code>: the <b>latest</b> arrival = slowest outside clock-to-Q + longest board delay. Used for <b>setup</b>.', '<code>-min</code>: the <b>earliest</b> arrival = fastest outside clock-to-Q + shortest board delay. Used for <b>hold</b>.', 'The numbers come from the other device\'s <b>datasheet</b> and the board design.', 'Differences in how the clock reaches the two chips must be included too.'],
    sta: ['Setup slack for this path: <code>(T + skew − setup − uncertainty) − (input delay + logic)</code>.', 'In a report, the path starts at the input port with a line such as <code>input external delay</code>.', 'The <code>-clock</code> option can name a <b>virtual clock</b>: a clock that exists only outside your design.']
  },
  points: ['Input delay describes the <b>outside world</b>. It does not add any delay hardware to your chip.', 'The demo assumes both chips get the same clock edge at the same moment.', 'Give both <code>-max</code> and <code>-min</code>.'],
  remember: 'Input delay = time already spent before the data reaches your door.',
  quiz: { q: 'The clock is 10 ns, input delay (max) is 6 ns and your flip-flop needs 0.8 ns setup. How much time is left for your logic (ignore skew and uncertainty)?', options: ['10 ns', '4 ns', '3.2 ns'], answer: 2, why: '10 − 6 − 0.8 = 3.2 ns.' }
});

/* ---------- 11. output delay ---------- */
delayLesson({
  id: 'delay-output', icon: '📤', title: 'Output delay',
  idea: 'After data leaves your chip, the outside world still needs time. You must leave that time free.',
  params: [R('comb', 'Logic inside your chip', 1, 9, 0.5, 5), R('wire', 'Board wire delay', 0.2, 3, 0.1, 1), R('ext', 'Setup time of the outside flip-flop', 0.2, 3, 0.1, 1.5)],
  steps: p => [
    'A clock tick. Your flip-flop sends data toward another chip.',
    'The data passes your own clock-to-Q (1 ns) and your logic, and reaches your output port.',
    `Outside, it still has to cross the board wire (${sn(p.wire)} ns) and arrive early enough for the other flip-flop's setup time (${sn(p.ext)} ns).`,
    `That reserved time is the OUTPUT DELAY (max): ${sn(p.wire + p.ext)} ns. Your part must finish before it begins.`
  ],
  base: { T: 10, tcq: 1 },
  calc(p) { return STA_CALC.outputPath({ T: this.base.T, tcq: this.base.tcq, comb: p.comb, odly: STA_CALC.outputDelay({ tsu: p.ext, wireMax: p.wire }).max }); },
  result(p) {
    const r = this.calc(p), od = p.wire + p.ext;
    return verdict(r.slack >= -1e-9, `Output delay ${sn(od)} ns means your data must be at the port by ${sn(this.base.T - od)} ns. It gets there at ${sn(this.base.tcq + p.comb)} ns. Slack ${sn(r.slack)} ns (10 ns clock).`);
  },
  code: p => [`set_output_delay -max ${sn(p.wire + p.ext)} -clock clk [get_ports dout]`, '# -min = SHORTEST board delay minus the outside flip-flop\'s hold time (it can be negative)'],
  draw(t, p) {
    const k = Math.min(3, Math.floor(t)), od = p.wire + p.ext, r = this.calc(p), here = this.base.tcq + p.comb;
    let s = sx.rect(8, 24, 302, 108, 'sx-chip', 14) + sx.t(20, 40, 'YOUR CHIP', 'sx-s sx-b') + sx.rect(442, 24, 190, 108, 'sx-chip', 14) + sx.t(456, 40, 'OTHER CHIP', 'sx-s sx-b');
    s += sx.line(94, 92, 516, 92, 'sx-wire') + sx.ff(32, 68, 'your FF', k === 0) + sx.cloud(150, 70, 90, 44, 'logic', k === 1) + sx.dot(310, 92, 'sx-port', 9) + sx.t(318, 118, 'dout', 'sx-s sx-b') + sx.t(378, 80, 'board wire', 'sx-s', 'middle') + sx.ff(516, 68, 'FF in', k >= 2);
    const at = k === 0 ? [94, 92] : k === 1 ? sx.along([[94, 92], [310, 92]], ph(t, 1)) : k === 2 ? sx.along([[310, 92], [516, 92]], ph(t, 2)) : [516, 92];
    s += sx.dot(at[0], at[1], 'sx-dot', 10);
    const end = Math.max(this.base.T, here + od) + 0.5, X = v => 40 + v * (556 / end);
    if (k >= 1) s += sx.bar(X, 0, this.base.tcq, 164, 'sx-bar-q', 'tcq') + sx.bar(X, this.base.tcq, here, 164, r.slack >= -1e-9 ? 'sx-bar-logic' : 'sx-bar-bad', 'your logic');
    if (k >= 2) s += sx.bar(X, this.base.T - od, this.base.T - p.ext, 204, 'sx-bar-ext', 'board') + sx.bar(X, this.base.T - p.ext, this.base.T, 204, 'sx-bar-su', 'setup');
    if (k >= 3) s += span(X(this.base.T - od), X(this.base.T), 240, 'sx-arc-h') + sx.t(X(this.base.T - od) - 8, 245, `output delay ${sn(od)} ns`, 'sx-s sx-b', 'end');
    s += sx.axis(X, 262, Math.floor(end), end > 14 ? 2 : 1);
    const guides = sx.guides(X, [0, this.base.T], 154, 272, 'a') + sx.guides(X, [here, this.base.T - od], 154, 272, 'b');
    return sx.svg(312, guides + s + sx.key(300, [['a', 'clock edge'], ['b', 'data at port / latest allowed']]));
  },
  explain: {
    what: '<b>Output delay</b> tells STA how much time the outside world needs <b>after</b> your output port, measured against a clock edge. For setup (<code>-max</code>) it is usually the longest board delay plus the receiving device\'s <b>setup time</b>. It is a constraint: a reservation, not delay hardware in your chip.',
    analogy: 'A letter must be at the office by 5 pm, and the post takes 2 hours. So you must post it by 3 pm. The 2 hours are not your work, but you must leave room for them.',
    when: ['On every output port whose data another device or block captures with a clock.', 'When your design\'s output feeds a block that will be connected later.'],
    why: ['<b>Without it, the tool does not know your output has a deadline</b>, so the path is not properly checked.', 'It stops your internal logic from using time the outside world needs.', 'If a long output path fails, a common fix is to <b>register the output</b> so that almost no logic sits between the last flip-flop and the port.'],
    change: ['<code>-max</code> = longest board delay + the receiver\'s setup time. Used for <b>setup</b>.', '<code>-min</code> = shortest board delay − the receiver\'s hold time. Used for <b>hold</b>. It is often <b>negative</b>, and that is normal.', 'Values come from the receiver\'s datasheet and the board design, including clock differences between the chips.'],
    sta: ['Setup slack for this path: <code>(T + skew − output delay − uncertainty) − (tcq + logic)</code>. The demo uses zero skew and uncertainty.', 'In a report, the required time includes a line such as <code>output external delay</code>.', 'Tools often add an external load too (SDC: <code>set_load</code>), because the outside wire affects your last gate\'s delay.']
  },
  points: ['<b>Input</b> delay is time already used. <b>Output</b> delay is time still needed.', 'The sign of <code>-min</code> surprises many beginners: the hold time is <b>subtracted</b>.', 'The demo assumes both chips get the same clock edge at the same moment.'],
  remember: 'Output delay = time you must leave free for the outside world.',
  quiz: { q: 'The receiver needs 1.5 ns setup and the board wire takes up to 1 ns. What is set_output_delay -max?', options: ['0.5 ns', '2.5 ns', '1.5 ns'], answer: 1, why: 'Both happen after your port: 1 + 1.5 = 2.5 ns.' }
});

/* ---------- 12. path delay ---------- */
lesson({
  id: 'delays', group: DELAY_GROUP, icon: '🏔️', title: 'Path delay: slowest and fastest',
  idea: 'Between two flip-flops there are many routes. The slowest one matters for setup, the fastest one for hold.',
  params: [R('g', 'Delay of each gate', 0.5, 3, 0.1, 2), R('n', 'Delay of the shortcut', 0.2, 3, 0.1, 0.6), R('tcq', 'Clock-to-Q', 0.2, 2, 0.1, 0.8)],
  dur: p => p.tcq + Math.max(3 * p.g, p.n) + 1.5,
  result: p => verdict(true, `Longest path (max delay) = ${sn(p.tcq + Math.max(3 * p.g, p.n))} ns, used for SETUP. Shortest path (min delay) = ${sn(p.tcq + Math.min(3 * p.g, p.n))} ns, used for HOLD.`),
  say(t, p) {
    const fast = p.tcq + Math.min(3 * p.g, p.n), slow = p.tcq + Math.max(3 * p.g, p.n);
    return t < p.tcq ? 'Both signals leave the same flip-flop.' : t < fast ? 'The two signals take different routes…' : t < slow ? 'The quick one has arrived: it could disturb the HOLD window.' : 'The slow one has arrived: it decides how fast the clock can be.';
  },
  draw(t, p) {
    const long = 3 * p.g, tmax = this.dur(p), X = v => 70 + v * (520 / tmax);
    const top = [[112, 92], [160, 92], [180, 60], [470, 60], [500, 92], [528, 92]], bot = [[112, 92], [160, 92], [180, 142], [470, 142], [500, 92], [528, 92]];
    const slowTop = long >= p.n;
    const a = sx.along(top, (t - p.tcq) / long), b = sx.along(bot, (t - p.tcq) / p.n);
    let s = sx.ff(50, 66, 'FF 1') + sx.ff(528, 66, 'FF 2') + sx.poly(top, 'sx-wire' + (slowTop ? ' sx-slow' : '')) + sx.poly(bot, 'sx-wire' + (slowTop ? '' : ' sx-slow'));
    [200, 295, 390].forEach(x => s += sx.cloud(x, 38, 66, 44, `${sn(p.g)}`));
    s += sx.cloud(260, 120, 120, 44, `shortcut ${sn(p.n)}`) + sx.dot(a[0], a[1], 'sx-dot') + sx.dot(b[0], b[1], 'sx-dot sx-alt');
    s += sx.t(14, 214, 'top', 'sx-b') + sx.bar(X, 0, p.tcq, 196, 'sx-bar-q', 'tcq') + sx.bar(X, p.tcq, p.tcq + long, 196, 'sx-bar-logic', `${sn(long)} ns`)
      + sx.t(14, 250, 'short', 'sx-b') + sx.bar(X, 0, p.tcq, 232, 'sx-bar-q', 'tcq') + sx.bar(X, p.tcq, p.tcq + p.n, 232, 'sx-bar-alt', `${sn(p.n)} ns`)
      + sx.axis(X, 272, tmax, 1) + sx.cursor(X(t), 188, 268);
    return sx.svg(298, s);
  },
  explain: {
    what: '<b>Path delay</b> is the total of all the delays from a path\'s <b>start point</b> to its <b>end point</b>. Between the same two flip-flops there can be many routes, so STA keeps two totals: the <b>longest (max)</b> and the <b>shortest (min)</b>.',
    analogy: 'Several roads join your home and your office. To be sure you are never late, plan with the slowest road. To know how early someone could possibly arrive, look at the fastest one.',
    when: ['On every timing path: register to register, input to register, register to output, and input to output.', 'Routes split and join inside logic, so one pair of flip-flops can be connected in many ways.'],
    why: ['The path with the least setup slack is usually called the <b>critical path</b>. It limits the clock speed.', 'The shortest routes are where <b>hold</b> problems hide.', 'Fixing only the worst path may reveal the next worst, so reports list many paths.'],
    change: ['<b>To shorten the longest path</b>: fewer logic levels, faster or better-sized cells, shorter wires, or a <b>pipeline</b> flip-flop that splits it in two.', '<b>To lengthen the shortest path</b> (for hold): add delay cells.', 'The aim is to fix one without breaking the other.'],
    sta: ['STA does not try every input pattern. It tracks the <b>latest</b> and <b>earliest</b> arrival time at each pin and adds delays along the connections.', 'Because it ignores logic values, it can report a path that can never really happen: a <b>false path</b>.', '<code>set_max_delay</code> and <code>set_min_delay</code> can set your own limits on particular paths.']
  },
  points: ['<b>Cell delay</b> is the time through a gate. <b>Net delay</b> is the time along the wire.',
    'The <b>critical path</b> is the one with the worst timing. It limits the clock speed.',
    'STA keeps two numbers for every pin: the <b>latest</b> (max) and <b>earliest</b> (min) time a signal can arrive.',
    'Real delays depend on input slew (how sharp the edge is) and output load. Libraries (.lib) store them in tables.'],
  remember: 'Setup fears the slowest runner. Hold fears the fastest one.',
  quiz: { q: 'Which delay does a HOLD check use?', options: ['The maximum (longest) path delay', 'The minimum (shortest) path delay', 'The average delay'], answer: 1, why: 'Hold fails when new data arrives too early, so the fastest route is the dangerous one.' }
});

/* ================================ LEVEL 3: THE CORE CHECKS ================================ */
const stackRows = (X, rows) => rows.map(r => sx.t(10, r.y + 18, r.name, 'sx-b') + r.parts.filter(q => Math.abs(q[1] - q[0]) > 0.001).map(q => sx.bar(X, q[0], q[1], r.y, q[2], q[3])).join('')).join('');
const slackMark = (X, a, b, y, slack) => sx.rect(X(Math.min(a, b)), y, Math.max(2, Math.abs(X(b) - X(a))), 16, slack >= -1e-9 ? 'sx-slack-ok' : 'sx-slack-bad', 4)
  + sx.t((X(a) + X(b)) / 2, y + 34, `slack ${slack >= 0 ? '+' : ''}${sn(slack)} ns`, slack >= -1e-9 ? 'sx-b sx-ok-t' : 'sx-b sx-bad-t', 'middle');

lesson({
  id: 'setup-slack', group: '3 · Core checks', icon: '📏', title: 'Setup check and slack',
  idea: 'Slack = required time − arrival time. Positive means the path passes.',
  params: [R('T', 'Clock period', 4, 14, 0.25, 10), R('comb', 'Longest logic delay', 1, 12, 0.25, 6), R('tcq', 'Clock-to-Q (max)', 0.25, 3, 0.25, 1), R('tsu', 'Setup time', 0.25, 3, 0.25, 1), R('skew', 'Clock skew', -2, 2, 0.25, 0), R('unc', 'Clock uncertainty', 0, 1.5, 0.25, 0.25)],
  dur: () => 8,
  result(p) {
    const r = STA_CALC.setup(p), tmin = STA_CALC.minPeriod(p);
    return verdict(r.slack >= -1e-9, `Slack = ${sn(r.required)} − ${sn(r.arrival)} = ${sn(r.slack)} ns (${r.slack >= -1e-9 ? 'MET' : 'VIOLATED'}). Smallest period = ${sn(tmin)} ns, so Fmax = ${sn(STA_CALC.fmaxMHz(tmin))} MHz.`);
  },
  say: t => t < 2.7 ? 'Step 1: ARRIVAL time. Add clock-to-Q and the longest logic delay.' : t < 5.4 ? 'Step 2: REQUIRED time. Start from the next clock edge (plus skew), then take away setup and uncertainty.' : 'Step 3: SLACK is the gap between them.',
  draw(t, p) {
    const r = STA_CALC.setup(p), cap = p.T + p.skew, tmax = Math.ceil(Math.max(r.arrival, cap, p.T) + 1), X = v => 96 + v * (504 / tmax);
    let s = sx.axis(X, 216, tmax, tmax > 16 ? 2 : 1) + sx.line(X(p.T), 20, X(p.T), 216, 'sx-edge') + sx.t(X(p.T), 16, `period ${sn(p.T)}`, 'sx-s sx-b', 'middle');
    s += stackRows(X, [{ y: 44, name: 'Arrival', parts: [[0, p.tcq, 'sx-bar-q', 'tcq'], [p.tcq, r.arrival, 'sx-bar-logic', `logic ${sn(p.comb)}`]] }]) + sx.t(X(r.arrival), 38, sn(r.arrival), 'sx-b', 'middle');
    if (t >= 2.7) {
      s += sx.t(10, 122, 'Required', 'sx-b') + sx.bar(X, 0, Math.max(0, r.required), 104, 'sx-bar-req', sn(r.required))
        + (p.unc ? sx.bar(X, r.required, r.required + p.unc, 104, 'sx-bar-unc', 'unc') : '') + sx.bar(X, r.required + p.unc, cap, 104, 'sx-bar-su', 'tsu')
        + sx.t(X(cap), 148, `capture edge ${sn(cap)}`, 'sx-s', 'middle');
    }
    if (t >= 5.4) s += sx.line(X(r.arrival), 70, X(r.arrival), 178, 'sx-guide') + sx.line(X(r.required), 130, X(r.required), 178, 'sx-guide') + slackMark(X, r.arrival, r.required, 168, r.slack);
    return sx.svg(248, s + (t < 8 ? sx.cursor(X(tmax * Math.min(1, (t % 2.7) / 2.4)), 30, 210) : ''));
  },
  points: ['<b>Arrival</b> = launch edge + tcq + longest logic and wire delay.',
    '<b>Required</b> = capture edge (one period later) + skew − tsu − uncertainty.',
    '<b>Setup slack = required − arrival.</b> Negative slack is a violation.',
    '<b>Fmax</b> comes from the smallest period with zero slack: Tmin = tcq + logic + tsu + uncertainty − skew.',
    '<b>WNS</b> (worst negative slack) is the single worst path. <b>TNS</b> (total negative slack) adds up the failing end points.'],
  remember: 'Setup slack: REQUIRED minus ARRIVAL. "Did I arrive before the deadline?"',
  quiz: { q: 'tcq = 1, logic = 5, tsu = 0.5, no skew or uncertainty. What is the smallest clock period?', options: ['5.5 ns', '6 ns', '6.5 ns'], answer: 2, why: '1 + 5 + 0.5 = 6.5 ns.' }
});

lesson({
  id: 'hold-slack', group: '3 · Core checks', icon: '✋', title: 'Hold check',
  idea: 'New data must not rush through and disturb the capture flip-flop on the SAME edge.',
  params: [R('combMin', 'Shortest logic delay', 0, 3, 0.1, 0.6), R('tcqMin', 'Clock-to-Q (min)', 0.1, 1.5, 0.1, 0.4), R('th', 'Hold time', 0.1, 2, 0.1, 0.6), R('skew', 'Clock skew', -1, 2, 0.1, 0.2), R('T', 'Clock period (try it!)', 4, 20, 1, 10)],
  dur: () => 8,
  result(p) {
    const r = STA_CALC.hold(p);
    return verdict(r.slack >= -1e-9, `Hold slack = ${sn(r.arrival)} − ${sn(r.required)} = ${sn(r.slack)} ns (${r.slack >= -1e-9 ? 'MET' : 'VIOLATED'}). The clock period (${p.T} ns) is not in this formula.`);
  },
  say: t => t < 2.7 ? 'The SAME edge that captures the old data also launches new data.' : t < 5.4 ? 'The old data must stay until the capture edge (plus skew) and the hold time have passed.' : 'Hold slack = earliest arrival − required. Now change the clock period: nothing happens!',
  draw(t, p) {
    const r = STA_CALC.hold(p), tmax = Math.max(4, Math.ceil(Math.max(r.arrival, r.required) + 1)), X = v => 120 + v * (470 / tmax);
    let s = sx.axis(X, 216, tmax, 1) + sx.line(X(0), 20, X(0), 216, 'sx-edge') + sx.t(X(0), 16, 'same edge', 'sx-s sx-b', 'middle');
    s += stackRows(X, [{ y: 48, name: 'New data', parts: [[0, p.tcqMin, 'sx-bar-q', 'tcq'], [p.tcqMin, r.arrival, 'sx-bar-alt', 'logic']] }]) + sx.t(X(r.arrival) + 6, 66, `arrives ${sn(r.arrival)}`, 'sx-s sx-b');
    if (t >= 2.7) s += sx.t(10, 122, 'Keep old until', 'sx-b') + (p.skew > 0 ? sx.bar(X, 0, p.skew, 104, 'sx-bar-skew', 'skew') : '') + sx.bar(X, p.skew, r.required, 104, 'sx-bar-h', 'th') + sx.t(X(Math.max(r.required, 0)) + 6, 122, sn(r.required), 'sx-s sx-b');
    if (t >= 5.4) s += sx.line(X(r.arrival), 74, X(r.arrival), 178, 'sx-guide') + sx.line(X(r.required), 130, X(r.required), 178, 'sx-guide') + slackMark(X, r.required, r.arrival, 168, r.slack);
    return sx.svg(248, s);
  },
  points: ['<b>Hold slack = earliest arrival − required.</b> (The order is the opposite of setup.)',
    'Required = skew + hold time (+ hold uncertainty).',
    'In a normal check, where one edge both launches and captures, the <b>clock period does not appear</b>. Slowing the clock cannot fix that hold violation. (Half-cycle paths, and multicycle paths without <code>-hold</code>, are different.)',
    'Because changing the frequency does not help, a real hold violation can make a chip unusable, so hold must be clean before tape-out.'],
  remember: 'Setup can be fixed by slowing down. Hold cannot, so a hold bug is very serious.',
  quiz: { q: 'A fabricated chip has a hold violation. Can you make it work by lowering the clock frequency?', options: ['Yes', 'No', 'Only if you lower it a lot'], answer: 1, why: 'Both events happen at the same clock edge, so the period makes no difference.' }
});

lesson({
  id: 'skew', group: '3 · Core checks', icon: '🌳', title: 'Clock skew and jitter',
  idea: 'The clock reaches different flip-flops at slightly different times, and its edges wobble.',
  params: [R('lc', 'Clock delay to FF 1 (launch)', 0, 3, 0.1, 1), R('cc', 'Clock delay to FF 2 (capture)', 0, 3, 0.1, 2), R('jit', 'Clock jitter (setup only)', 0, 1, 0.1, 0.2)],
  dur: () => 6,
  base: { T: 10, tcq: 1, comb: 8, tsu: 0.8, tcqMin: 0.5, combMin: 0.5, th: 0.6 },
  calc(p) { const b = this.base, skew = Math.round((p.cc - p.lc) * 100) / 100; return { skew, su: STA_CALC.setup({ ...b, skew, unc: p.jit }), ho: STA_CALC.hold({ ...b, skew }) }; },
  result(p) {
    const c = this.calc(p), ok = c.su.slack >= -1e-9 && c.ho.slack >= -1e-9;
    return verdict(ok, `Skew = capture − launch = ${sn(c.skew)} ns. Setup slack ${sn(c.su.slack)} ns, hold slack ${sn(c.ho.slack)} ns.`);
  },
  say: (t, p) => p.cc > p.lc ? 'The clock reaches FF 2 LATER: more time for setup, but harder for hold.' : p.cc < p.lc ? 'The clock reaches FF 2 EARLIER: less time for setup, but easier for hold.' : 'Both flip-flops get the clock together: zero skew.',
  draw(t, p) {
    const c = this.calc(p), now = (t % 6) / 6 * 3.6;      // how far the clock edge has travelled, in ns
    // clock source splits into two branches; each branch ends at the clock pin (the triangle) of a flip-flop
    let s = sx.dot(44, 182, 'sx-port', 12) + sx.t(44, 158, 'clock', 'sx-s sx-b', 'middle') + sx.line(56, 182, 120, 182, 'sx-clk') + sx.line(120, 122, 120, 242, 'sx-clk');
    const branch = (y, d, name) => {
      const k = Math.min(1, now / Math.max(0.01, d));
      const at = sx.along([[120, y], [501, y], [501, y - 18]], k);
      return sx.poly([[120, y], [501, y], [501, y - 18]], 'sx-clk') + sx.cloud(200, y - 18, 150, 36, `buffers ${sn(d)} ns`) + sx.ff(470, y - 92, '', now >= d) + sx.t(458, y - 48, name, 'sx-s sx-b', 'end') + sx.dot(at[0], at[1], 'sx-dot sx-ck', 8);
    };
    s += branch(122, p.lc, 'FF 1 (launch)') + branch(242, p.cc, 'FF 2 (capture)');
    s += sx.poly([[532, 54], [608, 54], [608, 136], [440, 136], [440, 174], [470, 174]], 'sx-wire') + sx.t(600, 106, 'data', 'sx-s sx-b', 'end');
    const meter = (y, name, v) => { const mid = 330, w = Math.min(240, Math.abs(v) * 70); return sx.t(20, y + 15, name, 'sx-b') + sx.rect(v >= 0 ? mid : mid - w, y, w, 20, v >= -1e-9 ? 'sx-slack-ok' : 'sx-slack-bad', 4) + sx.t(v >= 0 ? mid + w + 8 : mid - w - 8, y + 15, `${v >= 0 ? '+' : ''}${sn(v)} ns`, 'sx-b', v >= 0 ? 'start' : 'end'); };
    s += sx.line(330, 262, 330, 320, 'sx-axis') + meter(266, 'Setup slack', c.su.slack) + meter(296, 'Hold slack', c.ho.slack);
    return sx.svg(326, s);
  },
  points: ['<b>Skew</b> = capture clock arrival − launch clock arrival.',
    '<b>Positive skew</b> helps setup and hurts hold. <b>Negative skew</b> does the opposite.',
    '<b>Jitter</b> is the edge moving from cycle to cycle. It goes into <b>setup uncertainty</b>, because setup compares two different edges. A normal hold check uses the <b>same edge</b>, so period jitter is usually left out.',
    '<b>Clock uncertainty</b> also holds safety margin (and estimated skew before the clock tree is built). Setup and hold usually get different values: <code>set_clock_uncertainty -setup</code> and <code>-hold</code>.',
    'Clock tree synthesis (CTS) builds the buffer tree that keeps skew under control.'],
  remember: 'A late capture clock is a gift to setup and a punishment for hold.',
  quiz: { q: 'You delay the clock to the capture flip-flop. What happens?', options: ['Setup and hold both improve', 'Setup improves, hold gets worse', 'Hold improves, setup gets worse'], answer: 1, why: 'Data gets more time to arrive, but old data must also be held longer.' }
});

const RPT = T => {
  const rows = [
    { k: 'lclk', d: 'clock clk (rise edge)', i: 0.00, seg: 0 }, { k: 'lnet', d: 'clock network delay', i: 0.40, seg: 0 },
    { k: 'ck', d: 'u_ff1/CK (DFF)', i: 0.00, seg: 1 }, { k: 'q', d: 'u_ff1/Q (DFF)', i: 0.35, seg: 1 },
    { k: 'g1', d: 'u_and/Y (AND2)', i: 0.22, seg: 2 }, { k: 'g2', d: 'u_xor/Y (XOR2)', i: 0.31, seg: 3 }, { k: 'g3', d: 'u_add/S (full adder)', i: 0.58, seg: 4 }, { k: 'dpin', d: 'u_ff2/D (DFF)', i: 0.00, seg: 5 }];
  let sum = 0; rows.forEach(r => { sum = Math.round((sum + r.i) * 100) / 100; r.p = sum; });
  const req = [{ d: 'clock clk (rise edge)', i: T, seg: 6 }, { d: 'clock network delay', i: 0.45, seg: 6 }, { d: 'clock uncertainty', i: -0.10, seg: 6 }, { d: 'library setup time', i: -0.12, seg: 5 }];
  let q = 0; req.forEach(r => { q = Math.round((q + r.i) * 100) / 100; r.p = q; });
  return { rows, req, arrival: sum, required: q, slack: Math.round((q - sum) * 100) / 100 };
};
lesson({
  id: 'report', group: '3 · Core checks', icon: '📄', title: 'Reading a timing report',
  idea: 'A report is the same race written as a table: add up the arrival, then the required time, then subtract.',
  params: [R('T', 'Clock period', 1.5, 3, 0.05, 2)], dur: () => 13, report: RPT,
  result(p) { const r = RPT(p.T); return verdict(r.slack >= -1e-9, `slack (${r.slack >= -1e-9 ? 'MET' : 'VIOLATED'}) = ${r.required.toFixed(2)} − ${r.arrival.toFixed(2)} = ${r.slack.toFixed(2)} ns`); },
  say(t, p) {
    const i = Math.floor(t), r = RPT(p.T);
    if (i < r.rows.length) return `Arrival line ${i + 1}: "${r.rows[i].d}" adds ${r.rows[i].i.toFixed(2)} ns.`;
    if (i < r.rows.length + r.req.length) return `Required line: "${r.req[i - r.rows.length].d}" adds ${r.req[i - r.rows.length].i.toFixed(2)} ns.`;
    return 'Last line: slack = required − arrival.';
  },
  draw(t, p) {
    const r = RPT(p.T), i = Math.floor(t), all = [...r.rows, ...r.req], cur = all[i], seg = cur ? cur.seg : -1;
    let s = sx.ff(20, 22, 'u_ff1', seg === 1) + sx.cloud(124, 38, 82, 40, 'and', seg === 2) + sx.cloud(244, 38, 82, 40, 'xor', seg === 3) + sx.cloud(364, 38, 90, 40, 'adder', seg === 4) + sx.ff(500, 22, 'u_ff2', seg === 5);
    [[82, 124], [206, 244], [326, 364], [454, 500]].forEach(a => s += sx.line(a[0], 58, a[1], 58, 'sx-wire'));
    s += sx.line(51, 124, 531, 124, seg === 0 || seg === 6 ? 'sx-route' : 'sx-clk') + sx.line(51, 124, 51, 96, 'sx-clk') + sx.line(531, 124, 531, 96, 'sx-clk') + sx.t(290, 140, seg === 0 ? 'launch clock path' : seg === 6 ? 'capture clock path' : 'clock', 'sx-s sx-b', 'middle');
    let y = 168; const row = (d, a, b, on, cls = '') => { s += (on ? sx.rect(20, y - 14, 600, 19, 'sx-hl', 4) : '') + sx.t(28, y, d, 'sx-mono ' + cls) + sx.t(520, y, a, 'sx-mono ' + cls, 'end') + sx.t(612, y, b, 'sx-mono ' + cls, 'end'); y += 19; };
    row('Startpoint: u_ff1   Endpoint: u_ff2   Path type: max (setup)', '', '', false, 'sx-b');
    row('point', 'incr', 'path', false, 'sx-b');
    r.rows.forEach((l, n) => row(l.d, l.i.toFixed(2), l.p.toFixed(2), n === i));
    row('data arrival time', '', r.arrival.toFixed(2), i >= r.rows.length - 1 && i < r.rows.length, 'sx-b'); y += 6;
    r.req.forEach((l, n) => row(l.d, l.i.toFixed(2), l.p.toFixed(2), n + r.rows.length === i));
    row('data required time', '', r.required.toFixed(2), false, 'sx-b');
    row(`slack (${r.slack >= -1e-9 ? 'MET' : 'VIOLATED'})`, '', r.slack.toFixed(2), i >= all.length, r.slack >= -1e-9 ? 'sx-b sx-ok-t' : 'sx-b sx-bad-t');
    return sx.svg(y + 4, s);
  },
  points: ['<b>incr</b> is the delay added by that line. <b>path</b> is the running total.',
    '"Path type: <b>max</b>" is a setup report. "<b>min</b>" is a hold report.',
    'Look for the biggest <b>incr</b> values first: that is where the time goes.',
    'This is a simplified example in the style of tools like OpenSTA and PrimeTime. Real reports have more columns.'],
  remember: 'Read it in three blocks: ARRIVAL (top), REQUIRED (bottom), SLACK (last line).',
  quiz: { q: 'In a report, data arrival time is 3.20 and data required time is 3.05. What is the slack?', options: ['+0.15 (met)', '−0.15 (violated)', '6.25'], answer: 1, why: 'Setup slack = required − arrival = 3.05 − 3.20 = −0.15.' }
});

lesson({
  id: 'fixing', group: '3 · Core checks', icon: '🔧', title: 'Fixing violations',
  idea: 'To fix setup, make the slow path faster or give it more time. To fix hold, make the fast path slower.',
  params: [], dur: () => 1,
  toggles: [['logic', 'Setup: simplify the logic'], ['cells', 'Setup: faster (bigger) cells'], ['pipe', 'Setup: add a pipeline stage'], ['skew', 'Setup: useful skew +1 ns'], ['slow', 'Slow the clock +4 ns'], ['buf', 'Hold: add delay buffer']],
  base: { T: 10, tcq: 1, comb: 10.5, tsu: 1, tcqMin: 0.5, combMin: 0.2, th: 0.6, skew: 0.3 },
  calc(p) { return STA_CALC.fixes({ ...this.base, on: p }); },
  result(p) {
    const c = this.calc(p), ok = c.setup.slack >= -1e-9 && c.hold.slack >= -1e-9;
    const note = p.pipe ? ' Pipelining adds one clock cycle of latency, and the logic must really be splittable.' : p.skew ? ' Useful skew borrows time from the next stage, and it made hold worse here.' : '';
    return verdict(ok, `Setup slack ${sn(c.setup.slack)} ns, hold slack ${sn(c.hold.slack)} ns. ${ok ? 'Both checks pass!' : 'Keep fixing.'}${note}`);
  },
  say: () => 'This design fails BOTH checks. Switch the fixes on and off and watch the two bars.',
  draw(t, p) {
    const c = this.calc(p), meter = (y, name, v) => { const mid = 330, w = Math.min(250, Math.abs(v) * 34); return sx.t(20, y + 21, name, 'sx-b') + sx.rect(v >= 0 ? mid : mid - w, y, Math.max(2, w), 30, v >= -1e-9 ? 'sx-slack-ok' : 'sx-slack-bad', 6) + sx.t(v >= 0 ? mid + w + 10 : mid + 10, y + 21, `${v >= 0 ? '+' : ''}${sn(v)} ns ${v >= -1e-9 ? '✓' : '✗'}`, 'sx-b'); };
    let s = sx.t(330, 22, '0 (limit)', 'sx-s sx-b', 'middle') + sx.line(330, 30, 330, 124, 'sx-axis') + meter(38, 'Setup', c.setup.slack) + meter(84, 'Hold', c.hold.slack);
    // the long path and the short path each get their own row, so nothing overlaps
    s += sx.t(20, 192, 'Long path', 'sx-b') + sx.line(182, 188, 532, 188, 'sx-wire') + sx.ff(120, 164, '') + sx.ff(532, 164, '');
    if (p.pipe) s += sx.cloud(200, 168, 104, 40, `${sn(c.comb)} ns`) + sx.ff(326, 164, 'new FF', true) + sx.cloud(410, 168, 104, 40, `${sn(c.comb)} ns`);
    else s += sx.cloud(240, 166, 230, 44, `logic ${sn(c.comb)} ns`);
    s += sx.t(20, 296, 'Short path', 'sx-b') + sx.line(182, 292, 532, 292, 'sx-wire') + sx.ff(120, 268, '') + sx.ff(532, 268, '')
      + sx.cloud(p.buf ? 205 : 295, 272, 120, 40, 'logic 0.2') + (p.buf ? sx.cloud(358, 272, 140, 40, '+ buffer 0.4', true) : '');
    return sx.svg(352, s);
  },
  points: ['<b>Setup fixes:</b> restructure logic, use faster or lower-Vt cells, resize, shorten wires, pipeline, or relax the clock.',
    '<b>Hold fixes:</b> add delay (buffers) <b>only on the short path</b>, so the long path is not slowed.',
    '<b>Useful skew</b> can rescue a setup path, but check the hold paths and the next stage.',
    'After layout, small targeted changes are called an <b>ECO</b> (engineering change order). Re-run STA after every fix.'],
  remember: 'Setup: speed up or wait longer. Hold: slow the fast one down.',
  quiz: { q: 'Which change fixes a hold violation?', options: ['A slower clock', 'A delay buffer in the short path', 'Faster cells in the short path'], answer: 1, why: 'The new data needs to arrive later.' }
});

lesson({
  id: 'sdc', group: '3 · Core checks', icon: '📝', title: 'Constraints (SDC)',
  idea: 'STA only knows what you tell it. SDC commands describe the clock and the world outside the chip.',
  params: [R('T', 'Clock period', 5, 20, 1, 10), R('idly', 'Outside delay before IN', 0, 9, 0.5, 4), R('odly', 'Outside time needed after OUT', 0, 9, 0.5, 3)],
  dur: () => 6, base: { tsu: 0.8, tcq: 1, unc: 0.2 },
  budgets(p) { const b = this.base; return { input: p.T - p.idly - b.tsu - b.unc, output: p.T - p.odly - b.tcq - b.unc }; },
  result(p) {
    const b = this.budgets(p), ok = b.input > 0 && b.output > 0;
    return verdict(ok, `Inside the chip, the input logic may take ${sn(b.input)} ns and the output logic ${sn(b.output)} ns (after the flip-flop times and ${this.base.unc} ns uncertainty).${ok ? '' : ' There is no time left: the constraints cannot be met.'}`);
  },
  code: p => [`create_clock -name clk -period ${sn(p.T)} [get_ports clk]`, `set_clock_uncertainty 0.2 [get_clocks clk]`, `set_input_delay  -max ${sn(p.idly)} -clock clk [get_ports din]`, `set_input_delay  -min 0.5 -clock clk [get_ports din]`, `set_output_delay -max ${sn(p.odly)} -clock clk [get_ports dout]`, `set_output_delay -min -0.3 -clock clk [get_ports dout]`],
  say: t => t < 3 ? 'INPUT: the outside world uses part of the clock period before the signal even enters.' : 'OUTPUT: the outside world needs part of the period after the signal leaves.',
  draw(t, p) {
    const b = this.budgets(p), X = v => 110 + v * (480 / p.T);
    let s = sx.t(14, 40, 'Input path', 'sx-b') + sx.bar(X, 0, p.idly, 50, 'sx-bar-ext', 'outside') + sx.bar(X, p.idly, p.idly + Math.max(0, b.input), 50, b.input > 0 ? 'sx-bar-logic' : 'sx-bar-bad', 'inside') + sx.bar(X, p.T - this.base.unc - this.base.tsu, p.T - this.base.unc, 50, 'sx-bar-su', 'tsu') + sx.bar(X, p.T - this.base.unc, p.T, 50, 'sx-bar-unc', 'unc');
    s += sx.t(14, 118, 'Output path', 'sx-b') + sx.bar(X, 0, this.base.tcq, 128, 'sx-bar-q', 'tcq') + sx.bar(X, this.base.tcq, this.base.tcq + Math.max(0, b.output), 128, b.output > 0 ? 'sx-bar-logic' : 'sx-bar-bad', 'inside') + sx.bar(X, p.T - this.base.unc - p.odly, p.T - this.base.unc, 128, 'sx-bar-ext', 'outside') + sx.bar(X, p.T - this.base.unc, p.T, 128, 'sx-bar-unc', 'unc');
    s += sx.axis(X, 178, p.T, p.T > 12 ? 2 : 1) + sx.line(X(p.T), 22, X(p.T), 178, 'sx-edge') + sx.t(X(p.T), 18, 'next edge', 'sx-s sx-b', 'middle') + sx.cursor(X((t % 3) / 3 * p.T), t < 3 ? 46 : 124, t < 3 ? 80 : 158);
    return sx.svg(204, s);
  },
  points: ['<b>create_clock</b> is the most important line. Without it, register paths are not checked.',
    '<b>set_input_delay -max</b> is the latest the outside data arrives. <b>-min</b> is the earliest (used for hold).',
    '<b>set_output_delay -max</b> is the outside logic plus the outside flip-flop\'s setup. <b>-min</b> is the shortest outside delay minus that flip-flop\'s hold time, so it is often negative.',
    'After synthesis and layout, always check that no path is left <b>unconstrained</b>.'],
  remember: 'Unconstrained means unchecked. A clean report with missing constraints proves nothing.',
  quiz: { q: 'Period is 10 ns, input delay (max) is 6 ns, setup is 0.5 ns, with no skew or uncertainty. How long may the logic before the first flip-flop take?', options: ['3.5 ns', '4 ns', '10 ns'], answer: 0, why: '10 − 6 − 0.5 = 3.5 ns.' }
});

/* ================================ LEVEL 4: ADVANCED ================================ */
lesson({
  id: 'exceptions', group: '4 · Advanced', icon: '🚦', title: 'False and multicycle paths',
  idea: 'Some paths don\'t need to finish in one cycle. You must tell STA, and tell it correctly.',
  options: [{ k: 'mode', label: 'Constraint', def: 'one', choices: [['one', 'Normal (1 cycle)'], ['setup2', '-setup 2 only ⚠️'], ['both', '-setup 2  and  -hold 1']] }],
  params: [R('d', 'Longest path delay', 2, 19, 0.5, 15), R('dmin', 'Shortest path delay', 0.5, 12, 0.5, 2)],
  dur: () => 6, base: { T: 10, tcq: 1, tsu: 0.8, tcqMin: 0.5, th: 0.6 },
  calc(p) {
    const b = this.base, e = STA_CALC.mcpEdges(p.mode, b.T);
    return { ...e, setupSlack: e.setupEdge - b.tsu - (b.tcq + p.d), holdSlack: (b.tcqMin + p.dmin) - (e.holdEdge + b.th) };
  },
  result(p) {
    const c = this.calc(p), ok = c.setupSlack >= -1e-9 && c.holdSlack >= -1e-9;
    return verdict(ok, `Setup is checked at ${c.setupEdge} ns (slack ${sn(c.setupSlack)}). Hold is checked at ${c.holdEdge} ns (slack ${sn(c.holdSlack)}).`);
  },
  code: p => p.mode === 'one' ? ['# no exception: setup at the next edge, hold at the launch edge'] : p.mode === 'setup2' ? ['set_multicycle_path 2 -setup -from [get_cells u_ff1] -to [get_cells u_ff2]', '# the hold check moved too: usually NOT what you want'] : ['set_multicycle_path 2 -setup -from [get_cells u_ff1] -to [get_cells u_ff2]', 'set_multicycle_path 1 -hold  -from [get_cells u_ff1] -to [get_cells u_ff2]'],
  say: (t, p) => p.mode === 'setup2' ? 'Moving the setup edge also drags the hold edge to one cycle before it (10 ns). The short path now has to be slower than a whole cycle!' : p.mode === 'both' ? '-hold 1 moves the hold check back to the launch edge, where it belongs.' : 'By default, data launched at 0 must arrive before the edge at 10 ns.',
  draw(t, p) {
    const c = this.calc(p), X = v => 92 + v * 25.2;
    let s = sx.t(14, 70, 'CLK', 'sx-b') + sx.clock(X, 80, 10, 0.001, 21) + sx.axis(X, 250, 20, 5);
    s += sx.t(X(0), 28, 'launch edge', 'sx-s sx-b', 'middle');
    // an arrow from the launch edge to the edge where each check happens. A check on the launch edge itself gets a labelled dot instead
    const arrow = (to, depth, cls) => sx.path(`M${X(0)} 92Q${(X(0) + X(to)) / 2} ${depth} ${X(to)} 92`, cls) + sx.dot(X(to), 92, cls + '-dot', 6);
    s += arrow(c.setupEdge, 150, 'sx-arc-su');
    s += c.holdEdge ? arrow(c.holdEdge, 116, 'sx-arc-h')
      : sx.dot(X(0), 92, 'sx-arc-h-dot', 8) + sx.t(X(0) - 8, 112, 'hold:', 'sx-s sx-b sx-hold-t', 'end') + sx.t(X(0) - 8, 127, 'same edge', 'sx-s sx-b sx-hold-t', 'end');
    // the key sits on its own line, so labels never cross the arrows. Its hold mark matches what is drawn: a dashed arrow or a dot
    s += sx.line(110, 142, 142, 142, 'sx-arc-su') + sx.t(150, 147, `setup check at ${c.setupEdge} ns`, 'sx-s sx-b')
      + (c.holdEdge ? sx.line(374, 142, 406, 142, 'sx-arc-h') : sx.dot(398, 142, 'sx-arc-h-dot', 8)) + sx.t(414, 147, `hold check at ${c.holdEdge} ns`, 'sx-s sx-b');
    s += sx.t(10, 187, 'longest', 'sx-s sx-b') + sx.bar(X, 0, this.base.tcq + p.d, 171, c.setupSlack >= 0 ? 'sx-bar-logic' : 'sx-bar-bad', sn(this.base.tcq + p.d), 24) + sx.t(10, 221, 'shortest', 'sx-s sx-b') + sx.bar(X, 0, this.base.tcqMin + p.dmin, 205, c.holdSlack >= 0 ? 'sx-bar-alt' : 'sx-bar-bad', sn(this.base.tcqMin + p.dmin), 24);
    const guides = sx.guides(X, [0, 10, 20], 36, 250, 'a') + sx.guides(X, [this.base.tcq + p.d, this.base.tcqMin + p.dmin], 36, 250, 'b');
    return sx.svg(302, guides + s + sx.cursor(X((t / 6) * 20), 40, 244) + sx.key(291, [['a', 'clock edge'], ['b', 'data arrives']]));
  },
  points: ['A <b>false path</b> can never matter (for example a static configuration bit): <code>set_false_path</code> tells STA to skip it.',
    'A <b>multicycle path</b> is given N cycles because the design really only captures every N cycles (an enable controls it).',
    'With <code>-setup N</code> you almost always also need <code>-hold N−1</code>.',
    'Exceptions are dangerous: a wrong one hides a real bug that STA will never report. Review every one.'],
  remember: 'Multicycle rule: setup N, hold N − 1.',
  quiz: { q: 'You set a 3-cycle setup multicycle. What hold value usually goes with it?', options: ['-hold 3', '-hold 2', '-hold 1'], answer: 1, why: 'N − 1 = 2, which brings the hold check back to the launch edge.' }
});

lesson({
  id: 'ocv', group: '4 · Advanced', icon: '🌡️', title: 'Corners, OCV and CRPR',
  idea: 'No two chips, voltages or temperatures are the same. STA must pass in all of them, with safety margins.',
  options: [{ k: 'corner', label: 'Process / voltage / temperature corner', def: 'typ', choices: [['fast', 'Fast'], ['typ', 'Typical'], ['slow', 'Slow']] }],
  params: [R('late', 'Late derate (launch + data)', 1, 1.2, 0.01, 1.08, '×'), R('early', 'Early derate (capture clock)', 0.8, 1, 0.01, 0.92, '×'), R('common', 'Shared clock path delay', 0, 3, 0.1, 2)],
  toggles: [['crpr', 'Apply CRPR (remove double pessimism)']],
  dur: () => 6, factor: { fast: 0.8, typ: 1, slow: 1.2 },
  calc(p) { const f = this.factor[p.corner]; return STA_CALC.ocvSetup({ T: 10, common: p.common * f, branchL: 0.6 * f, branchC: 0.6 * f, data: 7 * f, tsu: 0.8 * f, late: p.late, early: p.early, crpr: p.crpr }); },
  result(p) { const r = this.calc(p); return verdict(r.slack >= -1e-9, `Setup slack ${sn(r.slack)} ns (arrival ${sn(r.arrival)}, required ${sn(r.required)}${r.credit ? ', including CRPR credit +' + sn(r.credit) : ''}).`); },
  say: (t, p) => p.crpr ? 'CRPR gives back the pessimism on the SHARED part: one wire cannot be both slow and fast at the same moment.' : 'OCV: make the launch side slow and the capture side fast, to cover variation inside one chip.',
  draw(t, p) {
    const r = this.calc(p), f = this.factor[p.corner];
    // one shared clock path splits in two; each branch ends at the clock pin of its flip-flop
    const launchClk = [[240, 163], [240, 112], [451, 112], [451, 94]], captureClk = [[240, 163], [240, 214], [591, 214], [591, 196]];
    let s = sx.dot(34, 163, 'sx-port', 11) + sx.line(45, 163, 240, 163, 'sx-clk') + sx.poly(launchClk, 'sx-clk') + sx.poly(captureClk, 'sx-clk');
    s += sx.cloud(60, 143, 150, 40, `shared ${sn(p.common * f)}`, true) + sx.t(135, 204, p.common ? 'common path' : '', 'sx-s sx-b', 'middle');
    s += sx.cloud(280, 94, 116, 36, `×${sn(p.late)} late`) + sx.cloud(340, 196, 130, 36, `×${sn(p.early)} early`) + sx.ff(420, 20, 'launch') + sx.ff(560, 122, 'capture');
    s += sx.poly([[482, 44], [522, 44], [522, 146], [560, 146]], 'sx-wire') + sx.t(530, 88, 'data', 'sx-s sx-b');
    const dot = (pts, cls, k) => { const q = sx.along(pts, k); return sx.dot(q[0], q[1], cls, 7); };
    s += dot([[34, 163], ...launchClk, [451, 44], [522, 44], [522, 146], [560, 146]], 'sx-dot sx-bad', (t % 6) / 5) + dot([[34, 163], ...captureClk], 'sx-dot sx-alt', (t % 6) / 3.2);
    const m = Math.max(r.arrival, r.required) * 1.08, X = v => 100 + v * (490 / m);
    s += sx.t(10, 270, 'Arrival', 'sx-b') + sx.bar(X, 0, r.arrival, 252, 'sx-bar-logic', sn(r.arrival)) + sx.t(10, 308, 'Required', 'sx-b') + sx.bar(X, 0, r.required - r.credit, 290, 'sx-bar-req', sn(r.required - r.credit)) + (r.credit ? sx.bar(X, r.required - r.credit, r.required, 290, 'sx-bar-skew', '+' + sn(r.credit)) + sx.t(X(r.required), 334, `CRPR credit +${sn(r.credit)}`, 'sx-s sx-b', 'end') : '');
    return sx.svg(342, s);
  },
  points: ['A <b>PVT corner</b> is one combination of Process, Voltage and Temperature. <b>RC corners</b> do the same for wires.',
    'Rule of thumb: slow corners stress <b>setup</b>, fast corners stress <b>hold</b>. Sign-off still checks <b>both everywhere</b> (MCMM: multi-corner, multi-mode). At low voltages, cold can even be the slow case.',
    '<b>OCV</b> derates model variation across one chip. Newer methods (AOCV, POCV / LVF) are less pessimistic than one flat number.',
    '<b>CRPR / CPPR</b> removes the false pessimism on the clock path that launch and capture share.',
    'The numbers here are made up to show the idea. Real derates come from the foundry and sign-off team.'],
  remember: 'Be pessimistic where paths differ, but never about the same wire twice.',
  quiz: { q: 'What does CRPR correct?', options: ['Delays of the data path', 'Pessimism on the clock segment shared by launch and capture', 'Wrong clock periods'], answer: 1, why: 'The same shared buffers cannot be late for launch and early for capture at the same time.' }
});

lesson({
  id: 'reset', group: '4 · Advanced', icon: '🔄', title: 'Recovery and removal',
  idea: 'Releasing an asynchronous reset has its own setup-like and hold-like rules.',
  params: [R('dt', 'When reset is released (0 = clock edge)', -4, 4, 0.1, -2.5), R('rec', 'Recovery time', 0.5, 2.5, 0.1, 1.4), R('rem', 'Removal time', 0.2, 2, 0.1, 0.8)],
  dur: () => 10,
  result(p) {
    const w = STA_CALC.window(p.dt, p.rec, p.rem);
    return w === 'new' ? verdict(true, 'Recovery met: this clock edge already works normally.') : w === 'old' ? verdict(true, 'Removal met: reset was still active at this edge, so the flip-flop starts at the next one.') : verdict(false, p.dt < 0 ? 'RECOVERY violation: reset was released too close before the edge.' : 'REMOVAL violation: reset was released too soon after the edge.');
  },
  say: () => 'rst_n is active low. Drag the slider to move the moment it is released.',
  draw(t, p) {
    const X = v => 90 + v * 52, at = 5 + p.dt, bad = STA_CALC.window(p.dt, p.rec, p.rem) === 'bad';
    let s = sx.rect(X(5 - p.rec), 26, p.rec * 52, 140, 'sx-win-su', 0) + sx.rect(X(5), 26, p.rem * 52, 140, 'sx-win-h', 0) + sx.t(X(5 - p.rec / 2), 20, 'recovery', 'sx-s sx-b', 'middle') + sx.t(X(5 + p.rem / 2), 20, 'removal', 'sx-s sx-b', 'middle');
    s += sx.t(14, 72, 'CLK', 'sx-b') + sx.clock(X, 80, 20, 5, 10) + sx.t(14, 142, 'rst_n', 'sx-b') + sx.sig(X, 150, 0, [Math.max(0.05, at)], 10, bad ? 'sx-sig sx-bad' : 'sx-sig') + sx.t(X(at), 184, 'released', 'sx-s sx-b', 'middle');
    const guides = sx.guides(X, [5], 28, 168, 'a') + sx.guides(X, [at], 28, 168, 'b');
    return sx.svg(228, guides + s + sx.rect(X(t), 26, 640 - X(t), 140, 'sx-veil', 0) + sx.cursor(X(t), 26, 166) + sx.key(214, [['a', 'clock edge'], ['b', 'reset is released']]));
  },
  points: ['<b>Asserting</b> an async reset works at any time. <b>Releasing</b> it near a clock edge is the dangerous part.',
    '<b>Recovery</b> is like setup: reset must be released early enough before the edge.',
    '<b>Removal</b> is like hold: it must stay active long enough after the edge.',
    'The usual solution is a <b>reset synchronizer</b>: assert asynchronously, release in step with the clock.'],
  remember: 'Reset: easy to press, careful to let go.',
  quiz: { q: 'Recovery time is most similar to which check?', options: ['Setup', 'Hold', 'Clock skew'], answer: 0, why: 'Both require a signal to settle some time BEFORE the clock edge.' }
});

lesson({
  id: 'cdc', group: '4 · Advanced', icon: '🌉', title: 'Clock domain crossing',
  idea: 'With unrelated clocks, no delay can guarantee setup and hold. STA cannot fix this: the design must.',
  params: [R('Tb', 'Period of clock B (A is 10 ns)', 6, 13, 0.1, 7.3), R('phase', 'Phase of clock B', 0, 6, 0.1, 2.5)],
  toggles: [['sync', 'Add a 2-flip-flop synchronizer']],
  dur: () => 80, flips: [11, 31, 41, 61, 71],
  edges(p) { const out = []; for (let e = p.phase + 0.5; e <= 80; e += p.Tb) out.push(Math.round(e * 100) / 100); return out; },
  hits(p) { return this.edges(p).filter(e => this.flips.some(f => f > e - 0.8 && f < e + 0.5)); },
  result(p) {
    const n = this.hits(p).length;
    if (p.sync) return verdict(true, `${n ? n + ' risky edge(s) can still upset the FIRST flip-flop, but it gets a whole cycle to settle before the second one looks.' : 'No risky edge in this window, but with unrelated clocks one will come.'} The risk becomes very small, never zero.`);
    return verdict(false, n ? `${n} edge(s) in this window sample the data while it is changing: metastability reaches your logic.` : 'No clash in this window by luck. With unrelated clocks the edges drift, so it WILL happen. Try another phase.');
  },
  code: () => ['create_clock -name clkA -period 10  [get_ports clk_a]', 'create_clock -name clkB -period 7.3 [get_ports clk_b]', 'set_clock_groups -asynchronous -group clkA -group clkB', '# this stops STA timing the crossing: now check it with CDC tools,', '# and limit the crossing delay where your sign-off flow requires it'],
  say: () => 'Watch clock B drift against the data from clock A. Red marks are edges that sample a changing signal.',
  draw(t, p) {
    const X = v => 70 + v * 7, hits = new Set(this.hits(p));
    let guides = '';
    for (let e = 0; e <= 80; e += 10) guides += sx.line(X(e), 22, X(e), 182, 'sx-grid-a');      // CLK A rising edges
    for (const e of this.edges(p)) guides += sx.line(X(e), 22, X(e), 182, 'sx-grid-b');          // CLK B rising edges
    const key = sx.line(150, 4, 150, 18, 'sx-grid-a') + sx.t(158, 15, 'CLK A edge (data changes just after)', 'sx-s') + sx.line(426, 4, 426, 18, 'sx-grid-b') + sx.t(434, 15, 'CLK B edge (B samples here)', 'sx-s');
    let s = guides + key + sx.t(10, 46, 'CLK A', 'sx-b') + sx.clock(X, 52, 10, 0.001, 80) + sx.t(10, 106, 'data', 'sx-b') + sx.sig(X, 112, 0, this.flips, 80) + sx.t(10, 166, 'CLK B', 'sx-b') + sx.clock(X, 172, p.Tb, p.phase + 0.5, 80, 'sx-clk sx-b2');
    for (const e of this.edges(p)) if (hits.has(e) && t >= e) s += sx.line(X(e), 76, X(e), 178, 'sx-bad-line') + sx.dot(X(e), 188, 'sx-dot sx-bad', 6);
    s += sx.rect(X(t), 20, 640 - X(t), 172, 'sx-veil', 0) + sx.cursor(X(t), 20, 192);
    s += sx.ff(120, 218, 'A');
    if (p.sync) s += sx.line(182, 242, 300, 242, 'sx-wire') + sx.ff(300, 218, 'sync 1', hits.size > 0) + sx.line(362, 242, 440, 242, 'sx-wire') + sx.ff(440, 218, 'sync 2') + sx.line(502, 242, 580, 242, 'sx-wire') + sx.t(586, 247, 'logic', 'sx-s sx-b');
    else s += sx.line(182, 242, 440, 242, hits.size ? 'sx-bad-line' : 'sx-wire') + sx.ff(440, 218, 'B', hits.size > 0) + sx.line(502, 242, 580, 242, 'sx-wire') + sx.t(586, 247, 'logic', 'sx-s sx-b');
    return sx.svg(304, s);
  },
  points: ['A <b>synchronous</b> path has clocks with a fixed relationship. An <b>asynchronous</b> one does not.',
    '1 bit: use a <b>2-flip-flop synchronizer</b>. Many bits: use Gray-coded pointers, a handshake, or an <a href="#code/async_fifo">asynchronous FIFO</a>.',
    'Never send a multi-bit binary value through separate synchronizers: the bits may arrive in different cycles.',
    'A synchronizer lowers the failure rate (measured as <b>MTBF</b>); it cannot make it zero.',
    'STA does not check synchronizer correctness. Use <b>CDC verification</b> tools and review.'],
  remember: 'STA checks timing, not crossings. Unrelated clocks need a synchronizer AND a CDC check.',
  quiz: { q: 'How should an 8-bit data stream cross between unrelated clocks?', options: ['Eight 2-flip-flop synchronizers', 'An asynchronous FIFO', 'A longer wire'], answer: 1, why: 'Separate synchronizers could deliver some bits one cycle later than others. A FIFO keeps each word together.' }
});

lesson({
  id: 'latch', group: '4 · Advanced', icon: '🪟', title: 'Latches and time borrowing',
  idea: 'A latch stays open for part of the cycle, so slow logic can borrow time from the next stage.',
  params: [R('comb', 'Logic before the latch', 1, 10, 0.25, 6)], dur: () => 10,
  base: { tcq: 1, tsu: 0.5, opens: 5, closes: 10 },
  result(p) {
    const r = STA_CALC.borrow({ ...this.base, comb: p.comb });
    if (!r.ok) return verdict(false, `Data arrives at ${sn(r.arrival)} ns, too late even for the open latch (it closes at 10 ns and needs ${this.base.tsu} ns setup).`);
    return verdict(true, r.borrowed > 0 ? `Borrowed ${sn(r.borrowed)} ns. Stage 2 now has only ${sn(r.nextStageTime)} ns instead of 5, including the next flip-flop's setup time.` : `Data arrives at ${sn(r.arrival)} ns, before the latch opens at 5 ns. Nothing borrowed.`);
  },
  say: t => t < 5 ? 'CLK is high and the latch is closed. Data left a flip-flop at 0 ns and is on its way.' : t < 10 ? 'CLK is low: the latch is OPEN. Data arriving now passes straight through.' : 'At 10 ns the latch closes, and the next flip-flop captures the result.',
  draw(t, p) {
    const r = STA_CALC.borrow({ ...this.base, comb: p.comb }), X = v => 70 + v * 46;
    let s = sx.rect(X(5), 30, X(10) - X(5), 160, 'sx-win-su', 0) + sx.t(X(7.5), 22, 'latch open while CLK is low', 'sx-s sx-b', 'middle') + sx.t(14, 66, 'CLK', 'sx-b') + sx.clock(X, 74, 10, 0.001, 11) + sx.axis(X, 190, 11, 1);
    s += sx.t(10, 118, 'Stage 1', 'sx-b') + sx.bar(X, 0, Math.min(5, r.arrival), 100, 'sx-bar-logic', 'logic') + (r.borrowed ? sx.bar(X, 5, Math.min(r.arrival, 11), 100, r.ok ? 'sx-bar-skew' : 'sx-bar-bad', '+' + sn(r.borrowed)) : '');
    const from = Math.max(r.arrival, 5);
    s += sx.t(10, 158, 'Stage 2', 'sx-b') + (r.ok ? sx.bar(X, from, 10, 140, 'sx-bar-alt', sn(r.nextStageTime) + ' ns left') : '');
    const guides = sx.guides(X, [0, 5, 10], 32, 190, 'a') + sx.guides(X, [Math.min(r.arrival, 11)], 32, 190, 'b');
    return sx.svg(246, guides + s + sx.cursor(X(t), 30, 190) + sx.key(234, [['a', 'clock edge'], ['b', 'data reaches the latch']]));
  },
  points: ['A <b>flip-flop</b> samples on an edge. A <b>latch</b> follows its input the whole time it is open.',
    'Data arriving while the latch is open passes through: this is <b>time borrowing</b>.',
    'With one clock, a timing tool measures the borrow from the latch\'s <b>next opening edge</b>. Here the latch is open while the clock is low (5 to 10 ns), so stage 1 normally has half a cycle.',
    'The borrowed time is taken away from the next stage.',
    'Latches are common in high-speed custom designs. In FPGAs and most beginner designs, <b>avoid unwanted latches</b>.'],
  remember: 'Borrowed time must be paid back by the next stage.',
  quiz: { q: 'Where does borrowed time come from?', options: ['The previous stage', 'The next stage', 'The clock generator'], answer: 1, why: 'The data leaves the latch later, so the following logic has less time.' }
});

/* ================================ FORMULA BOOK ================================ */
// Each entry returns: eq (the general equation), num (with your numbers), ans, ok, where (symbols)
const mhz = ns => sn(STA_CALC.fmaxMHz(ns));
const met = v => (v >= -1e-9 ? 'MET' : 'VIOLATED');
const STA_FORMULAS = [
  { id: 'freq', label: 'Frequency', use: ['T'],
    f: p => ({ eq: ['frequency  f = 1 / T'], num: [`f = 1 / ${sn(p.T)} ns = ${sn(1 / p.T)} GHz`], ans: `f = ${mhz(p.T)} MHz`, ok: true, where: ['T = clock period (time from one rising edge to the next)', '1 ns period = 1 GHz = 1000 MHz'] }) },
  { id: 'setup', label: 'Setup', use: ['T', 'tcq', 'comb', 'tsu', 'skew', 'unc'],
    f: p => { const r = STA_CALC.setup(p); return { eq: ['T + skew  >=  tpcq + tpd + tsetup + uncertainty', 'setup slack = (T + skew - tsu - unc) - (tpcq + tpd)'], num: [`(${sn(p.T)} + (${sn(p.skew)}) - ${sn(p.tsu)} - ${sn(p.unc)}) - (${sn(p.tcq)} + ${sn(p.comb)})`, `= ${sn(r.required)} - ${sn(r.arrival)}`], ans: `setup slack = ${sn(r.slack)} ns  (${met(r.slack)})`, ok: r.slack >= -1e-9, where: ['tpcq = clock-to-Q propagation (max)    tpd = logic propagation (max)', 'skew = capture clock delay - launch clock delay'] }; } },
  { id: 'hold', label: 'Hold', use: ['tcqMin', 'combMin', 'th', 'skew', 'unc'],
    f: p => { const r = STA_CALC.hold(p); return { eq: ['tccq + tcd  >=  thold + skew + uncertainty', 'hold slack = (tccq + tcd) - (th + skew + unc)'], num: [`(${sn(p.tcqMin)} + ${sn(p.combMin)}) - (${sn(p.th)} + (${sn(p.skew)}) + ${sn(p.unc)})`, `= ${sn(r.arrival)} - ${sn(r.required)}`], ans: `hold slack = ${sn(r.slack)} ns  (${met(r.slack)})`, ok: r.slack >= -1e-9, where: ['tccq = clock-to-Q contamination (min)  tcd = logic contamination (min)', 'The clock period T does not appear.', 'Hold uncertainty is usually smaller than setup uncertainty (no period jitter).'] }; } },
  { id: 'fmax', label: 'Min period and Fmax', use: ['tcq', 'comb', 'tsu', 'skew', 'unc'],
    f: p => { const t = STA_CALC.minPeriod(p); return { eq: ['Tmin = tpcq + tpd + tsu + uncertainty - skew', 'Fmax = 1 / Tmin'], num: [`Tmin = ${sn(p.tcq)} + ${sn(p.comb)} + ${sn(p.tsu)} + ${sn(p.unc)} - (${sn(p.skew)}) = ${sn(t)} ns`], ans: `Fmax = ${mhz(t)} MHz`, ok: true, where: ['Use the WORST register-to-register path: it sets Tmin for the clock.', 'Hold must also pass; changing T cannot fix it.'] }; } },
  { id: 'skew', label: 'Latency and skew', use: ['src', 'netL', 'netC'],
    f: p => { const a = p.src + p.netL, b = p.src + p.netC; return { eq: ['clock latency = source latency + network latency', 'skew = latency(capture) - latency(launch)'], num: [`launch  = ${sn(p.src)} + ${sn(p.netL)} = ${sn(a)} ns`, `capture = ${sn(p.src)} + ${sn(p.netC)} = ${sn(b)} ns`], ans: `skew = ${sn(b - a)} ns`, ok: true, where: ['The shared source latency cancels out in the skew.'] }; } },
  { id: 'input', label: 'Input path', use: ['T', 'idly', 'comb', 'tsu', 'skew', 'unc'],
    f: p => { const r = STA_CALC.inputPath(p); return { eq: ['arrival  = input_delay(max) + logic(max)', 'required = T + skew - tsu - uncertainty', 'slack = required - arrival'], num: [`arrival = ${sn(p.idly)} + ${sn(p.comb)} = ${sn(r.arrival)}     required = ${sn(r.required)}`], ans: `input setup slack = ${sn(r.slack)} ns  (${met(r.slack)})`, ok: r.slack >= -1e-9, where: ['input_delay = time already used outside the chip (set_input_delay -max)', 'skew here = capture clock delay compared with the input delay reference'] }; } },
  { id: 'output', label: 'Output path', use: ['T', 'tcq', 'comb', 'odly', 'unc'],
    f: p => { const r = STA_CALC.outputPath(p); return { eq: ['arrival  = tpcq + logic(max) + output_delay(max)', 'required = T - uncertainty', 'slack = required - arrival'], num: [`arrival = ${sn(p.tcq)} + ${sn(p.comb)} + ${sn(p.odly)} = ${sn(r.arrival)}     required = ${sn(r.required)}`], ans: `output setup slack = ${sn(r.slack)} ns  (${met(r.slack)})`, ok: r.slack >= -1e-9, where: ['output_delay = time the outside world needs (set_output_delay -max)', 'Clock latency and skew are left out to keep it simple.'] }; } },
  { id: 'half', label: 'Half-cycle path', use: ['T', 'tcq', 'comb', 'tsu', 'tcqMin', 'combMin', 'th', 'skew', 'unc'],
    f: p => { const r = STA_CALC.halfCycle(p); return { eq: ['setup slack = T/2 + skew - tsu - unc - (tpcq + tpd)', 'Tmin = 2 x (tpcq + tpd + tsu + unc - skew)', 'hold slack = (tccq + tcd) - (-T/2 + th + skew + unc)'], num: [`setup: ${sn(p.T / 2)} + (${sn(p.skew)}) - ${sn(p.tsu)} - ${sn(p.unc)} - (${sn(p.tcq)} + ${sn(p.comb)}) = ${sn(r.setup)}`, `Tmin = ${sn(r.minPeriod)} ns       hold slack = ${sn(r.hold)} ns`], ans: `setup slack = ${sn(r.setup)} ns  (${met(r.setup)})`, ok: r.setup >= -1e-9 && r.hold >= -1e-9, where: ['Launch on the RISING edge, capture on the next FALLING edge (50% duty).', 'Setup gets only half a period. Hold becomes much easier.'] }; } },
  { id: 'mcp', label: 'Multicycle', use: ['T', 'N', 'tcq', 'comb', 'tsu', 'tcqMin', 'combMin', 'th', 'skew', 'unc'],
    f: p => { const r = STA_CALC.multicycle({ ...p, holdFixed: p.holdFixed }); return { eq: ['setup slack = N x T + skew - tsu - unc - (tpcq + tpd)', p.holdFixed ? 'with -hold N-1:  hold slack = (tccq + tcd) - (th + skew + unc)' : 'without -hold:  hold slack = (tccq+tcd) - ((N-1)xT + th + skew + unc)'], num: [`setup slack = ${p.N} x ${sn(p.T)} + (${sn(p.skew)}) - ${sn(p.tsu)} - ${sn(p.unc)} - ${sn(p.tcq + p.comb)} = ${sn(r.setup)}`, `hold checked at ${sn(r.holdEdge)} ns:  hold slack = ${sn(r.hold)}`], ans: `setup ${sn(r.setup)} ns (${met(r.setup)}),  hold ${sn(r.hold)} ns (${met(r.hold)})`, ok: r.setup >= -1e-9 && r.hold >= -1e-9, where: ['N = number of cycles given with set_multicycle_path -setup N', 'Same clock at both ends is assumed here.'] }; } },
  { id: 'reset', label: 'Recovery / removal', use: ['T', 'rpath', 'rpathMin', 'trec', 'trem', 'skew', 'unc'],
    f: p => { const a = STA_CALC.recovery(p), b = STA_CALC.removal(p); return { eq: ['recovery slack = (T + skew - trec - unc) - reset arrival(max)', 'removal slack  = reset arrival(min) - (trem + skew + unc)'], num: [`recovery: (${sn(p.T)} + (${sn(p.skew)}) - ${sn(p.trec)} - ${sn(p.unc)}) - ${sn(p.rpath)} = ${sn(a)}`, `removal:  ${sn(p.rpathMin)} - (${sn(p.trem)} + (${sn(p.skew)}) + ${sn(p.unc)}) = ${sn(b)}`], ans: `recovery ${sn(a)} ns (${met(a)}),  removal ${sn(b)} ns (${met(b)})`, ok: a >= -1e-9 && b >= -1e-9, where: ['Reset released by a flip-flop on the same clock (reset synchronizer).', 'Recovery works like setup. Removal works like hold.'] }; } },
  { id: 'wns', label: 'WNS and TNS', use: ['T'],
    arrivals: [6.2, 7.9, 8.6, 9.4],
    f(p) { const sl = this.arrivals.map(a => Math.round((p.T - 0.5 - a) * 100) / 100), r = STA_CALC.wnsTns(sl); return { eq: ['WNS = the most negative slack of all end points', 'TNS = sum of the negative slacks (one worst slack per end point)'], num: [`4 end points, slacks:  ${sl.map(sn).join(',  ')}`, `${r.failing} of 4 end points fail`], ans: `WNS = ${sn(r.wns)} ns,  TNS = ${sn(r.tns)} ns`, ok: r.failing === 0, where: ['WNS shows HOW BAD the worst problem is. TNS shows HOW MUCH is broken.', 'When nothing fails, some tools show the smallest positive slack as WNS.'] }; } },
  { id: 'latch', label: 'Latch borrowing', use: ['T', 'tcq', 'comb', 'tsu', 'unc'],
    f: p => { const half = p.T / 2, arr = p.tcq + p.comb, b = Math.max(0, arr - half), max = STA_CALC.maxBorrow({ open: half, tsu: p.tsu, unc: p.unc }), ok = b <= max + 1e-9; return { eq: ['time borrowed = max(0, arrival - latch opening time)', 'maximum borrow = time latch is open - tsu - uncertainty', 'time left for the next stage = latch closing time - max(arrival, opening)'], num: [`arrival = ${sn(arr)}, latch opens at ${sn(half)}  ->  borrowed = ${sn(b)}`, `maximum = ${sn(half)} - ${sn(p.tsu)} - ${sn(p.unc)} = ${sn(max)}`], ans: ok ? `borrow ${sn(b)} ns, next stage has ${sn(p.T - Math.max(arr, half))} ns` : `too late: needs ${sn(b)} ns but can borrow only ${sn(max)} ns`, ok, where: ['Flip-flop at 0, latch open from T/2 to T (50% duty), next flip-flop at T.'] }; } },
  { id: 'ocv', label: 'OCV and CRPR', use: ['T', 'common', 'data', 'late', 'early', 'tsu'],
    f: p => { const r = STA_CALC.ocvSetup({ ...p, branchL: 0.6, branchC: 0.6, crpr: true }); return { eq: ['arrival  = (common + launch) x late + data x late', 'required = T + (common + capture) x early - tsu + CRPR', 'CRPR credit = common x (late - early)'], num: [`arrival = (${sn(p.common)} + 0.6) x ${sn(p.late)} + ${sn(p.data)} x ${sn(p.late)} = ${sn(r.arrival)}`, `CRPR = ${sn(p.common)} x (${sn(p.late)} - ${sn(p.early)}) = ${sn(r.credit)},   required = ${sn(r.required)}`], ans: `setup slack = ${sn(r.slack)} ns  (${met(r.slack)})`, ok: r.slack >= -1e-9, where: ['late / early = derate factors.  launch and capture branches are 0.6 ns here.', 'Flat derates are the simplest method. AOCV and POCV are finer.'] }; } },
  { id: 'delay', label: 'Cell and wire delay', use: ['intr', 'load', 'slew', 'len'],
    f: p => { const c = STA_CALC.cellDelay({ intrinsic: p.intr, load: p.load, slew: p.slew }), R2 = 0.5 * p.len, C2 = 0.2 * p.len, w = STA_CALC.wire({ len: p.len }); return { eq: ['cell delay = intrinsic + k_load x load + k_slew x input slew', 'Elmore (RC tree) = sum of each C x the resistance it shares with the path', 'even wire:  delay = R x (C/2 + C_load)'], num: [`cell: ${sn(p.intr)} + 0.08 x ${p.load} + 0.2 x ${sn(p.slew)} = ${sn(c.total)} ns`, `wire: ${sn(R2)} kOhm x (${sn(C2)} / 2 + 0.05) pF = ${w.toFixed(3)} ns`], ans: `stage delay (cell + wire) = ${(c.total + w).toFixed(2)} ns`, ok: true, where: ['The cell formula and the k values are a teaching model, not a real library.', 'kOhm x pF = ns.  Wire: 0.5 kOhm and 0.2 pF per mm (made up).'] }; } }
];
const F_PARAMS = [
  R('T', 'Clock period T', 2, 20, 0.5, 10), R('N', 'Cycles allowed N', 2, 4, 1, 2, ''), R('tcq', 'Clock-to-Q, max (tpcq)', 0.2, 2, 0.1, 1), R('comb', 'Logic, max (tpd)', 1, 14, 0.5, 6), R('tsu', 'Setup time', 0.1, 2, 0.1, 0.8),
  R('tcqMin', 'Clock-to-Q, min (tccq)', 0.1, 1.5, 0.1, 0.4), R('combMin', 'Logic, min (tcd)', 0, 3, 0.1, 0.6), R('th', 'Hold time', 0.1, 1.5, 0.1, 0.5), R('skew', 'Clock skew', -1, 1, 0.1, 0.2), R('unc', 'Uncertainty', 0, 1, 0.05, 0.2),
  R('src', 'Source latency', 0, 2, 0.1, 0.8), R('netL', 'Network latency to launch FF', 0, 2, 0.1, 1), R('netC', 'Network latency to capture FF', 0, 2, 0.1, 1.3), R('idly', 'Input delay (max)', 0, 9, 0.5, 3), R('odly', 'Output delay (max)', 0, 9, 0.5, 2.5),
  R('rpath', 'Reset arrival, max', 0.5, 12, 0.5, 4), R('rpathMin', 'Reset arrival, min', 0.1, 3, 0.1, 1), R('trec', 'Recovery time', 0.1, 2, 0.1, 0.9), R('trem', 'Removal time', 0.1, 2, 0.1, 0.5),
  R('common', 'Shared clock delay', 0, 3, 0.1, 2), R('data', 'Data delay', 1, 12, 0.5, 7), R('late', 'Late derate', 1, 1.2, 0.01, 1.08, 'x'), R('early', 'Early derate', 0.8, 1, 0.01, 0.92, 'x'),
  R('intr', 'Intrinsic delay', 0.2, 1, 0.05, 0.4), R('load', 'Output load', 1, 20, 1, 6, 'units'), R('slew', 'Input slew', 0.2, 2, 0.1, 0.8), R('len', 'Wire length', 0.2, 4, 0.2, 2, 'mm')
];
lesson({
  id: 'formulas', group: '📐 Formula book', icon: '📐', title: 'Formula book',
  idea: 'Every STA equation in one place. Pick one, move the sliders and watch the numbers go in.',
  options: [{ k: 'f', label: 'Formula', def: 'freq', choices: STA_FORMULAS.map(x => [x.id, x.label]) }],
  params: F_PARAMS.map(r => ({ ...r, when: STA_FORMULAS.filter(x => x.use.includes(r.k)).map(x => x.id) })),
  toggles: [['holdFixed', 'Also set -hold N-1', ['mcp']]],
  dur: () => 6,
  one(p) { return STA_FORMULAS.find(x => x.id === p.f).f(p); },
  result(p) { const r = this.one(p); return verdict(r.ok, r.ans); },
  say: t => (t < 2 ? 'Step 1: the general formula.' : t < 4 ? 'Step 2: put your numbers in.' : 'Step 3: the answer. Change a slider and check it by hand.'),
  draw(t, p) {
    const r = this.one(p); let y = 30, s = '';
    const block = (title, lines, cls, show) => {
      s += sx.t(16, y, title, 'sx-b'); y += 10;
      s += sx.rect(14, y, 612, lines.length * 24 + 12, show ? cls : 'sx-bar-ext', 10);
      lines.forEach((ln, i) => { if (show) s += sx.t(28, y + 23 + i * 24, ln.replace(/</g, '&lt;').replace(/>/g, '&gt;'), 'sx-mono sx-b'); });
      y += lines.length * 24 + 40;
    };
    block('1 · Formula', r.eq, 'sx-bar-su', true); block('2 · With your numbers', r.num, 'sx-bar-q', t >= 2); block('3 · Answer', [r.ans], r.ok ? 'sx-bar-alt' : 'sx-bar-bad', t >= 4);
    s += sx.t(16, y - 6, 'What the symbols mean', 'sx-b'); r.where.forEach((w, i) => { s += sx.t(16, y + 16 + i * 20, w, 'sx-s'); });
    return sx.svg(y + 20 + r.where.length * 20, s);
  },
  table: [
    ['Frequency', 'f = 1 / T'], ['Setup (textbook form)', 'T + skew ≥ tpcq + tpd + tsetup + uncertainty'], ['Setup slack', '(T + skew − tsu − unc) − (tpcq + tpd)'],
    ['Hold (textbook form)', 'tccq + tcd ≥ thold + skew + uncertainty'], ['Hold slack', '(tccq + tcd) − (th + skew + unc)'], ['Minimum period', 'Tmin = tpcq + tpd + tsu + unc − skew'], ['Maximum frequency', 'Fmax = 1 / Tmin'],
    ['Clock latency', 'source latency + network latency'], ['Clock skew', 'latency(capture) − latency(launch)'],
    ['Input setup slack', '(T + skew − tsu − unc) − (input_delay_max + logic_max)'], ['Output setup slack', '(T − unc) − (tpcq + logic_max + output_delay_max)'],
    ['Half-cycle setup slack', '(T/2 + skew − tsu − unc) − (tpcq + tpd)'], ['Half-cycle hold slack', '(tccq + tcd) − (−T/2 + th + skew + unc)'],
    ['Multicycle setup slack', '(N×T + skew − tsu − unc) − (tpcq + tpd)'], ['Multicycle hold slack (with -hold N−1)', '(tccq + tcd) − (th + skew + unc)'],
    ['Recovery slack', '(T + skew − trec − unc) − reset arrival (max)'], ['Removal slack', 'reset arrival (min) − (trem + skew + unc)'],
    ['WNS / TNS', 'WNS = most negative slack  ·  TNS = sum of negative end-point slacks'], ['Latch borrowing', 'borrowed = max(0, arrival − opening)  ·  max = open time − tsu − unc'],
    ['CRPR credit (setup)', 'shared clock delay × (late derate − early derate)'], ['Elmore, even wire', 'R × (C/2 + C_load)']
  ],
  points: ['<b>tpcq, tpd</b> are maximum (propagation) delays, used in <b>setup</b>. <b>tccq, tcd</b> are minimum (contamination) delays, used in <b>hold</b>.',
    'Signs depend on the definition of skew. Here <b>skew = capture − launch</b>. Check how your book or tool defines it.',
    'These are simplified single-clock forms. Real tools add latency, derates, CRPR and per-edge details to the same two ideas: arrival and required.'],
  remember: 'Everything comes from two lines: setup = required − arrival, hold = arrival − required.',
  quiz: { q: 'A path launches on a rising edge and captures on the next falling edge (50% duty). How much time does setup get before margins?', options: ['A full period', 'Half a period', 'Two periods'], answer: 1, why: 'The falling edge arrives T/2 after the rising edge.' }
});

/* ================================ PRACTICE ================================ */
const STA_PRACTICE = {
  // small repeatable random generator, so problems can be tested
  rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return (a, b, step = 0.1) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; const n = Math.round((b - a) / step); return Math.round((a + (s % (n + 1)) * step) * 100) / 100; }; },
  make(seed) {
    const r = this.rng(seed), kind = ['setup', 'hold', 'fmax'][seed % 3];
    if (kind === 'setup') {
      const v = { T: r(4, 10, 0.5), tcq: r(0.2, 1.2), comb: r(2, 8), tsu: r(0.2, 1), skew: r(-0.5, 0.5), unc: r(0, 0.3) }, x = STA_CALC.setup(v);
      return { kind, unit: 'ns', answer: Math.round(x.slack * 100) / 100, q: `Setup check. Period ${v.T}, tcq ${v.tcq}, longest logic ${v.comb}, setup ${v.tsu}, skew ${v.skew}, uncertainty ${v.unc} (all in ns). What is the setup slack?`, steps: [`Arrival = ${v.tcq} + ${v.comb} = ${sn(x.arrival)}`, `Required = ${v.T} + (${v.skew}) − ${v.tsu} − ${v.unc} = ${sn(x.required)}`, `Slack = required − arrival = ${sn(x.slack)} ns`] };
    }
    if (kind === 'hold') {
      const v = { tcqMin: r(0.1, 0.6), combMin: r(0.1, 1.2), th: r(0.2, 0.9), skew: r(-0.3, 0.8), unc: r(0, 0.2) }, x = STA_CALC.hold(v);
      return { kind, unit: 'ns', answer: Math.round(x.slack * 100) / 100, q: `Hold check. Minimum tcq ${v.tcqMin}, shortest logic ${v.combMin}, hold time ${v.th}, skew ${v.skew}, uncertainty ${v.unc} (all in ns). What is the hold slack?`, steps: [`Arrival = ${v.tcqMin} + ${v.combMin} = ${sn(x.arrival)}`, `Required = ${v.th} + (${v.skew}) + ${v.unc} = ${sn(x.required)}`, `Slack = arrival − required = ${sn(x.slack)} ns`] };
    }
    const v = { tcq: r(0.2, 1), comb: r(1, 8), tsu: r(0.1, 0.8), skew: r(-0.3, 0.3), unc: r(0, 0.2) }, tmin = Math.round(STA_CALC.minPeriod(v) * 100) / 100;
    return { kind, unit: 'MHz', answer: Math.round(STA_CALC.fmaxMHz(tmin) * 10) / 10, q: `Speed limit. tcq ${v.tcq}, longest logic ${v.comb}, setup ${v.tsu}, skew ${v.skew}, uncertainty ${v.unc} (all in ns). What is the maximum clock frequency in MHz?`, steps: [`Smallest period = tcq + logic + setup + uncertainty − skew = ${tmin} ns`, `Fmax = 1000 ÷ ${tmin} = ${sn(STA_CALC.fmaxMHz(tmin))} MHz`] };
  },
  check(problem, text) {
    const v = Number(String(text).trim().replace(',', '.').replace('−', '-'));
    if (String(text).trim() === '' || !Number.isFinite(v)) return null;
    return Math.abs(v - problem.answer) <= (problem.unit === 'MHz' ? 0.6 : 0.011);
  },
  sheet: [['Setup slack', '(T + skew − tsu − uncertainty) − (tcq + longest logic)'], ['Hold slack', '(tcq_min + shortest logic) − (th + skew + uncertainty)'], ['Smallest period', 'tcq + longest logic + tsu + uncertainty − skew'], ['Fmax', '1 ÷ smallest period'], ['Skew', 'capture clock delay − launch clock delay'], ['Multicycle', 'setup N  →  hold N − 1'], ['Memory hook', 'Setup fears slow paths. Hold fears fast paths. Only setup cares about the period.']]
};
lesson({ id: 'practice', group: '🎯 Practice', icon: '🧮', title: 'Practice arena and cheat sheet', idea: 'Solve fresh problems until the formulas stick.', practice: true, remember: 'Setup: required − arrival. Hold: arrival − required.' });

if (typeof module !== 'undefined') module.exports = { DELAY_GROUP, STA_CALC, STA_LESSONS, STA_PRACTICE, STA_FORMULAS, sx };
if (typeof window !== 'undefined') Object.assign(window, { STA_CALC, STA_LESSONS, STA_PRACTICE });

/* =====================================================================================
   Page: lesson list, animation player, sliders, quizzes and the practice arena.
   (Uses $ and syncUrl from the main page script; only runs in the browser.)
   ===================================================================================== */
if (typeof document !== 'undefined') window.STA_UI = (() => {
  const SECONDS = { flipflop: 12, report: 18, cdc: 18, latch: 9, 'setup-slack': 9, 'hold-slack': 9 };   // length of one loop
  const STEP_SECONDS = 6;   // lessons told in steps give each step this long, so there is time to read
  const calm = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let id = null, P = {}, t = 0, playing = !calm, last = 0, hold = 0, looping = false;
  let seed = 1 + Math.floor(Math.random() * 100000), right = 0, tried = 0;
  const esc2 = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const cur = () => STA_LESSONS.find(l => l.id === id);
  const view = () => document.querySelector('#v-sta');
  const q = s => view().querySelector(s);
  const animated = l => l && !l.practice && l.dur(P) > 1;
  // a slider or switch with a "when" list only appears for those choices of the lesson's first option
  const relevant = (l, when) => !when || !l.options || when.includes(P[l.options[0].k]);
  function showRelevant() {
    const l = cur();
    (l.params || []).forEach(s => { const el = q(`[data-k="${s.k}"]`); if (el) el.closest('label').hidden = !relevant(l, s.when); });
    (l.toggles || []).forEach(x => { const el = q(`[data-tog="${x[0]}"]`); if (el) el.hidden = !relevant(l, x[2]); });
  }

  function frame() {
    const l = cur(); if (!l || l.practice || !q('#sta-stage')) return;
    const dur = l.dur(P), tt = Math.min(t, dur);
    q('#sta-stage').innerHTML = l.draw(tt, P);
    const say = q('#sta-say'), text = l.say(tt, P); if (say.textContent !== text) say.textContent = text;
    const sc = q('#sta-scrub'); if (sc) sc.value = String(Math.round(tt / dur * 1000));
    const pb = q('#sta-play'); if (pb) pb.textContent = playing ? '⏸ Pause' : '▶ Play';
  }
  function verdictBox() {
    const l = cur(), r = l.result(P), box = q('#sta-verdict');
    box.className = 'sta-verdict ' + (r.ok ? 'sta-pass' : 'sta-fail');
    box.innerHTML = `<b>${r.ok ? '✅' : '❌'}</b><span>${r.text}</span>`;
    const code = q('#sta-code'); if (code) code.textContent = l.code(P).join('\n');
  }
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000 || 0); last = now;
    const l = cur();
    if (playing && animated(l) && !view().hidden && !document.hidden) {
      const dur = l.dur(P);
      if (t >= dur) { hold += dt; if (hold > 1.6) { t = 0; hold = 0; } }
      else { t = Math.min(dur, t + dt * dur / (l.steps ? dur * STEP_SECONDS : SECONDS[l.id] || 7)); frame(); }
      if (t === 0) frame();
    }
    requestAnimationFrame(loop);
  }

  const card = (l, n) => `<button class="goalcard gcard sta-card" data-sta="${l.id}"><span class="sta-no">${l.practice ? '★' : n}</span><span class="gi">${l.icon}</span><b>${l.title}</b><small>${l.idea}</small></button>`;
  function renderList() {
    const groups = [...new Set(STA_LESSONS.map(l => l.group))];
    view().innerHTML = `<div class="hero"><h2>⏱️ Learn STA: from zero to advanced</h2>
      <p><b>Static Timing Analysis</b> checks that every signal in a chip arrives at the right time. Learn it with <b>animations you can play with</b>: drag the sliders and watch timing pass or fail.</p>
      <p>No experience needed. Go in order, about 3 to 5 minutes per lesson.</p>
      <button class="chip sta-start" data-sta="${STA_LESSONS[0].id}">▶ Start with lesson 1</button></div>
      ${groups.map(g => `<h2 class="sec">${g}</h2><div class="goalgrid gguides">${STA_LESSONS.filter(l => l.group === g).map(l => card(l, STA_LESSONS.indexOf(l) + 1)).join('')}</div>`).join('')}`;
    view().querySelectorAll('[data-sta]').forEach(b => b.onclick = () => open(b.dataset.sta));
  }

  const navHTML = i => {
    const prev = STA_LESSONS[i - 1], next = STA_LESSONS[i + 1];
    return `<div class="sta-nav">${prev ? `<button class="chip" data-sta="${prev.id}">← ${prev.title}</button>` : '<span></span>'}${next ? `<button class="chip sta-next" data-sta="${next.id}">Next: ${next.title} →</button>` : '<button class="chip sta-next" data-sta="">All lessons</button>'}</div>`;
  };

  const EXPLAIN = [['what', '💡 What is it?'], ['analogy', '🌍 Everyday picture'], ['when', '🕒 When does it happen?'], ['why', '⚠️ Why does it matter?'], ['change', '🎛️ What makes it bigger or smaller?'], ['sta', '🔎 Where you meet it in STA']];
  const explainHTML = e => `<h2 class="sec">📚 The full explanation</h2><div class="sta-explain">${EXPLAIN.map(([k, head]) => `<section class="sta-ex-${k}"><h3>${head}</h3>${Array.isArray(e[k]) ? `<ul>${e[k].map(x => `<li>${x}</li>`).join('')}</ul>` : `<p>${e[k]}</p>`}</section>`).join('')}</div>`;

  function renderLesson() {
    const l = cur(), i = STA_LESSONS.indexOf(l);
    if (l.practice) return renderPractice(l, i);
    const hasTime = animated(l);
    view().innerHTML = `<button class="chip gback" data-sta="">← All STA lessons</button>
      <div class="hero sta-hero"><div class="sta-meta">Lesson ${i + 1} of ${STA_LESSONS.length} · ${l.group}</div><h2>${l.icon} ${l.title}</h2><p class="sta-idea">${l.idea}</p></div>
      <div class="sta-lab">
        ${(l.options || []).map(o => `<div class="sta-opts" role="group" aria-label="${o.label}">${o.choices.map(c => `<button class="chip" data-opt="${o.k}" data-val="${c[0]}" aria-pressed="${P[o.k] === c[0]}">${c[1]}</button>`).join('')}</div>`).join('')}
        <div class="sta-scroll"><div id="sta-stage" class="sta-stage"></div></div>
        <p class="sta-swipe">↔ Swipe the drawing sideways to see all of it.</p>
        ${hasTime ? `<div class="sta-player"><button class="chip" id="sta-back" aria-label="Step back">⏮</button><button class="chip" id="sta-play"></button><button class="chip" id="sta-fwd" aria-label="Step forward">⏭</button><input type="range" id="sta-scrub" min="0" max="1000" aria-label="Move through time"></div>` : ''}
        <p class="sta-say" id="sta-say" aria-live="off"></p>
        ${(l.params || []).length ? `<div class="sta-sliders">${l.params.map(s => `<label><span>${s.label}<output data-out="${s.k}">${sn(P[s.k])} ${s.unit}</output></span><input type="range" data-k="${s.k}" min="${s.min}" max="${s.max}" step="${s.step}" value="${P[s.k]}"></label>`).join('')}</div>` : ''}
        ${(l.toggles || []).length ? `<div class="sta-toggles">${l.toggles.map(x => `<button class="chip" data-tog="${x[0]}" aria-pressed="${!!P[x[0]]}">${x[1]}</button>`).join('')}</div>` : ''}
        <div id="sta-verdict" class="sta-verdict" aria-live="polite"></div>
        ${l.code ? '<div class="gcode"><div class="gcode-h"><span>📝 SDC constraints</span><button class="chip" id="sta-copy">Copy</button></div><pre id="sta-code" class="sta-pre"></pre></div>' : ''}
      </div>
      ${l.explain ? explainHTML(l.explain) : ''}
      ${l.table ? `<h2 class="sec">${l.tableTitle || '📋 All formulas at a glance'}</h2><div class="sta-sheet sta-formulas">${l.table.map(r => `<div><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>` : ''}
      ${l.points ? `<h2 class="sec">Key points</h2><ul class="sta-points">${l.points.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      <div class="sta-remember"><span>🧠</span><div><small>Remember it</small><b>${l.remember}</b></div></div>
      <div class="sta-quiz"><h3>❓ Quick check</h3><p>${l.quiz.q}</p><div class="sta-answers">${l.quiz.options.map((o, n) => `<button class="opt" data-ans="${n}">${o}</button>`).join('')}</div><p id="sta-why" aria-live="polite"></p></div>
      ${navHTML(i)}`;
    view().querySelectorAll('[data-sta]').forEach(b => b.onclick = () => open(b.dataset.sta || null));
    view().querySelectorAll('[data-k]').forEach(r => r.oninput = () => {
      const s = l.params.find(x => x.k === r.dataset.k); P[s.k] = Number(r.value);
      q(`[data-out="${s.k}"]`).textContent = `${sn(P[s.k])} ${s.unit}`;
      playing = false; t = l.dur(P); verdictBox(); frame();          // show the finished picture while dragging
    });
    view().querySelectorAll('[data-opt]').forEach(b => b.onclick = () => {
      P[b.dataset.opt] = b.dataset.val;
      view().querySelectorAll(`[data-opt="${b.dataset.opt}"]`).forEach(x => x.setAttribute('aria-pressed', x === b));
      t = playing ? 0 : l.dur(P); showRelevant(); verdictBox(); frame();
    });
    view().querySelectorAll('[data-tog]').forEach(b => b.onclick = () => {
      P[b.dataset.tog] = !P[b.dataset.tog]; b.setAttribute('aria-pressed', P[b.dataset.tog]); verdictBox(); frame();
    });
    if (hasTime) {
      q('#sta-play').onclick = () => { playing = !playing; if (playing && t >= l.dur(P)) t = 0; frame(); };
      // in lessons told in steps, ⏮ and ⏭ show the finished picture of the previous or next step
      const jump = d => { const n = l.dur(P), now = Math.min(n - 1, Math.floor(t)), k = Math.max(0, Math.min(n - 1, now + d)); t = k === n - 1 ? n : k + 0.999; };
      const step = d => { playing = false; if (l.steps) { jump(d); frame(); return; } t = Math.max(0, Math.min(l.dur(P), t + d * (l.id === 'report' ? 1 : l.dur(P) / 10))); frame(); };
      q('#sta-back').onclick = () => step(-1); q('#sta-fwd').onclick = () => step(1);
      q('#sta-scrub').oninput = e => { playing = false; t = Number(e.target.value) / 1000 * l.dur(P); frame(); };
    }
    if (l.code) q('#sta-copy').onclick = e => copyTo(l.code(P).join('\n'), e.currentTarget);
    view().querySelectorAll('[data-ans]').forEach(b => b.onclick = () => {
      const good = Number(b.dataset.ans) === l.quiz.answer;
      view().querySelectorAll('[data-ans]').forEach(x => x.classList.remove('sta-yes', 'sta-no-ans'));
      b.classList.add(good ? 'sta-yes' : 'sta-no-ans');
      q('#sta-why').innerHTML = good ? `✅ <b>Correct.</b> ${l.quiz.why}` : '❌ <b>Not quite.</b> Look at the animation again and try another answer.';
    });
    showRelevant(); verdictBox(); frame();
  }

  function renderPractice(l, i) {
    const pr = STA_PRACTICE.make(seed);
    let answered = false;
    view().innerHTML = `<button class="chip gback" data-sta="">← All STA lessons</button>
      <div class="hero sta-hero"><div class="sta-meta">${l.group}</div><h2>${l.icon} ${l.title}</h2><p class="sta-idea">${l.idea}</p></div>
      <div class="sta-lab"><p class="sta-question">${esc2(pr.q)}</p>
        <form id="sta-form" class="sta-form"><input id="sta-input" inputmode="decimal" autocomplete="off" placeholder="Your answer" aria-label="Your answer in ${pr.unit}"><span>${pr.unit}</span><button class="chip" type="submit">Check</button><button class="chip" type="button" id="sta-show">Show steps</button><button class="chip sta-next" type="button" id="sta-new">New problem</button></form>
        <div id="sta-feedback" aria-live="polite"></div>
        <p class="sta-score" id="sta-score">This visit: ${right} right out of ${tried}. (Nothing is saved.)</p></div>
      <h2 class="sec">📌 Cheat sheet</h2><div class="sta-sheet">${STA_PRACTICE.sheet.map(r => `<div><b>${r[0]}</b><span>${r[1]}</span></div>`).join('')}</div>
      <div class="sta-remember"><span>🧠</span><div><small>Remember it</small><b>${l.remember}</b></div></div>${navHTML(i)}`;
    view().querySelectorAll('[data-sta]').forEach(b => b.onclick = () => open(b.dataset.sta || null));
    const steps = () => `<ol>${pr.steps.map(s => `<li>${esc2(s)}</li>`).join('')}</ol>`;
    q('#sta-form').onsubmit = e => {
      e.preventDefault();
      const res = STA_PRACTICE.check(pr, q('#sta-input').value), box = q('#sta-feedback');
      if (res === null) { box.innerHTML = '<div class="sta-verdict sta-fail"><b>✏️</b><span>Type a number first, for example -0.25</span></div>'; return; }
      if (!answered) { answered = true; tried++; if (res) right++; }
      box.innerHTML = res ? `<div class="sta-verdict sta-pass"><b>✅</b><span>Correct! ${pr.answer} ${pr.unit}${steps()}</span></div>` : '<div class="sta-verdict sta-fail"><b>❌</b><span>Not yet. Check the signs, then try again or press "Show steps".</span></div>';
      q('#sta-score').textContent = `This visit: ${right} right out of ${tried}. (Nothing is saved.)`;
    };
    q('#sta-show').onclick = () => { if (!answered) { answered = true; tried++; } q('#sta-feedback').innerHTML = `<div class="sta-verdict sta-pass"><b>📖</b><span>Answer: ${pr.answer} ${pr.unit}${steps()}</span></div>`; q('#sta-score').textContent = `This visit: ${right} right out of ${tried}. (Nothing is saved.)`; };
    q('#sta-new').onclick = () => { seed += 1; renderLesson(); };
  }

  function show(newId) {                       // called by the page's router
    const next = STA_LESSONS.some(l => l.id === newId) ? newId : null;
    if (next !== id || !view().children.length) {
      id = next;
      const l = cur();
      if (l && !l.practice) {
        P = Object.fromEntries([...(l.params || []).map(p => [p.k, p.def]), ...(l.options || []).map(o => [o.k, o.def]), ...(l.toggles || []).map(x => [x[0], false])]);
        playing = !calm; t = calm ? l.dur(P) : 0; hold = 0;
      }
      if (id) renderLesson(); else renderList();
    }
    if (!looping) { looping = true; requestAnimationFrame(loop); }
  }
  function open(newId) { show(newId || null); window.scrollTo(0, 0); syncUrl(); }
  return { show, open, get id() { return id; }, get title() { const l = cur(); return l ? l.title : null; } };
})();

})();
