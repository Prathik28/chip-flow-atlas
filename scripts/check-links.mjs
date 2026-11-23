// Checks that the web links used by the site (index.html) and the README still work.
//   node scripts/check-links.mjs
//
// A link counts as BROKEN when the page is gone (404/410), the server errors (5xx) or it cannot be
// reached. Some sites refuse automated checks (403, 429, LinkedIn's 999); those are only warnings,
// because the link usually works fine in a normal browser.

import fs from 'node:fs';

const files = ['../index.html', '../README.md'].map(f => [f.slice(3), fs.readFileSync(new URL(f, import.meta.url), 'utf8')]);

// links we do not check on purpose
const SKIP = [
  /^https?:\/\/(localhost|127\.0\.0\.1)/,
  /^https?:\/\/www\.w3\.org\/2000\/svg/,   // an XML name, not a web page
  /^https?:\/\/schema\.org\/?$/,           // a name used in the structured data
  /example\.(com|org)/,
  /^https:\/\/fonts\.(googleapis|gstatic)\.com\/?$/,   // preconnect hints: server names, not pages
];
const found = new Map(); // url -> files it appears in
for (const [name, text] of files) {
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>)\]\\`]+/g)) {
    let url = m[0].replace(/[.,;:*_]+$/, '').replace(/&amp;/g, '&');   // drop trailing punctuation and markdown bold/italic marks
    if (url.includes('${') || SKIP.some(r => r.test(url))) continue;
    found.set(url, (found.get(url) || new Set()).add(name));
  }
}

const UA = 'Mozilla/5.0 (compatible; Chip-Flow-Atlas-link-check)';
const WARN_ONLY = new Set([401, 403, 429, 999]);
// a site with an incomplete certificate chain: browsers cope with it, a script does not
const WARN_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);
const isWarn = r => WARN_ONLY.has(r.status) || WARN_CODES.has(r.error);

async function attempt(url, method) {
  return fetch(url, { method, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,*/*' }, signal: AbortSignal.timeout(20000) });
}
async function check(url) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    try {
      let res = await attempt(url, 'HEAD');
      if ([403, 404, 405, 501].includes(res.status)) res = await attempt(url, 'GET'); // some servers dislike HEAD
      if (res.status < 500) return { url, status: res.status };
      last = { url, status: res.status };
    } catch (e) {
      last = { url, status: 0, error: e.cause?.code || e.name };
    }
    await new Promise(r => setTimeout(r, 1500 * (i + 1)));
  }
  return last;
}

const urls = [...found.keys()].sort();
console.log(`Checking ${urls.length} links...\n`);
const results = [];
for (let i = 0; i < urls.length; i += 8) {
  results.push(...await Promise.all(urls.slice(i, i + 8).map(check)));
}

const broken = [], warned = [];
for (const r of results) {
  const where = [...found.get(r.url)].join(', ');
  if (r.status >= 200 && r.status < 400) continue;
  if (isWarn(r)) warned.push(r); else broken.push(r);
  console.log(`${isWarn(r) ? '⚠️ ' : '✗ '} ${r.status || r.error}  ${r.url}   (${where})`);
}
console.log(`\n${results.length - broken.length - warned.length} fine, ${warned.length} refused automated checks (not counted as errors), ${broken.length} broken.`);
process.exit(broken.length ? 1 : 0);
