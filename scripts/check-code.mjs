// Tests every design in the Code library (the files in code/).
// For each design, ONE testbench is run against BOTH versions, so the Verilog and the
// SystemVerilog code must behave the same. Both versions must also synthesise cleanly.
//
// Needs: node, iverilog (with vvp), yosys.
//   node scripts/check-code.mjs            test everything
//   node scripts/check-code.mjs async_fifo  test one design

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../code/', import.meta.url).pathname;
const only = process.argv[2];
const ids = fs.readdirSync(root).filter(d => fs.statSync(path.join(root, d)).isDirectory() && (!only || d === only)).sort();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codelib-'));
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: tmp, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
let bad = 0;
for (const id of ids) {
  const dir = path.join(root, id);
  const tb = path.join(dir, `tb_${id}.v`);
  const results = [];
  for (const [ext, std, label] of [['v', '-g2005', 'Verilog'], ['sv', '-g2012', 'SystemVerilog']]) {
    const src = path.join(dir, `${id}.${ext}`);
    // 1. simulate
    const build = sh('iverilog', [std, '-Wall', '-Wno-timescale', '-o', `${id}_${ext}`, tb, src]);
    let sim = { code: 1, out: '' };
    if (build.code === 0) sim = sh('vvp', [`${id}_${ext}`]);
    const passed = build.code === 0 && sim.code === 0 && /^PASS\b/m.test(sim.out) && !/\bFAIL\b/.test(sim.out);
    // 2. synthesise (no latches, no multiple drivers)
    const syn = sh('yosys', ['-p', `read_verilog ${ext === 'sv' ? '-sv ' : ''}${src}; synth -top ${id}; check -assert`]);
    const latch = /(?<!No )latch inferred for/i.test(syn.out);   // Yosys also prints "No latch inferred"
    const synOk = syn.code === 0 && !latch;
    results.push({ label, passed, synOk, detail: !passed ? (build.out + sim.out).trim().split('\n').slice(-12).join('\n') : !synOk ? (latch ? 'a latch was inferred\n' : '') + syn.out.trim().split('\n').slice(-12).join('\n') : '', warn: build.out.trim() });
  }
  const ok = results.every(r => r.passed && r.synOk);
  if (!ok) bad++;
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(22)} ` + results.map(r => `${r.label}: sim ${r.passed ? 'pass' : 'FAIL'}, synth ${r.synOk ? 'pass' : 'FAIL'}`).join('  |  '));
  for (const r of results) {
    if (r.detail) console.log(`    [${r.label}]\n    ` + r.detail.split('\n').join('\n    '));
    else if (r.warn) console.log(`    [${r.label} warnings] ` + r.warn.split('\n').slice(0, 3).join(' / '));
  }
}
console.log(bad ? `\n✗ ${bad} of ${ids.length} design(s) have problems.` : `\n✓ All ${ids.length} design(s) pass in both Verilog and SystemVerilog.`);
process.exit(bad ? 1 : 0);
