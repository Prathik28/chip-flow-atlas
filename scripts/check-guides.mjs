// Runs the code and commands from the "Project guides" on the website and checks the results
// match what the guides promise. It reads the guides straight from index.html, so what is
// tested is exactly what visitors see.
//
// Needs: node, iverilog (with vvp), yosys, ngspice.
//   node scripts/check-guides.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('/* ---------- Project guides');
const end = html.indexOf('let guideId=');
if (start < 0 || end < 0) {
  console.error('Could not find the guides data in index.html (markers moved?).');
  process.exit(2);
}
const GUIDES = new Function(html.slice(start, end) + ';return GUIDES;')();

const failures = [];
const check = (guide, label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${!ok && detail ? '\n      ' + String(detail).trim().split('\n').slice(0, 6).join('\n      ') : ''}`);
  if (!ok) failures.push(`${guide}: ${label}`);
};

// Collect the files and commands of a guide (install commands inside OS tabs are not run).
function collect(guide) {
  const files = {}, cmds = [], outs = [];
  for (const step of guide.steps) {
    for (const b of step.b) {
      if (b.t === 'file') files[b.name] = b.code + '\n';
      if (b.t === 'cmd') cmds.push(b.code);
      if (b.t === 'out') outs.push(b.text);
    }
  }
  return { files, cmds, outs };
}
const run = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const cmdWith = (cmds, text) => {
  const c = cmds.find(x => x.includes(text));
  if (!c) throw new Error(`No command containing "${text}" in the guide`);
  return c;
};
const sandbox = id => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `guide-${id}-`));
  return d;
};

for (const guide of GUIDES) {
  console.log(`\n${guide.emoji} ${guide.title} (${guide.id})`);
  const { files, cmds, outs } = collect(guide);
  const dir = sandbox(guide.id);
  for (const [name, code] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), code);

  try {
    if (guide.id === 'sim') {
      const build = run(cmdWith(cmds, 'iverilog -o sim').replace(/\nvvp sim/, ''), dir);
      check(guide.id, 'iverilog compiles counter.v and tb.v', build.code === 0, build.out);
      const sim = run('vvp sim', dir);
      check(guide.id, 'the simulation runs', sim.code === 0, sim.out);
      // every line the guide promises (before the "..." line) must appear in the real output
      const promised = outs.find(o => o.includes('VCD info')).split('\n').filter(l => l.trim() && l.trim() !== '...');
      for (const line of promised) check(guide.id, `output contains: ${line}`, sim.out.includes(line), sim.out);
      check(guide.id, 'the counter wraps around from 15 to 0', /count=15[\s\S]*count=0/.test(sim.out), sim.out);
      check(guide.id, 'wave.vcd was written', fs.existsSync(path.join(dir, 'wave.vcd')));
    }

    if (guide.id === 'synth') {
      const r = run(cmdWith(cmds, 'yosys -p'), dir);
      check(guide.id, 'yosys synthesises counter.v', r.code === 0, r.out);
      // 4 flip-flops, whatever the cell is called in this Yosys version
      const stats = r.out.slice(r.out.lastIndexOf('Printing statistics'));
      const ffs = [...stats.matchAll(/^\s+(\d+)\s+\$_\w*DFF\w*/gm)].reduce((n, m) => n + Number(m[1]), 0);
      check(guide.id, `the 4-bit counter becomes 4 flip-flops (found ${ffs})`, ffs === 4, stats);
      const wide = sandbox('synth8');
      fs.writeFileSync(path.join(wide, 'counter.v'), files['counter.v'].replace('[3:0]', '[7:0]'));
      const r8 = run(cmdWith(cmds, 'yosys -p'), wide);
      const stats8 = r8.out.slice(r8.out.lastIndexOf('Printing statistics'));
      const ffs8 = [...stats8.matchAll(/^\s+(\d+)\s+\$_\w*DFF\w*/gm)].reduce((n, m) => n + Number(m[1]), 0);
      check(guide.id, `the experiment works: [7:0] gives 8 flip-flops (found ${ffs8})`, ffs8 === 8, stats8);
    }

    if (guide.id === 'spice') {
      const r = run(cmdWith(cmds, 'ngspice -b'), dir);
      check(guide.id, 'ngspice runs rc.cir', r.code === 0, r.out);
      const val = name => { const m = r.out.match(new RegExp(name + '\\s*=\\s*([-+0-9.eE]+)')); return m ? Number(m[1]) : NaN; };
      const v1 = val('v_1ms'), v5 = val('v_5ms');
      check(guide.id, `after 1 ms the capacitor is near 3.16 V (got ${v1})`, Math.abs(v1 - 3.1606) < 0.02, r.out);
      check(guide.id, `after 5 ms it is near 4.97 V (got ${v5})`, Math.abs(v5 - 4.9663) < 0.02, r.out);
      check(guide.id, 'rc_output.csv was written', fs.existsSync(path.join(dir, 'rc_output.csv')));
      const big = sandbox('spice10');
      fs.writeFileSync(path.join(big, 'rc.cir'), files['rc.cir'].replace('C1 out 0 1u', 'C1 out 0 10u'));
      const r10 = run(cmdWith(cmds, 'ngspice -b'), big);
      const m10 = r10.out.match(/v_1ms\s*=\s*([-+0-9.eE]+)/);
      check(guide.id, `the experiment works: a 10x bigger capacitor gives about 0.48 V (got ${m10 && m10[1]})`, m10 && Math.abs(Number(m10[1]) - 0.4758) < 0.02, r10.out);
    }

    if (guide.id === 'fpga') {
      // Only the first build step can run here (the rest needs nextpnr and a real board).
      const yosysCmd = cmdWith(cmds, 'synth_ice40').split('\n')[0];
      const r = run(yosysCmd, dir);
      check(guide.id, 'yosys synthesises blink.v for the iCE40 FPGA', r.code === 0, r.out);
      check(guide.id, 'blink.json was written', fs.existsSync(path.join(dir, 'blink.json')));
      // every port of the design must have a pin in the constraints file
      const ports = [...files['blink.v'].matchAll(/(?:input|output)\s+(\w+)/g)].map(m => m[1]);
      for (const p of ports) check(guide.id, `icebreaker.pcf assigns a pin to ${p}`, new RegExp(`set_io\\s+(-nowarn\\s+)?${p}\\s+\\d+`).test(files['icebreaker.pcf']));
      check(guide.id, 'the module is called "top" (the build command asks for -top top)', /module\s+top\b/.test(files['blink.v']));
    }
  } catch (e) {
    check(guide.id, 'the guide could be checked', false, e.message);
  }
}

console.log(failures.length ? `\n✗ ${failures.length} problem(s):\n  - ${failures.join('\n  - ')}` : '\n✓ All guides check out.');
process.exit(failures.length ? 1 : 0);
