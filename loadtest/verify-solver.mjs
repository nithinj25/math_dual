// Checks the bot's answer parser against questions from the real generator.
// If someone adds a question template and this script does not learn it, the
// bots answer everything wrong and the whole load test measures nothing.
//
// Regenerate the probe data from the repo root, then run this:
//
//   cd api && python -c "\n//     import io,json,sys; sys.path.insert(0,'.'); \n//     from modules.questions import generate_questions; \n//     from modules.questions.config_loader import load_tier_config; \n//     out=[{'prompt':q.prompt,'answer':q.answer,'tmpl':q.template} \n//          for t in ('beginner','intermediate','advanced') \n//          for s in range(60) \n//          for q in generate_questions(s, load_tier_config(t))]; \n//     json.dump(out, io.open('../loadtest/_probe.json','w',encoding='utf-8'), ensure_ascii=False)"
//   cd ../loadtest && node verify-solver.mjs
//
// Note the explicit encoding='utf-8': the prompts contain U+00D7, U+00F7 and
// U+00B2, and Python defaults to the locale encoding on Windows.

import { readFileSync } from 'node:fs';

// the exact solve() from mathduel-duel.js
function solve(prompt) {
  const p = String(prompt).trim();
  let m;
  if ((m = p.match(/^(\d+)\s*\+\s*(\d+)$/))) return Number(m[1]) + Number(m[2]);
  if ((m = p.match(/^(\d+)\s*-\s*(\d+)$/))) return Number(m[1]) - Number(m[2]);
  if ((m = p.match(/^(\d+)\s*\u00d7\s*(\d+)$/))) return Number(m[1]) * Number(m[2]);
  if ((m = p.match(/^(\d+)\s*\u00f7\s*(\d+)$/))) return Number(m[1]) / Number(m[2]);
  if ((m = p.match(/^(\d+)\u00b2$/))) return Number(m[1]) * Number(m[1]);
  if ((m = p.match(/^(\d+)%\s*of\s*(\d+)$/))) return Math.floor((Number(m[2]) * Number(m[1])) / 100);
  return null;
}

const qs = JSON.parse(readFileSync('_probe.json', 'utf8'));
const byTmpl = {};
let ok = 0; const unparsed = []; const wrong = [];
for (const q of qs) {
  byTmpl[q.tmpl] ??= { ok: 0, bad: 0 };
  const got = solve(q.prompt);
  if (got === null) { unparsed.push(q.prompt); byTmpl[q.tmpl].bad++; }
  else if (got !== q.answer) { wrong.push(`${q.prompt} -> got ${got}, server ${q.answer}`); byTmpl[q.tmpl].bad++; }
  else { ok++; byTmpl[q.tmpl].ok++; }
}
console.log(`solved correctly : ${ok} / ${qs.length}`);
console.log(`unparseable      : ${unparsed.length}`);
console.log(`wrong answer     : ${wrong.length}`);
console.log('per template     :', byTmpl);
if (unparsed.length) console.log('unparsed examples:', [...new Set(unparsed)].slice(0, 6));
if (wrong.length) console.log('wrong examples   :', wrong.slice(0, 6));
