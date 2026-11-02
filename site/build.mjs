// posts/*.md から静的サイトを生成して docs/ に書き出す（GitHub Pages 公開用）。
//
//   npm run build     … 公開用。docs/ に出力（draft: true の記事は入らない）
//   npm run preview   … 確認用。preview/ に下書きも含めて出力（公開はされない）
//
// 書き方: posts/ に Markdown ファイルを置く。ファイル名は自由（例: 2026-09-25-hajimemashite.md）。
// 先頭に --- で囲んだフロントマター（title / date / tags / summary / draft）を書く。
// 「このサイトについて」ページは site/about.md に書く（draft: false にすると公開される）。

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { marked } from 'marked';
import YAML from 'yaml';
import { SITE } from './config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const POSTS_DIR = join(ROOT, 'posts');
const ABOUT_FILE = join(ROOT, 'site', 'about.md');
const PREVIEW = process.argv.includes('--drafts');
const OUT_DIR = join(ROOT, PREVIEW ? 'preview' : 'docs');

// 書きためノートの文章は1行ずつ改行しているので、改行をそのまま改行として表示する
marked.setOptions({ breaks: true });

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

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

function parseMarkdownFile(path, label) {
  const raw = readFileSync(path, 'utf-8');
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${label}: 先頭にフロントマター（--- で囲んだ設定）が見つかりません`);
  return { meta: YAML.parse(m[1]) || {}, body: m[2] || '' };
}

function parsePost(filename) {
  const { meta, body } = parseMarkdownFile(join(POSTS_DIR, filename), filename);
  if (!meta.title) throw new Error(`${filename}: title がありません`);
  if (!meta.date) throw new Error(`${filename}: date がありません（例: 2026-09-25）`);

  const dateOnlyMatch = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  const slugBase = dateOnlyMatch ? dateOnlyMatch[2] : filename.replace(/\.md$/, '');

  return {
    filename,
    title: String(meta.title),
    date: String(meta.date).slice(0, 10),
    tags: Array.isArray(meta.tags) ? meta.tags.map(String).filter(Boolean) : [],
    summary: meta.summary ? String(meta.summary) : '',
    draft: !!meta.draft,
    slug: slugify(meta.slug || slugBase),
    html: marked.parse(body),
  };
}

// --- 部品 ----------------------------------------------------------------------
// root はページから見たサイトのいちばん上への相対パス（例: '../../'）

function tagLink(tag, root, count) {
  return `<a class="tag" href="${root}tags/${encodeURIComponent(slugify(tag))}/index.html">#${esc(tag)}${
    count != null ? `<span class="tag-count">${count}</span>` : ''
  }</a>`;
}

function draftMark(post) {
  return post.draft ? '<span class="draft-mark">下書き</span>' : '';
}

function layout({ title, description, bodyHtml, root, current, hasAbout }) {
  const pageTitle = title ? `${title} | ${SITE.title}` : SITE.title;
  const nav = [
    { key: 'home', href: `${root}index.html`, label: '記事' },
    { key: 'tags', href: `${root}tags/index.html`, label: 'テーマ' },
    ...(hasAbout ? [{ key: 'about', href: `${root}about/index.html`, label: 'このサイトについて' }] : []),
  ];
  return `<!DOCTYPE html>
<html lang="${SITE.language}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description || SITE.description)}">
<meta property="og:title" content="${esc(title || SITE.title)}">
<meta property="og:description" content="${esc(description || SITE.description)}">
<meta property="og:type" content="${title ? 'article' : 'website'}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700&family=Noto+Sans+JP:wght@400;500;700&display=swap">
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
${PREVIEW ? '<div class="preview-banner">プレビュー（下書きも表示中・公開はされていません）</div>' : ''}
<header class="site-header">
  <div class="site-header-inner">
    <a class="site-title" href="${root}index.html">
      <span class="site-mark" aria-hidden="true">🌱</span>${esc(SITE.title)}
    </a>
    <nav class="site-nav" aria-label="サイト内メニュー">
      ${nav
        .map((n) => `<a href="${n.href}"${n.key === current ? ' aria-current="page"' : ''}>${n.label}</a>`)
        .join('\n      ')}
    </nav>
  </div>
</header>
<main>
${bodyHtml}
</main>
<footer class="site-footer">
  <p class="footer-title">${esc(SITE.title)}</p>
  <p>${esc(SITE.footerNote)}</p>
</footer>
</body>
</html>
`;
}

function postCard(post, root) {
  return `<article class="post-card">
  <a class="post-card-link" href="${root}posts/${post.slug}/index.html">
    <p class="meta"><time datetime="${post.date}">${formatDate(post.date)}</time>${draftMark(post)}</p>
    <h2>${esc(post.title)}</h2>
    ${post.summary ? `<p class="summary">${esc(post.summary)}</p>` : ''}
  </a>
  ${post.tags.length ? `<p class="tags">${post.tags.map((t) => tagLink(t, root)).join('')}</p>` : ''}
</article>`;
}

function postList(posts, root) {
  return posts.length
    ? `<div class="post-list">\n${posts.map((p) => postCard(p, root)).join('\n')}\n</div>`
    : '<p class="empty">まだ記事がありません。</p>';
}

// --- ページ -------------------------------------------------------------------

function buildIndex(posts, tagMap, hasAbout) {
  const root = '';
  const topTags = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  const body = `<section class="hero">
  <p class="hero-eyebrow">${esc(SITE.tagline)}</p>
  <h1>${esc(SITE.title)}</h1>
  <p class="hero-lede">${esc(SITE.description)}</p>
  ${hasAbout ? `<p class="hero-more"><a href="about/index.html">このサイトについて →</a></p>` : ''}
</section>
${
  topTags.length
    ? `<section class="tag-cloud" aria-labelledby="tag-cloud-h">
  <h2 id="tag-cloud-h" class="section-title">テーマからさがす</h2>
  <p class="tags">${topTags.map(([t, ps]) => tagLink(t, root, ps.length)).join('')}</p>
</section>`
    : ''
}
<section aria-labelledby="latest-h">
  <h2 id="latest-h" class="section-title">新しい記事</h2>
  ${postList(posts, root)}
</section>`;
  return layout({ title: '', description: SITE.description, bodyHtml: body, root, current: 'home', hasAbout });
}

function buildTagIndex(tagMap, hasAbout) {
  const root = '../';
  const all = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'));
  const body = `<section class="page-head">
  <h1>テーマ</h1>
  <p class="page-lede">気になるテーマを選ぶと、関係する記事だけが並びます。</p>
</section>
${all.length ? `<p class="tags tags-large">${all.map(([t, ps]) => tagLink(t, root, ps.length)).join('')}</p>` : '<p class="empty">まだテーマがありません。</p>'}`;
  return layout({ title: 'テーマ', description: 'テーマ別の記事一覧', bodyHtml: body, root, current: 'tags', hasAbout });
}

function buildTagPage(tag, posts, hasAbout) {
  const root = '../../';
  const body = `<section class="page-head">
  <p class="page-eyebrow"><a href="../index.html">テーマ</a></p>
  <h1>#${esc(tag)}</h1>
  <p class="page-lede">${posts.length}件の記事</p>
</section>
${postList(posts, root)}`;
  return layout({ title: `#${tag}`, description: `「${tag}」の記事一覧`, bodyHtml: body, root, current: 'tags', hasAbout });
}

function buildPostPage(post, newer, older, hasAbout) {
  const root = '../../';
  const navLink = (p, cls, label) =>
    p
      ? `<a class="${cls}" href="../${p.slug}/index.html"><span class="pager-label">${label}</span><span class="pager-title">${esc(p.title)}</span></a>`
      : '<span></span>';
  const body = `<article class="post">
  <header class="post-head">
    <p class="meta"><time datetime="${post.date}">${formatDate(post.date)}</time>${draftMark(post)}</p>
    <h1>${esc(post.title)}</h1>
    ${post.tags.length ? `<p class="tags">${post.tags.map((t) => tagLink(t, root)).join('')}</p>` : ''}
  </header>
  <div class="post-body">
${post.html}
  </div>
</article>
<nav class="pager" aria-label="前後の記事">
  ${navLink(older, 'pager-prev', '← 前の記事')}
  ${navLink(newer, 'pager-next', '次の記事 →')}
</nav>
<p class="back"><a href="${root}index.html">記事の一覧へ</a></p>`;
  return layout({ title: post.title, description: post.summary, bodyHtml: body, root, current: 'home', hasAbout });
}

function buildAboutPage(about) {
  const root = '../';
  const body = `<article class="post">
  <header class="post-head">
    <h1>${esc(about.title)}</h1>
  </header>
  <div class="post-body">
${about.html}
  </div>
</article>`;
  return layout({ title: about.title, description: SITE.description, bodyHtml: body, root, current: 'about', hasAbout: true });
}

function writePage(relDir, html) {
  const dir = join(OUT_DIR, relDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), html, 'utf-8');
}

// --- ビルド本体 -------------------------------------------------------------

if (!existsSync(POSTS_DIR)) mkdirSync(POSTS_DIR, { recursive: true });

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
const posts = [];
for (const f of files) {
  try {
    const post = parsePost(f);
    if (!post.draft || PREVIEW) posts.push(post);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}
posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.slug.localeCompare(b.slug)));

let about = null;
if (existsSync(ABOUT_FILE)) {
  try {
    const { meta, body } = parseMarkdownFile(ABOUT_FILE, 'site/about.md');
    if (!meta.draft || PREVIEW) about = { title: String(meta.title || 'このサイトについて'), html: marked.parse(body) };
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}

if (process.exitCode) {
  console.error('\nエラーがあるためビルドを中止しました。');
  process.exit(1);
}

const tagMap = new Map();
for (const p of posts) {
  for (const t of p.tags) {
    if (!tagMap.has(t)) tagMap.set(t, []);
    tagMap.get(t).push(p);
  }
}
const hasAbout = !!about;

// 出力先を作り直す
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

writeFileSync(join(OUT_DIR, 'index.html'), buildIndex(posts, tagMap, hasAbout), 'utf-8');
posts.forEach((post, i) => {
  writePage(join('posts', post.slug), buildPostPage(post, posts[i - 1], posts[i + 1], hasAbout));
});
writePage('tags', buildTagIndex(tagMap, hasAbout));
for (const [tag, ps] of tagMap) writePage(join('tags', slugify(tag)), buildTagPage(tag, ps, hasAbout));
if (about) writePage('about', buildAboutPage(about));

copyFileSync(join(ROOT, 'site', 'style.css'), join(OUT_DIR, 'style.css'));
writeFileSync(join(OUT_DIR, '.nojekyll'), '');

const where = PREVIEW ? 'preview/' : 'docs/';
const draftCount = files.length - posts.filter((p) => !p.draft).length;
console.log(
  `✓ ${posts.length} 件の記事を ${where} に生成しました${
    !PREVIEW && draftCount ? `（下書き ${draftCount} 件は除外）` : ''
  }。`,
);
for (const p of posts) console.log(`  - ${p.date} ${p.title}${p.draft ? '（下書き）' : ''}`);
if (PREVIEW) console.log(`\nブラウザで開く: ${join(OUT_DIR, 'index.html')}`);
