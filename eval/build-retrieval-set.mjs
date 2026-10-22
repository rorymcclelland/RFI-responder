// Assembles eval/retrieval-set.json from the hand-written sources in eval/source/.
// Re-run after editing a source file: node eval/build-retrieval-set.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import Papa from 'papaparse';

const here = (p) => new URL(p, import.meta.url);
const kb = Papa.parse(readFileSync(here('../sample-data/security-qa.csv'), 'utf8'), { header: true, skipEmptyLines: true })
  .data.map((r) => r.question);
const triples = ['001-025', '026-050', '051-075', '076-100']
  .flatMap((r) => JSON.parse(readFileSync(here(`./source/items-${r}.json`), 'utf8')));
if (triples.length !== kb.length) throw new Error(`Expected ${kb.length} triples, found ${triples.length}`);

// Split by entry, alternating, so no entry appears in both splits.
const items = [];
triples.forEach(([en1, en2, ja], i) => {
  const gold = kb[i];
  const split = i % 2 === 0 ? 'calibrate' : 'test';
  const n = String(i + 1).padStart(3, '0');
  items.push({ id: `e${n}-en1`, text: en1, language: 'en', kind: 'paraphrase', gold, review: 'unreviewed', split });
  items.push({ id: `e${n}-en2`, text: en2, language: 'en', kind: 'paraphrase', gold, review: 'unreviewed', split });
  items.push({ id: `e${n}-ja`, text: ja, language: 'ja', kind: 'translation', gold, review: 'unreviewed', split });
});
JSON.parse(readFileSync(here('./source/unanswerable.json'), 'utf8')).forEach((text, i) => {
  const language = /[぀-ヿ一-鿿]/.test(text) ? 'ja' : 'en';
  items.push({
    id: `u${String(i + 1).padStart(3, '0')}`, text, language, kind: 'unanswerable', gold: '',
    review: 'unreviewed', split: i % 2 === 0 ? 'calibrate' : 'test',
  });
});

// Near misses: on-topic security questions the knowledge base does not answer (added 22 Oct
// after the first app run showed off-topic questions alone made calibration look too good).
JSON.parse(readFileSync(here('./source/near-miss.json'), 'utf8')).forEach((text, i) => {
  const language = /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? 'ja' : 'en';
  items.push({
    id: `n${String(i + 1).padStart(3, '0')}`, text, language, kind: 'near-miss', gold: '',
    review: 'unreviewed', split: i % 2 === 0 ? 'calibrate' : 'test',
  });
});

writeFileSync(here('./retrieval-set.json'), JSON.stringify({ version: '2026-10-22.2', items }, null, 2) + '\n');
console.log(`Wrote ${items.length} items`);
