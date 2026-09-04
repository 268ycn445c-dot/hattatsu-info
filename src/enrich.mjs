// ② 未処理の記事を Claude に渡して、要約・要点・タグ・カテゴリ・注意フラグを付ける
//
//   node src/enrich.mjs               … status=new を最大 20 件処理
//   node src/enrich.mjs --limit 50    … 上限を変更
//   node src/enrich.mjs --retry       … status=error も対象に含める
//
// モデルは環境変数 HATTATSU_MODEL で変更可（既定: claude-opus-5）。
// 大量処理でコストを抑えたいときは HATTATSU_MODEL=claude-sonnet-5 が目安。

import Anthropic from '@anthropic-ai/sdk';
import { getDb, nowIso, sleep, CATEGORIES, AGE_RANGES, AUDIENCES } from './lib.mjs';

const args = process.argv.slice(2);
const limitI = args.indexOf('--limit');
const limit = limitI >= 0 && args[limitI + 1] ? parseInt(args[limitI + 1], 10) : 20;
const includeErrors = args.includes('--retry');
const MODEL = process.env.HATTATSU_MODEL || 'claude-opus-5';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('環境変数 ANTHROPIC_API_KEY が設定されていません。');
  process.exit(1);
}

const client = new Anthropic();
const db = getDb();

const statuses = includeErrors ? "('new','error')" : "('new')";
const rows = db
  .prepare(`SELECT * FROM articles WHERE status IN ${statuses} ORDER BY id LIMIT ?`)
  .all(limit);

if (rows.length === 0) {
  console.log('処理対象の記事がありません。先に  npm run fetch  を実行してください。');
  process.exit(0);
}

const upsert = db.prepare(`
  INSERT INTO enrichment
    (article_id, summary, key_points, tags, category, age_range, audience,
     caution_flag, caution_note, usefulness, reliability_reason, model, enriched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(article_id) DO UPDATE SET
    summary=excluded.summary, key_points=excluded.key_points, tags=excluded.tags,
    category=excluded.category, age_range=excluded.age_range, audience=excluded.audience,
    caution_flag=excluded.caution_flag, caution_note=excluded.caution_note,
    usefulness=excluded.usefulness, reliability_reason=excluded.reliability_reason,
    model=excluded.model, enriched_at=excluded.enriched_at
`);
const setStatus = db.prepare('UPDATE articles SET status = ? WHERE id = ?');

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: '発達障害の子育てに悩む保護者向けの日本語要約。150〜250字。中立的に。' },
    key_points: { type: 'array', items: { type: 'string' }, description: '記事の要点。2〜5個の短い箇条書き。' },
    tags: { type: 'array', items: { type: 'string' }, description: '検索・分類用の日本語タグ。3〜6個。' },
    category: { type: 'string', enum: CATEGORIES },
    age_range: { type: 'string', enum: AGE_RANGES },
    audience: { type: 'string', enum: AUDIENCES },
    caution_flag: {
      type: 'boolean',
      description:
        '医学的根拠が乏しい主張、断定的な治療効果の宣伝、エビデンスのない民間療法、特定商品への誘導などが含まれる場合は true。',
    },
    caution_note: { type: 'string', description: 'caution_flag が true の理由。false なら空文字列。' },
    usefulness: { type: 'integer', minimum: 1, maximum: 5, description: '悩む保護者にとっての有用性（1=低い, 5=高い）。' },
    reliability_reason: { type: 'string', description: '情報の信頼性についての短い所見（出典の明示、体験談か一般論か等）。' },
  },
  required: [
    'summary', 'key_points', 'tags', 'category', 'age_range', 'audience',
    'caution_flag', 'caution_note', 'usefulness', 'reliability_reason',
  ],
  additionalProperties: false,
};

const SYSTEM = `あなたは発達障害（ASD・ADHD・LD など）の子育て情報を整理する編集者です。
与えられたブログ記事等を読み、保護者向け情報サイトに載せるためのメタデータを作成します。
誇張や決めつけを避け、事実に即して中立にまとめてください。日本語で回答します。`;

let ok = 0;
let err = 0;

for (const a of rows) {
  const body = (a.content || '').slice(0, 8000);
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `媒体名: ${a.source_name}\nタイトル: ${a.title}\nURL: ${a.url}\n\n本文:\n${body}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    });

    const textBlock = res.content.find((b) => b.type === 'text');
    const data = JSON.parse(textBlock.text);

    upsert.run(
      a.id,
      data.summary,
      JSON.stringify(data.key_points),
      JSON.stringify(data.tags),
      data.category,
      data.age_range,
      data.audience,
      data.caution_flag ? 1 : 0,
      data.caution_note || '',
      data.usefulness,
      data.reliability_reason || '',
      MODEL,
      nowIso(),
    );
    setStatus.run('enriched', a.id);
    ok++;
    const mark = data.caution_flag ? ' ⚠' : '';
    console.log(`✓ [${data.category}] ${a.title.slice(0, 50)}${mark}`);
  } catch (e) {
    setStatus.run('error', a.id);
    err++;
    console.log(`✗ id=${a.id} ${a.title.slice(0, 50)} — ${e.message}`);
  }
  await sleep(500);
}

console.log(`\n完了: 成功 ${ok} 件 / 失敗 ${err} 件`);
console.log('結果を見る:  npm run show');
db.close();
process.exit(0);
