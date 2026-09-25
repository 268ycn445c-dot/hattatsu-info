# hattatsu-info

発達障害（ASD・ADHD・LD など）の子育てについて、自分の言葉で書いて発信するブログ。
GitHub Pages で公開する。

（他ブログを自動収集して整理する仕組みも同じリポジトリ内に作ってあるが、今は保留中。
詳細は末尾の「収集パイプライン（保留中）」を参照）

## 書き方

```bash
npm install                                  # 初回だけ
npm run new-post -- "記事のタイトル"           # posts/ にひな形を作成
```

`posts/` にできたファイルを編集する。先頭のフロントマターはこんな感じ:

```yaml
---
title: "記事のタイトル"
date: 2026-09-25
tags: ["体験談", "学校"]
summary: "一覧ページに出す一言紹介。省略可。"
draft: true          # 公開したら false にする
---

ここから本文を Markdown で書く。
```

Markdown の書き方（最低限）:

```
# 大見出し
## 中見出し

普通の段落。

- 箇条書き
- 箇条書き

**太字**
```

## 公開する

```bash
npm run build     # posts/ から docs/ に静的サイトを生成（draft: true の記事は除外）
```

生成された `docs/` を git commit → push すると GitHub Pages に反映される
（GitHub 側の設定と初回セットアップは下記）。

## 初回セットアップ（GitHub Pages）

1. github.com で新しい空のリポジトリを作成（Add a README にはチェックを入れない）
2. このフォルダで:
   ```bash
   git remote add origin https://github.com/<ユーザー名>/<リポジトリ名>.git
   git push -u origin main
   ```
3. リポジトリの **Settings → Pages** を開き、
   **Source: Deploy from a branch** → **Branch: main / docs** を選んで Save
4. 数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開される
5. `site/config.mjs` の `url` をこの URL に更新して `npm run build` → commit → push

以降は「記事を書く → `npm run build` → commit → push」の繰り返し。

## デザイン・構成

- `posts/*.md` … 記事の元原稿（Markdown）
- `site/config.mjs` … サイトタイトル・説明文
- `site/style.css` … 見た目
- `site/build.mjs` … `posts/` → `docs/` の変換
- `docs/` … 生成結果。GitHub Pages はここを配信する（**手で編集しない**。必ず build で再生成）

---

## 収集パイプライン（保留中）

以前、他のブログから発達障害の情報を自動収集して要約・分類する仕組み
（`npm run discover` / `sources` / `fetch` / `enrich` / `show`）を作った。
コードは残しているが、今は自分で記事を書くことに専念するため使っていない。
将来、参考リンク欄などで再利用するかもしれない。

- `config/sources.yaml`, `src/*.mjs` … 収集パイプライン本体
- 必要になったら `ANTHROPIC_API_KEY` を設定して `npm run discover` から再開できる
- データと著作権の扱い、DB構造などの詳細は git 履歴の旧 README、または `src/` 内のコメント参照
