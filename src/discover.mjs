// ブログピックアップ: Claude の Web検索でブログ・メディア候補を探し、RSSを自動検出して
// sources テーブルに「候補(candidate)」として登録する。承認は npm run sources で行う。
//
//   node src/discover.mjs                 … 候補を約10件探す
//   node src/discover.mjs --count 15       … 件数を変える
//   node src/discover.mjs --query "ADHD 中学生 反抗期"   … 検索テーマを指定

import Anthropic from '@anthropic-ai/sdk';
import { getDb, syncYamlSources, siteKey, slugify, uniqueSlug, detectRss, nowIso } from './lib.mjs';

const args = process.argv.slice(2);
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const COUNT = parseInt(getOpt('--count', '10'), 10);
const QUERY_HINT = getOpt('--query', null);
const MODEL = process.env.HATTATSU_MODEL || 'claude-opus-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('環境変数 ANTHROPIC_API_KEY が設定されていません。');
  process.exit(1);
}

const client = new Anthropic();
const db = getDb();
syncYamlSources(db);

// 既知のサイト（承認済み・候補・却下済み全部）は再提案させない
const known = db.prepare('SELECT site_key, name FROM sources').all();
const knownList = known.length
  ? known.map((k) => `- ${k.name} (${k.site_key})`).join('\n')
  : '（まだ登録なし）';

console.log(`▶ Claude に Web 検索で候補を探させています…（既知 ${known.length} 件は除外指示）`);

// --- Step 1: Web検索で調べさせ、自由記述でまとめてもらう -------------------
const searchTheme = QUERY_HINT
  ? `特に次のテーマに関連するもの: ${QUERY_HINT}`
  : '特定のテーマに絞らず、幅広いトピック（診断直後の体験談、学校との連携、療育、きょうだい児、思春期・進路など）から探してください。';

const step1 = await client.messages.create({
  model: MODEL,
  max_tokens: 8000,
  tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }],
  messages: [
    {
      role: 'user',
      content: `発達障害（自閉スペクトラム症・ADHD・学習障害・いわゆる「グレーゾーン」）のある
子どもを育てている保護者向けに、有用な情報を発信している「個人ブログ」「noteのクリエイター」
「はてなブログ」を、日本語のWebで探してください。

条件:
- 実体験に基づく記事や、専門家・支援者による具体的で実践的な内容を書いているサイトを優先する
- 大手ポータル・企業メディア・アフィリエイト目的が強いサイトは避ける
- 断定的な治療効果を謳う怪しい民間療法サイトは候補に入れない（除外目的で見つけた場合は「除外推奨」として理由付きで報告してよい）
- ${searchTheme}
- 既に把握しているサイトは提案しない（下記リストは除外）:
${knownList}

${COUNT}件程度を目安に探し、各サイトについて「サイト名」「トップページまたはブログのURL（個別記事ではなくブログ自体のURL）」
「どんな内容を書いているか・なぜ良いと思ったか（1〜2文）」を日本語で報告してください。
箇条書きで構いません。`,
    },
  ],
});

const rawFindings = step1.content
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('\n\n');

if (!rawFindings.trim()) {
  console.log('Web検索から候補が得られませんでした（stop_reason: ' + step1.stop_reason + '）。');
  process.exit(0);
}

// --- Step 2: 自由記述を構造化 JSON に変換 ----------------------------------
const SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          url: { type: 'string', description: 'ブログ・サイトのURL（個別記事ではなくトップページ/ブログ自体）' },
          reason: { type: 'string', description: '候補にした理由。1〜2文の日本語。' },
          blog_type: {
            type: 'string',
            enum: ['個人ブログ', 'note', 'はてなブログ', '専門家・支援者', '施設・団体', 'メディア', 'その他'],
          },
          excluded_recommended: {
            type: 'boolean',
            description: '除外推奨（怪しい民間療法サイト等）として報告された場合 true',
          },
        },
        required: ['name', 'url', 'reason', 'blog_type', 'excluded_recommended'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
};

const step2 = await client.messages.create({
  model: MODEL,
  max_tokens: 4000,
  messages: [
    {
      role: 'user',
      content: `次のリストを構造化データに変換してください。URLは可能な限りそのまま使い、
不明な項目は空文字ではなく妥当な値を推測してください。\n\n${rawFindings}`,
    },
  ],
  output_config: { format: { type: 'json_schema', schema: SCHEMA } },
});

const textBlock = step2.content.find((b) => b.type === 'text');
const { candidates } = JSON.parse(textBlock.text);

// --- 重複排除 & RSS自動検出 & 登録 -----------------------------------------
const insert = db.prepare(`
  INSERT INTO sources
    (slug, site_key, name, site_url, rss, trust, category_hint, status, discovery, reason, discovered_at)
  VALUES (?, ?, ?, ?, ?, NULL, NULL, 'candidate', 'auto', ?, ?)
`);
const existsKey = db.prepare('SELECT 1 FROM sources WHERE site_key = ?');

let added = 0;
let excluded = 0;
let dup = 0;

for (const c of candidates) {
  if (c.excluded_recommended) {
    console.log(`⏭  除外推奨: ${c.name} — ${c.reason}`);
    excluded++;
    continue;
  }
  let key;
  try {
    key = siteKey(c.url);
  } catch {
    console.log(`✗ URL不正のためスキップ: ${c.name} (${c.url})`);
    continue;
  }
  if (existsKey.get(key)) {
    dup++;
    continue;
  }

  process.stdout.write(`? ${c.name} (${c.url}) … RSS検出中`);
  const rss = await detectRss(c.url);
  console.log(rss ? ` → 見つかりました` : ` → 見つかりませんでした`);

  const slug = uniqueSlug(db, slugify(key));
  insert.run(slug, key, c.name, c.url, rss, `${c.reason}（${c.blog_type}）`, nowIso());
  added++;
}

console.log(`\n完了: 新規候補 ${added} 件 / 除外推奨 ${excluded} 件 / 既知と重複 ${dup} 件`);
console.log('確認・承認:  npm run sources');
db.close();
process.exit(0);
