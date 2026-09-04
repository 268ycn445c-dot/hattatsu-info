// ① RSS を巡回して新着記事の本文を取得し、DB に保存する
//
//   node src/fetch.mjs                 … enabled な全ソースを巡回
//   node src/fetch.mjs --source <id>   … 特定ソースだけ
//   node src/fetch.mjs --limit 5       … 1ソースあたりの取得上限（既定 15）
//   node src/fetch.mjs --all           … enabled=false も含めて巡回

import Parser from 'rss-parser';
import { extract } from '@extractus/article-extractor';
import { getDb, loadSources, sha1, htmlToText, nowIso, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const onlySource = getOpt('--source', null);
const perSourceLimit = parseInt(getOpt('--limit', '15'), 10);
const includeDisabled = args.includes('--all');

const parser = new Parser({ timeout: 20000 });
const db = getDb();

const insert = db.prepare(`
  INSERT INTO articles
    (source_id, source_name, source_trust, url, title, author, published_at,
     fetched_at, feed_summary, content, content_hash, word_count, status)
  VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const existsUrl = db.prepare('SELECT 1 FROM articles WHERE url = ?');
const existsHash = db.prepare('SELECT 1 FROM articles WHERE content_hash = ?');

let sources = loadSources();
if (!includeDisabled) sources = sources.filter((s) => s.enabled);
if (onlySource) sources = sources.filter((s) => s.id === onlySource);

if (sources.length === 0) {
  console.log('巡回対象のソースがありません。config/sources.yaml で enabled: true にしてください。');
  process.exit(0);
}

let added = 0;
let skipped = 0;
let failed = 0;

for (const src of sources) {
  console.log(`\n▶ ${src.name || src.id}  (${src.rss})`);
  let feed;
  try {
    feed = await parser.parseURL(src.rss);
  } catch (err) {
    console.log(`  ✗ フィード取得失敗: ${err.message}`);
    failed++;
    continue;
  }

  const items = (feed.items || []).slice(0, perSourceLimit);
  for (const item of items) {
    const url = item.link?.trim();
    if (!url) continue;
    if (existsUrl.get(url)) {
      skipped++;
      continue;
    }

    let text = '';
    let title = item.title?.trim() || '';
    let author = item.creator || item.author || feed.title || '';
    try {
      const article = await extract(url);
      text = htmlToText(article?.content || '');
      if (article?.title) title = article.title.trim();
      if (article?.author) author = article.author;
    } catch {
      // 本文抽出に失敗したらフィードの内容で代替
      text = htmlToText(item['content:encoded'] || item.content || item.contentSnippet || '');
    }

    if (text.length < 200) {
      // 本文がほぼ取れていない記事は後段で使い物にならないので保存しない
      skipped++;
      continue;
    }

    const hash = sha1(text.slice(0, 4000));
    if (existsHash.get(hash)) {
      skipped++;
      continue;
    }

    const publishedAt = item.isoDate || item.pubDate || null;
    insert.run(
      src.id,
      src.name || src.id,
      src.trust || null,
      url,
      title,
      author || null,
      publishedAt,
      nowIso(),
      (item.contentSnippet || '').slice(0, 500) || null,
      text,
      hash,
      text.length,
      'new',
    );
    added++;
    console.log(`  + ${title.slice(0, 60)}`);
    await sleep(1200); // 相手サイトへの負荷を抑える
  }
}

console.log(`\n完了: 新規 ${added} 件 / スキップ ${skipped} 件 / フィード失敗 ${failed} 件`);
console.log('次は  npm run enrich  で要約・分類します。');
db.close();
process.exit(0); // article-extractor が内部タイマーを残すことがあるため明示終了
