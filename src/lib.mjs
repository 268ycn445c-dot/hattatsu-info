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
