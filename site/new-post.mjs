// 新しい記事のひな形を posts/ に作成する。
//
//   npm run new-post -- "タイトル"

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'posts');

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  console.log('使い方:  npm run new-post -- "記事のタイトル"');
  process.exit(1);
}

const slug = title
  .toLowerCase()
  .trim()
  .replace(/[^\p{L}\p{N}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40) || 'post';

const date = new Date().toISOString().slice(0, 10);
const filename = `${date}-${slug}.md`;
const filepath = join(POSTS_DIR, filename);

if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });
if (existsSync(filepath)) {
  console.log(`既に存在します: posts/${filename}`);
  process.exit(1);
}

const template = `---
title: "${title}"
date: ${date}
tags: []
summary: ""
draft: true
---

ここに本文を Markdown で書きます。

書き終わって公開したくなったら、フロントマターの \`draft: true\` を \`draft: false\`
にしてから \`npm run build\` します。
`;

writeFileSync(filepath, template, 'utf-8');
console.log(`作成しました: posts/${filename}`);
console.log('編集してから  npm run build  でサイトを生成できます。');
