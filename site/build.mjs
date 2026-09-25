// posts/*.md から静的サイトを生成して docs/ に書き出す（GitHub Pages 公開用）。
//
//   npm run build
//
// 書き方: posts/ に Markdown ファイルを置く。ファイル名は自由（例: 2026-09-25-hajimemashite.md）。
// 先頭に --- で囲んだフロントマター（title / date / tags / summary / draft）を書く。
// draft: true の記事はビルドから除外される（下書き）。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';
import YAML from 'yaml';
import { SITE } from './config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'posts');
const OUT_DIR = join(ROOT, 'docs');

function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'post'
  );
}

function parsePost(filename) {
  const raw = readFileSync(join(POSTS_DIR, filename), 'utf-8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    throw new Error(`${filename}: 先頭にフロントマター（--- で囲んだ設定）が見つかりません`);
  }
  const meta = YAML.parse(m[1]) || {};
  const body = m[2] || '';

  if (!meta.title) throw new Error(`${filename}: title がありません`);
  if (!meta.date) throw new Error(`${filename}: date がありません（例: 2026-09-25）`);

  const dateOnlyMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  const slugBase = dateOnlyMatch ? dateOnlyMatch[2] : filename.replace(/\.md$/, '');

  return {
    filename,
    title: String(meta.title),
    date: String(meta.date).slice(0, 10),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    summary: meta.summary ? String(meta.summary) : '',
    draft: !!meta.draft,
    slug: slugify(meta.slug || slugBase),
    html: marked.parse(body),
  };
}

function layout({ title, description, bodyHtml, isPost = false }) {
  const pageTitle = title ? `${title} - ${SITE.title}` : SITE.title;
  return `<!DOCTYPE html>
<html lang="${SITE.language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description || SITE.description)}">
<link rel="stylesheet" href="${isPost ? '../../' : ''}style.css">
</head>
<body>
<header class="site-header">
  <a class="site-title" href="${isPost ? '../../' : ''}index.html">${esc(SITE.title)}</a>
  <p class="site-desc">${esc(SITE.description)}</p>
</header>
<main>
${bodyHtml}
</main>
<footer class="site-footer">
  <p>${esc(SITE.title)}</p>
</footer>
</body>
</html>
`;
}

function postCard(post) {
  return `<article class="post-card">
  <h2><a href="posts/${post.slug}/index.html">${esc(post.title)}</a></h2>
  <p class="meta"><time datetime="${post.date}">${post.date}</time>${
    post.tags.length ? '　' + post.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ') : ''
  }</p>
  ${post.summary ? `<p class="summary">${esc(post.summary)}</p>` : ''}
</article>`;
}

function buildIndex(posts) {
  const body = posts.length
    ? posts.map(postCard).join('\n')
    : '<p>まだ記事がありません。</p>';
  return layout({ title: '', description: SITE.description, bodyHtml: `<div class="post-list">${body}</div>` });
}

function buildPostPage(post) {
  const body = `<article class="post">
  <h1>${esc(post.title)}</h1>
  <p class="meta"><time datetime="${post.date}">${post.date}</time>${
    post.tags.length ? '　' + post.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join(' ') : ''
  }</p>
  <div class="post-body">
${post.html}
  </div>
  <p class="back"><a href="../../index.html">← 記事一覧へ戻る</a></p>
</article>`;
  return layout({ title: post.title, description: post.summary, bodyHtml: body, isPost: true });
}

// --- ビルド本体 -------------------------------------------------------------

if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  try {
    const post = parsePost(f);
    if (!post.draft) posts.push(post);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}
posts.sort((a, b) => (a.date < b.date ? 1 : -1));

if (process.exitCode) {
  console.error('\nエラーがあるためビルドを中止しました。');
  process.exit(1);
}

// 出力先を作り直す
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(OUT_DIR, 'posts'), { recursive: true });

writeFileSync(join(OUT_DIR, 'index.html'), buildIndex(posts), 'utf-8');
for (const post of posts) {
  const dir = join(OUT_DIR, 'posts', post.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), buildPostPage(post), 'utf-8');
}

copyFileSync(join(ROOT, 'site', 'style.css'), join(OUT_DIR, 'style.css'));
writeFileSync(join(OUT_DIR, '.nojekyll'), '');

const draftCount = files.length - posts.length;
console.log(`✓ ${posts.length} 件の記事を docs/ に生成しました${draftCount ? `（下書き ${draftCount} 件は除外）` : ''}。`);
for (const p of posts) console.log(`  - ${p.date} ${p.title}`);
