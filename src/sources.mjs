// ブログ候補のレビュー（確認 → 承認/却下）
//
//   node src/sources.mjs                    … 候補(candidate)一覧
//   node src/sources.mjs approved            … 承認済み一覧
//   node src/sources.mjs rejected            … 却下済み一覧
//   node src/sources.mjs approve <id>        … 承認 → 次の fetch から巡回対象になる
//   node src/sources.mjs approve <id> --trust high
//   node src/sources.mjs reject <id>
//   node src/sources.mjs setrss <id> <url>   … RSSが自動検出できなかった候補に手動でURLを設定
//   node src/sources.mjs add <url> --name "サイト名"   … 手動で候補を追加（RSSは自動検出）

import { getDb, syncYamlSources, siteKey, slugify, uniqueSlug, detectRss, nowIso } from './lib.mjs';

const db = getDb();
syncYamlSources(db);

const [, , cmd, ...rest] = process.argv;
const getOpt = (name, def) => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? rest[i + 1] : def;
};

function list(status, label) {
  const rows = db.prepare('SELECT * FROM sources WHERE status = ? ORDER BY id DESC').all(status);
  console.log(`【${label}】 ${rows.length} 件\n`);
  for (const r of rows) {
    console.log(`#${r.id} ${r.name}  [${r.discovery}]`);
    console.log(`   ${r.site_url}`);
    console.log(`   RSS: ${r.rss || '未検出（setrss で手動設定）'}`);
    if (r.reason) console.log(`   理由: ${r.reason}`);
    console.log();
  }
  if (status === 'candidate' && rows.length) {
    console.log('承認:  npm run sources -- approve <id>');
    console.log('却下:  npm run sources -- reject <id>');
  }
}

function approve(id) {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) return console.log(`id=${id} は見つかりません。`);
  if (!row.rss) {
    console.log(`RSS が未検出のため承認できません。先に設定してください:`);
    console.log(`  npm run sources -- setrss ${id} <RSS URL>`);
    return;
  }
  const trust = getOpt('--trust', row.trust);
  db.prepare("UPDATE sources SET status='approved', trust=?, reviewed_at=? WHERE id=?").run(trust, nowIso(), id);
  console.log(`✓ 承認しました: ${row.name}`);
  console.log('取得を試す:  npm run fetch');
}

function reject(id) {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) return console.log(`id=${id} は見つかりません。`);
  db.prepare("UPDATE sources SET status='rejected', reviewed_at=? WHERE id=?").run(nowIso(), id);
  console.log(`✗ 却下しました: ${row.name}`);
}

async function setrss(id, url) {
  const row = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) return console.log(`id=${id} は見つかりません。`);
  db.prepare('UPDATE sources SET rss = ? WHERE id = ?').run(url, id);
  console.log(`RSS を設定しました: ${row.name} → ${url}`);
}

async function add(url) {
  const name = getOpt('--name', url);
  let key;
  try {
    key = siteKey(url);
  } catch {
    return console.log('URL が不正です。');
  }
  const dupe = db.prepare('SELECT id, status FROM sources WHERE site_key = ?').get(key);
  if (dupe) return console.log(`既に登録されています (id=${dupe.id}, status=${dupe.status})`);

  process.stdout.write(`RSS検出中: ${url} … `);
  const rss = await detectRss(url);
  console.log(rss ? '見つかりました' : '見つかりませんでした');

  const slug = uniqueSlug(db, slugify(key));
  db.prepare(`
    INSERT INTO sources (slug, site_key, name, site_url, rss, status, discovery, reason, discovered_at)
    VALUES (?, ?, ?, ?, ?, 'candidate', 'manual', '手動追加', ?)
  `).run(slug, key, name, url, rss, nowIso());
  console.log(`候補として追加しました。確認: npm run sources`);
}

const id = rest[0];
switch (cmd) {
  case undefined:
  case 'candidates':
    list('candidate', '候補（要レビュー）');
    break;
  case 'approved':
    list('approved', '承認済み');
    break;
  case 'rejected':
    list('rejected', '却下済み');
    break;
  case 'approve':
    approve(id);
    break;
  case 'reject':
    reject(id);
    break;
  case 'setrss':
    await setrss(id, rest[1]);
    break;
  case 'add':
    await add(id);
    break;
  default:
    console.log(`不明なコマンド: ${cmd}`);
}

db.close();
process.exit(0);
