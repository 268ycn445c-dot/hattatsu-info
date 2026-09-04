# hattatsu-info

発達障害（ASD・ADHD・LD など）の子育て情報を、ネット上のブログ・メディアから
自動で集めて整理するための収集パイプライン。
将来的に「悩む保護者向けの情報サイト」を生成することを目的にしている。

現時点で動くのは **①取得 → ②加工（要約・分類）→ ③確認** まで。
（レビューUI・サイト生成・公開は次のステップ）

## 全体像

```
config/sources.yaml  RSS一覧を手で登録
        │
   ① npm run fetch    フィード巡回 → 本文抽出 → data/articles.db に保存
        │
   ② npm run enrich   Claude で 要約・要点・タグ・カテゴリ・注意フラグ を付与
        │
   ③ npm run show     結果を一覧・確認（人間のレビュー）
        │
   （今後）レビュー承認 → 静的サイト生成 → GitHub Pages で公開
```

## セットアップ

```bash
cd hattatsu-info
npm install

# Claude API キー（②で使用）
setx ANTHROPIC_API_KEY "sk-ant-..."   # PowerShell。設定後にターミナルを開き直す
```

Node.js 22 以降が必要（`node:sqlite` を使用）。

## 使い方

### 1. 情報源を登録する

`config/sources.yaml` を編集し、巡回したいブログの RSS URL を追加して
`enabled: true` にする。RSS URL の見つけ方はファイル内のコメント参照。

### 2. 取得

```bash
npm run fetch                      # enabled な全ソース
npm run fetch -- --source foo      # 特定ソースだけ
npm run fetch -- --limit 5         # 1ソースあたりの取得件数（既定15）
```

- 本文が 200 字未満の記事、既出 URL、本文がほぼ同一の記事は自動スキップ
- 相手サイトへの負荷を考え、記事ごとに約1.2秒待機する

### 3. 加工（要約・分類）

```bash
npm run enrich                     # 未処理を最大20件
npm run enrich -- --limit 50
npm run enrich -- --retry          # 失敗した記事を再試行
```

モデルは既定で `claude-opus-5`。大量に回してコストを抑えたいときは:

```bash
setx HATTATSU_MODEL "claude-sonnet-5"
```

各記事について次を生成する:
要約 / 要点 / タグ / カテゴリ / 対象年齢 / 読者 / **注意フラグ**（根拠の乏しい主張・
断定的な治療効果の宣伝・エビデンスのない民間療法など）/ 有用性スコア / 信頼性所見。

### 4. 確認

```bash
npm run show                       # 加工済み（レビュー待ち）一覧
npm run show -- new                # 未加工
npm run show -- cautions           # 注意フラグ付きだけ
npm run show -- stats              # 件数サマリ
npm run show -- 42                 # id=42 の詳細
```

## データと著作権の扱い

- `data/articles.db`（SQLite）はローカルのみ。`.gitignore` 済みでコミットしない。
- 抽出した**本文全文はローカル処理のためだけ**に保存する。
- 公開サイトに載せるのは「要約・短い引用・元記事へのリンク・出典表記」に限る想定。

## データベース構造

- `articles` … 取得した記事（本文・出典・状態 `new/enriched/approved/rejected/error`）
- `enrichment` … Claude が付けたメタデータ（`article_id` で 1:1）

## 今後の予定

- [ ] レビューUI（承認/却下/修正を Web 画面で）
- [ ] 承認済み記事からの静的サイト生成（記事フィード＋テーマ別まとめ）
- [ ] テーマ解説の自動生成（承認済み記事を根拠に概説を執筆）
- [ ] GitHub Pages への公開
- [ ] RSS の無いサイト、Instagram 等への対応
