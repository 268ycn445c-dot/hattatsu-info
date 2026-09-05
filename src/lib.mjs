// 共通ユーティリティ: DB接続・設定読み込み・小道具
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import YAML from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'data');
export const DB_PATH = join(DATA_DIR, 'articles.db');
const SOURCES_PATH = join(ROOT, 'config', 'sources.yaml');

// 記事のカテゴリ（AI 分類の選択肢）。サイトの目次にもなる。
export const CATEGORIES = [
  '診断・特性の理解',
  '家庭での接し方・環境調整',
  '学校・園との連携',
  '支援制度・手帳・福祉サービス',
  '療育・トレーニング',
  'きょうだい児',
  '保護者のセルフケア',
  '進路・将来・自立',
  '体験談',
  'その他',
];

export const AGE_RANGES = ['未就学', '小学校低学年', '小学校高学年', '中高生', '成人期', '全般'];
export const AUDIENCES = ['保護者', '当事者', '支援者', 'その他'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT UNIQUE NOT NULL,
  site_key      TEXT UNIQUE,        -- 重複判定用（ホスト名＋note等はユーザー部分まで）
  name          TEXT,
  site_url      TEXT,
  rss           TEXT,
  trust         TEXT,
  category_hint TEXT,
  status        TEXT NOT NULL DEFAULT 'candidate',  -- candidate | approved | rejected
  discovery     TEXT NOT NULL DEFAULT 'manual',      -- manual | auto
  reason        TEXT,               -- 候補になった理由（AIの説明 / 手動メモ）
  discovered_at TEXT,
  reviewed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);

CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT NOT NULL,
  source_name   TEXT,
  source_trust  TEXT,
  url           TEXT UNIQUE NOT NULL,
  title         TEXT,
  author        TEXT,
  published_at  TEXT,
  fetched_at    TEXT NOT NULL,
  feed_summary  TEXT,
  content       TEXT,          -- 抽出した本文（ローカル処理用。公開しない）
  content_hash  TEXT,
  word_count    INTEGER,
  status        TEXT NOT NULL DEFAULT 'new'   -- new | enriched | approved | rejected | error
);
CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_hash   ON articles(content_hash);

CREATE TABLE IF NOT EXISTS enrichment (
  article_id             INTEGER PRIMARY KEY REFERENCES articles(id),
  summary                TEXT,
  key_points             TEXT,   -- JSON配列
  tags                   TEXT,   -- JSON配列
  category               TEXT,
  age_range              TEXT,
  audience               TEXT,
  caution_flag           INTEGER,
  caution_note           TEXT,
  usefulness             INTEGER,
  reliability_reason     TEXT,
  model                  TEXT,
  enriched_at            TEXT
);
`;

export function getDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(SCHEMA);
  return db;
}

export function loadSources() {
  const raw = readFileSync(SOURCES_PATH, 'utf-8');
  const parsed = YAML.parse(raw);
  return (parsed?.sources ?? []).filter((s) => s && s.rss);
}

// note.com や ameblo.jp のようにホスト名を複数の書き手が共有するプラットフォームは
// ホスト名だけでは重複判定できないので、URL の最初のパスセグメントまで含める。
const MULTI_TENANT_HOSTS = ['note.com', 'ameblo.jp', 'livedoor.blog', 'blog.livedoor.jp', 'fc2.com', 'hatenablog.jp'];

export function siteKey(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (MULTI_TENANT_HOSTS.some((d) => host === d || host.endsWith(`.${d}`))) {
    const seg = u.pathname.split('/').filter(Boolean)[0] || '';
    return `${host}/${seg}`;
  }
  return host;
}

export function slugify(key) {
  return (
    key
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'source'
  );
}

// 既存の slug と衝突しないよう連番を振る
export function uniqueSlug(db, base) {
  let slug = base;
  let n = 2;
  const exists = db.prepare('SELECT 1 FROM sources WHERE slug = ?');
  while (exists.get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

// sources.yaml で enabled: true になっている手動登録分を sources テーブルに反映する。
// 既存レコードがあれば承認状態は上書きしない（レビュー結果を壊さないため）。
export function syncYamlSources(db) {
  const upsert = db.prepare(`
    INSERT INTO sources (slug, site_key, name, site_url, rss, trust, category_hint, status, discovery, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 'manual', ?)
    ON CONFLICT(site_key) DO UPDATE SET
      rss = excluded.rss, name = excluded.name, trust = excluded.trust
  `);
  for (const s of loadSources()) {
    if (!s.enabled) continue;
    let key;
    try {
      key = siteKey(s.rss);
    } catch {
      continue; // rss が不正なURLならスキップ
    }
    const slug = s.id || slugify(key);
    upsert.run(slug, key, s.name || slug, s.rss, s.rss, s.trust || null, s.category_hint || null, nowIso());
  }
}

// 候補サイトの RSS/Atom フィードを推測して検証する。見つかれば URL を、無ければ null を返す。
export async function detectRss(siteUrl) {
  const patterns = [];
  try {
    const res = await fetch(siteUrl, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    const html = await res.text();
    const tagRe = /<link[^>]+type=["'](?:application\/rss\+xml|application\/atom\+xml)["'][^>]*>/gi;
    for (const tag of html.match(tagRe) || []) {
      const hrefM = tag.match(/href=["']([^"']+)["']/i);
      if (hrefM) {
        try {
          patterns.push(new URL(hrefM[1], siteUrl).toString());
        } catch {
          /* 無視 */
        }
      }
    }
  } catch {
    /* サイト取得に失敗しても定番パターンは試す */
  }
  const base = siteUrl.replace(/\/+$/, '');
  patterns.push(`${base}/feed`, `${base}/feed/`, `${base}/rss`, `${base}/rss/`, `${base}/?feed=rss2`);

  const { default: Parser } = await import('rss-parser');
  const parser = new Parser({ timeout: 15000 });
  const tried = new Set();
  for (const candidate of patterns) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      const feed = await parser.parseURL(candidate);
      if (feed.items && feed.items.length > 0) return candidate;
    } catch {
      /* 次の候補へ */
    }
  }
  return null;
}

export function sha1(text) {
  return createHash('sha1').update(text, 'utf-8').digest('hex');
}

// HTML をざっくりプレーンテキストに（LLM 入力用。整形品質は問わない）
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function nowIso() {
  return new Date().toISOString();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
