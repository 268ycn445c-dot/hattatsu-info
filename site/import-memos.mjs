// 書きためノートで「書き出す」したファイル（kakidame-export-*.json）を、
// posts/ に記事の下書き（draft: true）として取り込む。
//
//   npm run import-memos                 … ダウンロードフォルダの一番新しい書き出しファイルを使う
//   npm run import-memos -- <ファイル>    … ファイルを指定する
//
// 同じメモを2回取り込んでも、2つ目は作らない（フロントマターの memoId で判定）。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'posts');

function findLatestExport() {
  const candidates = [join(homedir(), 'Downloads'), join(homedir(), 'OneDrive', 'Downloads')];
  let best = null;
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/^kakidame-export-.*\.json$/.test(f)) continue;
      const p = join(dir, f);
      const t = statSync(p).mtimeMs;
      if (!best || t > best.t) best = { p, t };
    }
  }
  return best && best.p;
}

// YAML の文字列として安全に書く（JSON の文字列は YAML としても正しい）
const q = (s) => JSON.stringify(String(s));

function makeSummary(body) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? flat.slice(0, 80) + '…' : flat;
}

function makeTitle(memo) {
  if (memo.title.trim()) return memo.title.trim();
  const firstLine = memo.body.trim().split(/\r?\n/)[0] || '無題';
  return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
}

function existingMemoIds() {
  const ids = new Set();
  if (!existsSync(POSTS_DIR)) return ids;
  for (const f of readdirSync(POSTS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const m = readFileSync(join(POSTS_DIR, f), 'utf-8').match(/^memoId:\s*"?([^"\r\n]+)"?/m);
    if (m) ids.add(m[1].trim());
  }
  return ids;
}

const file = process.argv[2] || findLatestExport();
if (!file || !existsSync(file)) {
  console.log('書き出しファイルが見つかりません。');
  console.log('書きためノートで「📤 HP用に選ぶ」→「書き出す」をしてから、もう一度実行してください。');
  console.log('ファイルを直接指定するとき:  npm run import-memos -- "C:\\...\\kakidame-export-xxxx.json"');
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, 'utf-8'));
const memos = Array.isArray(data.memos) ? data.memos : [];
console.log(`読み込み: ${file}（${memos.length}件）\n`);

mkdirSync(POSTS_DIR, { recursive: true });
const known = existingMemoIds();
let created = 0;

for (const memo of memos) {
  memo.title = String(memo.title || '');
  memo.body = String(memo.body || '');
  if (known.has(memo.id)) {
    console.log(`  - とばしました（取り込み済み）: ${makeTitle(memo)}`);
    continue;
  }
  const date = (memo.createdAt || new Date().toISOString()).slice(0, 10);
  const slug = `memo-${String(memo.id).slice(0, 8).toLowerCase()}`;
  const filename = `${date}-${slug}.md`;
  const tags = (memo.tags || []).map(q).join(', ');

  const md = `---
title: ${q(makeTitle(memo))}
date: ${date}
tags: [${tags}]
summary: ${q(makeSummary(memo.body))}
draft: true
memoId: ${q(memo.id)}
---

${memo.body.trim()}
`;
  writeFileSync(join(POSTS_DIR, filename), md, 'utf-8');
  known.add(memo.id);
  created++;
  console.log(`  ✓ posts/${filename}  ${makeTitle(memo)}`);
}

console.log(`\n${created}件の下書きを作りました。`);
if (created) {
  console.log('公開する前に読み直してください（お子さんの名前・学校名・住んでいる地域などが入っていないか）。');
  console.log('公開してよい記事は  draft: true  を  draft: false  に変えてから  npm run build  します。');
}
