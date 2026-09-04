// ③ 取り込み結果を確認する（レビュー用の簡易ビュー）
//
//   node src/show.mjs             … 加工済み(enriched)の記事を一覧
//   node src/show.mjs new         … 未加工の記事
//   node src/show.mjs error       … 加工に失敗した記事
//   node src/show.mjs cautions    … 注意フラグ付きの記事だけ
//   node src/show.mjs stats       … 件数サマリ
//   node src/show.mjs <id>        … 1件の詳細（要約・要点・本文冒頭）

import { getDb } from './lib.mjs';

const db = getDb();
const arg = (process.argv[2] || 'enriched').trim();

function stats() {
  const byStatus = db.prepare('SELECT status, COUNT(*) n FROM articles GROUP BY status').all();
  const total = db.prepare('SELECT COUNT(*) n FROM articles').get().n;
  const cautions = db
    .prepare('SELECT COUNT(*) n FROM enrichment WHERE caution_flag = 1')
    .get().n;
  console.log(`記事 合計: ${total} 件`);
  for (const r of byStatus) console.log(`  ${r.status.padEnd(10)} ${r.n}`);
  console.log(`注意フラグ付き: ${cautions} 件`);
  const byCat = db
    .prepare(
      'SELECT category, COUNT(*) n FROM enrichment GROUP BY category ORDER BY n DESC',
    )
    .all();
  if (byCat.length) {
    console.log('\nカテゴリ別:');
    for (const r of byCat) console.log(`  ${(r.category || '未分類').padEnd(24)} ${r.n}`);
  }
}

function detail(id) {
  const a = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!a) return console.log(`id=${id} は見つかりません。`);
  const e = db.prepare('SELECT * FROM enrichment WHERE article_id = ?').get(id);
  console.log(`\n■ ${a.title}`);
  console.log(`  ${a.url}`);
  console.log(`  媒体: ${a.source_name} (信頼度メモ: ${a.source_trust || '-'}) / 公開: ${a.published_at || '-'}`);
  console.log(`  状態: ${a.status} / 本文 ${a.word_count} 字`);
  if (e) {
    console.log(`\n  カテゴリ: ${e.category} / 対象: ${e.age_range} / 読者: ${e.audience} / 有用性: ${e.usefulness}/5`);
    console.log(`  タグ: ${JSON.parse(e.tags).join(', ')}`);
    if (e.caution_flag) console.log(`  ⚠ 注意: ${e.caution_note}`);
    console.log(`  信頼性所見: ${e.reliability_reason}`);
    console.log(`\n  要約:\n  ${e.summary}`);
    console.log(`\n  要点:`);
    for (const p of JSON.parse(e.key_points)) console.log(`   - ${p}`);
  }
  console.log(`\n  本文冒頭:\n  ${(a.content || '').slice(0, 400)}...`);
}

function list(where, label) {
  const rows = db
    .prepare(
      `SELECT a.id, a.title, a.source_name, a.status, e.category, e.usefulness,
              e.caution_flag, e.summary
       FROM articles a LEFT JOIN enrichment e ON e.article_id = a.id
       ${where} ORDER BY a.id DESC LIMIT 100`,
    )
    .all();
  console.log(`【${label}】 ${rows.length} 件（最大100件表示）\n`);
  for (const r of rows) {
    const c = r.caution_flag ? ' ⚠' : '';
    const cat = r.category ? `[${r.category}] ` : '';
    const use = r.usefulness ? `★${r.usefulness} ` : '';
    console.log(`#${r.id} ${use}${cat}${r.title}${c}`);
    console.log(`     ${r.source_name}`);
    if (r.summary) console.log(`     ${r.summary.slice(0, 90)}`);
    console.log();
  }
  console.log('詳細:  npm run show -- <id>');
}

if (arg === 'stats') stats();
else if (/^\d+$/.test(arg)) detail(parseInt(arg, 10));
else if (arg === 'new') list("WHERE a.status = 'new'", '未加工');
else if (arg === 'error') list("WHERE a.status = 'error'", '加工失敗');
else if (arg === 'cautions') list('WHERE e.caution_flag = 1', '注意フラグ付き');
else list("WHERE a.status = 'enriched'", '加工済み（レビュー待ち）');

db.close();
