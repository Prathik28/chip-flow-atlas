// Tests the "Learn STA" lessons (sta.js): the timing maths against hand-worked numbers, every
// animation at many times and slider settings, the quizzes and the practice problems.
//   node scripts/check-sta.mjs

import fs from 'node:fs';
import { createRequire } from 'node:module';
const { DELAY_GROUP, STA_CALC: C, STA_LESSONS: L, STA_PRACTICE: P, STA_FORMULAS: F } = createRequire(import.meta.url)('../sta.js');

let fails = 0, checks = 0;
const ok = (cond, label) => { checks++; if (!cond) { fails++; if (fails <= 15) console.log('  ✗ ' + label); } };
const near = (a, b, label, eps = 1e-9) => ok(Math.abs(a - b) < eps, `${label}: got ${a}, expected ${b}`);

// ---------- hand-worked timing numbers ----------
let r = C.setup({ T: 10, tcq: 1, comb: 6, tsu: 1, skew: 0, unc: 0.25 });
near(r.arrival, 7, 'setup arrival'); near(r.required, 8.75, 'setup required'); near(r.slack, 1.75, 'setup slack');
near(C.setup({ T: 10, tcq: 1, comb: 6, tsu: 1, skew: 0.5 }).slack, 2.5, 'positive skew helps setup');
r = C.hold({ tcqMin: 0.4, combMin: 0.6, th: 0.6, skew: 0.2 });
near(r.arrival, 1, 'hold arrival'); near(r.required, 0.8, 'hold required'); near(r.slack, 0.2, 'hold slack');
near(C.hold({ tcqMin: 0.4, combMin: 0.6, th: 0.6, skew: 0.7 }).slack, -0.3, 'positive skew hurts hold');
near(C.hold({ tcqMin: 0.4, combMin: 0.6, th: 0.6, skew: 0.2, T: 999 }).slack, 0.2, 'hold ignores the period');
near(C.minPeriod({ tcq: 1, comb: 5, tsu: 0.5 }), 6.5, 'minimum period');
near(C.fmaxMHz(4), 250, 'frequency');
near(C.setup({ T: C.minPeriod({ tcq: 0.7, comb: 3.1, tsu: 0.4, skew: 0.3, unc: 0.1 }), tcq: 0.7, comb: 3.1, tsu: 0.4, skew: 0.3, unc: 0.1 }).slack, 0, 'slack is zero at the minimum period', 1e-9);
ok(C.window(-3, 1.5, 1) === 'new' && C.window(2, 1.5, 1) === 'old' && C.window(-1, 1.5, 1) === 'bad' && C.window(0.5, 1.5, 1) === 'bad', 'setup/hold window');
ok(C.window(-1.5, 1.5, 1) === 'new' && C.window(1, 1.5, 1) === 'old', 'exactly on the limit is allowed');
ok(JSON.stringify(C.mcpEdges('one', 10)) === '{"setupEdge":10,"holdEdge":0}', 'normal edges');
ok(JSON.stringify(C.mcpEdges('setup2', 10)) === '{"setupEdge":20,"holdEdge":10}', 'setup 2 alone drags hold along');
ok(JSON.stringify(C.mcpEdges('both', 10)) === '{"setupEdge":20,"holdEdge":0}', 'setup 2 hold 1');
r = C.ocvSetup({ T: 10, common: 2, branchL: 0.6, branchC: 0.6, data: 7, tsu: 0.8, late: 1.08, early: 0.92, crpr: false });
near(r.arrival, 10.368, 'OCV arrival'); near(r.required, 11.592, 'OCV required'); near(r.slack, 1.224, 'OCV slack');
near(C.ocvSetup({ T: 10, common: 2, branchL: 0.6, branchC: 0.6, data: 7, tsu: 0.8, late: 1.08, early: 0.92, crpr: true }).credit, 0.32, 'CRPR credit = shared delay x (late - early)');
let b = C.borrow({ T: 10, tcq: 1, comb: 11, tsu: 0.5, open: 5 });
near(b.borrowed, 2, 'borrowed time'); ok(b.ok, 'borrow fits'); near(b.nextStageTime, 8, 'next stage pays');
ok(!C.borrow({ T: 10, tcq: 1, comb: 14, tsu: 0.5, open: 5 }).ok, 'too late even for the latch');

const byId = id => L.find(l => l.id === id);
const defaults = l => Object.fromEntries([...(l.params || []).map(p => [p.k, p.def]), ...(l.options || []).map(o => [o.k, o.def]), ...(l.toggles || []).map(t => [t[0], false])]);

// the timing report adds up
const rpt = byId('report').report(2);
near(rpt.arrival, 1.86, 'report arrival'); near(rpt.required, 2.23, 'report required'); near(rpt.slack, 0.37, 'report slack');
near(byId('report').report(1.5).slack, -0.13, 'report fails at 1.5 ns');
// the fixing lesson starts failing both, and the advice in it is true
const fx = byId('fixing'), base = fx.calc(defaults(fx));
ok(base.setup.slack < 0 && base.hold.slack < 0, 'fixing lesson starts with both checks failing');
const slow = fx.calc({ ...defaults(fx), slow: true });
ok(slow.setup.slack >= 0 && Math.abs(slow.hold.slack - base.hold.slack) < 1e-9, 'a slower clock fixes setup and does nothing for hold');
ok(fx.calc({ ...defaults(fx), buf: true }).hold.slack >= 0, 'the delay buffer fixes hold');
ok(fx.calc({ ...defaults(fx), skew: true }).hold.slack < base.hold.slack, 'useful skew makes this hold path worse');
ok(fx.calc({ ...defaults(fx), pipe: true, buf: true }).setup.slack >= 0, 'pipeline + buffer closes timing');
// multicycle lesson: the wrong constraint breaks hold, the right one passes
const ex = byId('exceptions');
ok(ex.calc({ ...defaults(ex), mode: 'one' }).setupSlack < 0, 'long path fails as single cycle');
ok(ex.calc({ ...defaults(ex), mode: 'setup2' }).holdSlack < 0, 'setup 2 alone breaks hold');
const both = ex.calc({ ...defaults(ex), mode: 'both' });
ok(both.setupSlack >= 0 && both.holdSlack >= 0, 'setup 2 + hold 1 passes');

// ---------- delay models and the extra equations, against hand-worked numbers ----------
let d = C.cellDelay({ intrinsic: 0.4, load: 6, slew: 0.8 }); near(d.total, 1.04, 'cell delay = 0.4 + 0.48 + 0.16', 1e-9);
near(C.elmore({ R: 1, C: 0.4, CL: 0.05 }), 0.25, 'Elmore R(C/2 + CL)');
near(C.wire({ len: 4 }), 0.9, 'long wire'); near(C.wire({ len: 4, repeater: true }), 0.55, 'long wire with repeater');
ok(C.wire({ len: 0.2, repeater: true }) > C.wire({ len: 0.2 }), 'a repeater makes a short wire slower');
ok(C.wire({ len: 4 }) > 2 * C.wire({ len: 2 }), 'wire delay grows faster than length');
near(C.inputPath({ T: 10, idly: 3, comb: 6, tsu: 0.8, unc: 0.2, skew: 0.2 }).slack, 0.2, 'input path slack');
near(C.outputPath({ T: 10, tcq: 1, comb: 6, odly: 2.5, unc: 0.2 }).slack, 0.3, 'output path slack');
let h = C.halfCycle({ T: 10, tcq: 1, comb: 3, tsu: 0.5, tcqMin: 0.4, combMin: 0.6, th: 0.5 });
near(h.setup, 0.5, 'half-cycle setup'); near(h.minPeriod, 9, 'half-cycle minimum period'); near(h.hold, 5.5, 'half-cycle hold');
const mc = { T: 10, N: 2, tcq: 1, comb: 15, tsu: 0.8, tcqMin: 0.4, combMin: 0.6, th: 0.5 };
near(C.multicycle({ ...mc, holdFixed: true }).setup, 3.2, 'multicycle setup'); near(C.multicycle({ ...mc, holdFixed: true }).hold, 0.5, 'multicycle hold with -hold'); near(C.multicycle({ ...mc, holdFixed: false }).hold, -9.5, 'multicycle hold without -hold');
near(C.recovery({ T: 10, rpath: 4, trec: 0.9 }), 5.1, 'recovery slack'); near(C.removal({ rpathMin: 1, trem: 0.5 }), 0.5, 'removal slack');
let w = C.wnsTns([1.3, -0.4, -1.1, -1.9]); near(w.wns, -1.9, 'WNS'); near(w.tns, -3.4, 'TNS', 1e-9); ok(w.failing === 3, 'failing end points');
ok(C.wnsTns([3, 1]).wns === 0 && C.wnsTns([3, 1]).tns === 0, 'nothing failing: WNS and TNS are 0');
near(C.maxBorrow({ open: 5, tsu: 0.8, unc: 0.2 }), 4, 'maximum borrow');

// the Formula book shows these answers at its default slider settings
const book = L.find(l => l.id === 'formulas');
const shown = (f, extra = {}) => book.result({ ...Object.fromEntries(book.params.map(p => [p.k, p.def])), holdFixed: true, ...extra, f }).text;
for (const [f, want, extra] of [['freq', 'f = 100 MHz'], ['setup', 'setup slack = 2.2 ns'], ['hold', 'hold slack = 0.1 ns'], ['fmax', 'Fmax = 128.21 MHz'], ['skew', 'skew = 0.3 ns'], ['input', 'input setup slack = 0.2 ns'], ['output', 'output setup slack = 0.3 ns'], ['half', 'setup slack = -2.8 ns'], ['mcp', 'setup 12.2 ns'], ['reset', 'recovery 5.1 ns'], ['wns', 'WNS = 0 ns'], ['wns', 'WNS = -1.9 ns,  TNS = -3.4 ns', { T: 8 }], ['latch', 'borrow 0 ns'], ['ocv', 'setup slack = 1.54 ns'], ['delay', 'ns']])
  ok(shown(f, extra).includes(want), `formula book "${f}" should show "${want}" but shows "${shown(f, extra)}"`);
ok(F.length === book.options[0].choices.length && F.every(x => book.params.some(p => p.when.includes(x.id))), 'every formula has sliders');
let longest = '';
for (const s of settings(book)) { const r = F.find(x => x.id === s.f).f(s); for (const line of [...r.eq, ...r.num, r.ans]) if (line.length > longest.length) longest = line; for (const line of r.where) if (line.length > 88) longest = line; }
ok(longest.length <= 80, `a formula line is too long for the drawing (${longest.length}): ${longest}`);

// ---------- the delay lessons: hand-worked numbers and complete explanations ----------
const xt = n => C.crosstalk({ base: 1, coupling: 0.4, neighbour: n, overlap: true });
near(xt('quiet').delay, 1, 'quiet neighbour'); near(xt('opposite').delay, 1.4, 'opposite neighbour slows'); near(xt('same').delta, -0.4, 'same-direction neighbour speeds up');
near(C.crosstalk({ base: 1, coupling: 0.4, neighbour: 'opposite', overlap: false }).delta, 0, 'no overlap, no delta delay');
near(C.outputDelay({ tsu: 1.5, wireMax: 1 }).max, 2.5, 'output delay max = board + setup');
near(C.outputDelay({ th: 0.5, wireMin: 0.2 }).min, -0.3, 'output delay min = board - hold, can be negative');
const run = (id, extra = {}) => byId(id).result({ ...defaults(byId(id)), ...extra }).text;
for (const [id, want, extra] of [['delay-contamination', 'Hold slack = -0.4 ns'], ['delay-transition', 'cell delay of 0.96 ns'], ['delay-cell', '= 1.28 ns'], ['delay-cell', '= 0.74 ns', { size: '4' }],
  ['delay-crosstalk', 'Victim wire delay 1.4 ns'], ['delay-clock', 'Skew (B minus A) = +0.6 ns'], ['delay-input', 'Slack 1.2 ns'], ['delay-output', 'Slack 1.5 ns']])
  ok(run(id, extra).includes(want), `${id} should say "${want}" but says "${run(id, extra)}"`);
const delayLessons = L.filter(l => l.group === DELAY_GROUP);
ok(delayLessons.length === 12, 'there are 12 lessons about delays');
for (const l of delayLessons) {
  const e = l.explain || {};
  ok(['what', 'analogy'].every(k => e[k]?.length > 40) && ['when', 'why', 'change', 'sta'].every(k => e[k]?.length >= 2), `${l.id}: explains what, an everyday picture, when, why, what changes it and where STA uses it`);
  // every link in the text must point to a lesson that exists
  for (const m of JSON.stringify([e, l.points]).matchAll(/#sta\/([a-z-]+)/g)) ok(!!byId(m[1]), `${l.id}: link to missing lesson ${m[1]}`);
  if (!l.steps) continue;
  for (const p of settings(l)) {
    const steps = l.steps(p);
    if (l.dur(p) !== steps.length || steps.some((text, k) => !l.say(k + 0.5, p).startsWith(`Step ${k + 1} of ${steps.length}: `) || text.length < 30)) { ok(false, `${l.id}: steps and captions disagree with ${JSON.stringify(p)}`); break; }
  }
}

// ---------- every animation, at many times and slider extremes ----------
function settings(l) {
  let list = [defaults(l)];
  const vary = (key, values, when) => { list = list.flatMap(s => (when && !when.includes(s[l.options[0].k])) ? [s] : values.map(v => ({ ...s, [key]: v }))); };
  for (const o of l.options || []) vary(o.k, o.choices.map(c => c[0]));
  for (const t of l.toggles || []) vary(t[0], [false, true], t[2]);
  for (const p of l.params || []) {
    const shown = list.filter(s => !p.when || p.when.includes(s[l.options[0].k])).length;
    // sliders with many companions are tested at their extremes, to keep the number of combinations sensible
    vary(p.k, shown && list.length > 400 ? [p.min, p.max] : [p.min, p.def, p.max], p.when);
  }
  return list;
}
let frames = 0;
const usedClasses = new Set();
for (const l of L) {
  ok(l.id && l.title && l.group && l.icon && l.idea && l.remember, `${l.id}: has the basic fields`);
  if (l.practice) continue;
  ok(l.points?.length >= 3, `${l.id}: has key points`);
  const q = l.quiz; ok(q && q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length && q.why, `${l.id}: quiz is complete`);
  let badFrame = null;
  for (const p of settings(l)) {
    const dur = l.dur(p);
    const res = l.result(p);
    if (!(dur > 0) || !res.text || /NaN|undefined|Infinity/.test(res.text) || typeof res.ok !== 'boolean') badFrame ||= `result/dur with ${JSON.stringify(p)}: ${res.text}`;
    if (l.code && /NaN|undefined/.test(l.code(p).join('\n'))) badFrame ||= 'code lines';
    for (const f of [0, 0.13, 0.31, 0.5, 0.69, 0.87, 1]) {
      const t = dur * f, svg = l.draw(t, p), say = l.say(t, p); frames++;
      for (const m of svg.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).filter(Boolean).forEach(c => usedClasses.add(c));
      const problem = /NaN|undefined|Infinity|null|\[object/.test(svg + say) ? 'bad value' : !svg.startsWith('<svg') || !svg.endsWith('</svg>') ? 'not an svg'
        : /(width|height|r)="-/.test(svg) ? 'negative size' : (svg.match(/<text /g) || []).length !== (svg.match(/<\/text>/g) || []).length ? 'unbalanced text'
        : [...svg.matchAll(/class="([^"]*)"/g)].some(m => m[1].split(/\s+/).filter(Boolean).some(c => !c.startsWith('sx-'))) ? 'class without sx- prefix' : '';
      if (problem) badFrame ||= `${problem} at t=${t.toFixed(2)} ${JSON.stringify(p)}`;
    }
  }
  ok(!badFrame, `${l.id}: ${badFrame}`);
}

// every style used inside a drawing must have a rule in the page, or the drawing renders black
const page = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = page.slice(page.indexOf('<style'), page.lastIndexOf('</style>'));
const unstyled = [...usedClasses].filter(c => !new RegExp('\\.' + c + '(?![\\w-])').test(css));
ok(!unstyled.length, 'drawing styles missing from index.html: ' + unstyled.join(' '));
ok(page.includes('<script src="sta.js"></script>'), 'index.html loads sta.js');

// ---------- practice problems ----------
let kinds = new Set(), practiceBad = null;
for (let seed = 1; seed <= 900; seed++) {
  const q = P.make(seed); kinds.add(q.kind);
  const nums = [...q.q.matchAll(/(?:\)| )(-?\d+(?:\.\d+)?)/g)].map(m => Number(m[1]));
  // recompute from the numbers shown to the student, independently of the library
  let want;
  if (q.kind === 'setup') { const [T, tcq, comb, tsu, skew, unc] = nums; want = (T + skew - tsu - unc) - (tcq + comb); }
  else if (q.kind === 'hold') { const [tcq, comb, th, skew, unc] = nums; want = (tcq + comb) - (th + skew + unc); }
  else { const [tcq, comb, tsu, skew, unc] = nums; want = 1000 / (tcq + comb + tsu + unc - skew); }
  const tol = q.unit === 'MHz' ? 0.6 : 0.011;
  if (!(Math.abs(want - q.answer) <= tol) || P.check(q, String(q.answer)) !== true || P.check(q, String(q.answer + 2)) !== false || P.check(q, '') !== null || /NaN|undefined/.test(q.q + q.steps.join())) practiceBad ||= `seed ${seed}: shown numbers give ${want}, stored ${q.answer}`;
}
ok(!practiceBad, 'practice: ' + practiceBad);
ok(kinds.size === 3, 'practice has all three kinds of problem');

console.log(`${L.length} lessons, ${frames} animation frames, 900 practice problems, ${checks} checks.`);
console.log(fails ? `✗ ${fails} problem(s).` : '✓ All STA checks pass.');
process.exit(fails ? 1 : 0);
