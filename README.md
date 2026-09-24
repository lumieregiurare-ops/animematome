# アニメ速報（放送予定とアニメニュースまとめ）

きょう放送のアニメの番組表と、アニメまわりのニュースをまとめる静的サイトです。`docs/` がサイトルートで、そのままロリポップ（FTP）に置いて公開できます。

- **これから放送** — いまの時刻より後に始まる番組を上から 8 本。1 分ごとに描き直すので、開いたままでも中身が進みます
- **番組表** — 今日 / 明日 / 明後日のタブ、放送局で絞り込み
- **ニュース** — 複数の媒体が同じことを報じたものは「注目の話題」としてまとめ、媒体数を ★ で表示
- 左右に賑やかしのモジュール: 放送局・今期よく放送されている作品・ニュースの種別・よく出ている語・収集元（左）、**今夜これ観ませんか**・**ニュースガチャ**・あとで読む（右）

## 使い方

```bash
npm install          # esbuild / sharp（ビルド用のみ）
npm run collect      # ニュースと放送予定をまとめて更新
npm run schedule     # 放送予定だけを更新
npm run build        # site/ を最小化して docs/ に出力
npm start            # ビルドしてローカルサーバー（http://localhost:3280）
```

## 放送予定について（しょぼいカレンダー）

放送予定は有志が運営する **[しょぼいカレンダー](https://cal.syoboi.jp/)** のデータを利用しています。**フッターとセクション下のクレジットは外さないでください。**

| 使っている API | 用途 |
| --- | --- |
| `Command=ProgLookup&Range=...` | 期間内の放送予定。1 回の収集で 1 リクエスト |
| `Command=ChLookup` | 放送局の一覧（288 局）。**1 週間キャッシュ**して使い回す（`data/channels.json`） |
| `Command=TitleLookup&TID=...` | 番組名。TID をまとめて 100 件ずつ渡す |

有志のサービスなので、1 回の収集で数リクエストに収まるようにしてあります。

**載せる局は `config.json` の `schedule.channels` で絞っています。** しょぼいカレンダーには 288 局あり、全部載せると地方局や配信の再放送で埋もれるためです。既定は地上波の主要局・独立局・BS・AT-X・配信（ABEMA / dアニメストア / YouTube など）で、実際に番組があった局だけが画面の「放送局でしぼる」に出ます。増やしたいときはここに正規表現を足してください。

日付をまたぐ長時間の一挙放送は開始日が前日になるため、**今日より前の日付は落として**います（タブが紛らわしくなるので）。

放送時間は変更されることがあるので、サイト上でも「実際の放送は各局の番組表で確認」と案内しています。

## ニュースの収集

| 収集元 | |
| --- | --- |
| RSS / Atom | アニメ！アニメ！ / コミックナタリー / 音楽ナタリー / 電撃ホビーウェブ / インサイド / 電ファミニコゲーマー |
| Google ニュースの検索フィード | 8 クエリ（放送・新作・アニメ化・声優・劇場版・主題歌・続編・円盤） |

ナタリーは **Atom 形式**（`<entry>`）で配信されています。`lib/xml.mjs` は RSS と Atom の両方を読めます。

2026-09 時点で使えなかったもの: アニメイトタイムズ（404）/ ORICON アニメ（410）/ ファミ通アニメ（404）/ アキバ総研（接続不可）。

## 更新の間隔について

**GitHub Actions の cron は当てになりません。** 同じアカウントで実測したところ、10 分おきに置いても 9 スロット連続で 0 回でした（2026-09-16）。そこで**更新の主役は外部トリガー**にしています。

ロリポップの cron から、trend-video-watcher リポジトリにある `tools/trigger-collect.php` を実行します。このサイトを追加するときは、スクリプトの `REPOS` に `lumieregiurare-ops/animematome` を足してください。

```bash
curl -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer <TOKEN>" \
  https://api.github.com/repos/lumieregiurare-ops/animematome/dispatches \
  -d '{"event_type":"collect"}'
```

cron はフォールバックとして 10 分おきに置き、**前回の収集から 25 分たっていなければ即座に終了する**ガードを入れてあります（前回の時刻は `data/state.json` の `ranAt`）。

## 公開の設定（ロリポップ）

**Secrets**: `LOLIPOP_FTP_SERVER` / `LOLIPOP_FTP_USER` / `LOLIPOP_FTP_PASSWORD`
**Variables**: `DEPLOY_TARGET` = `lolipop`、`LOLIPOP_SERVER_DIR` = サブドメインの公開ディレクトリ（例 `./anime/`。末尾のスラッシュ必須）

収集のたびに `docs/data/` のほか、下の「検索エンジン向けのページ」も作り直すので、収集ワークフローの FTP は `docs/` 全体を渡します（変わったファイルだけが送られます）。

## 検索エンジン向けのページ（SEO）

トップの画面は `app.js` が `news.json` と `schedule.json` を読んで描くので、それだけだと検索エンジンには中身が見えません。そこで、収集（`collect.mjs`）とビルド（`build.mjs`）の最後に `scripts/lib/pages.mjs` が次のものを `docs/` に書き出します。

| URL | 内容 |
| --- | --- |
| `/` | `site/index.html` の `<!--ssr:…-->` に、今日の番組表・新着 40 件・サイト内リンク・構造化データを差し込んだもの（表示後は app.js が描き直す） |
| `/schedule/` `/schedule/YYYY/MM/DD/` | 今日から 3 日分の番組表と、日別の番組表 |
| `/anime/<TID>/` | 作品ごとの放送時間・放送局（これからの放送・最近の放送・毎週○曜○時・関連ニュース）。TID はしょぼいカレンダーの番号 |
| `/titles/` | 今期のアニメ（直近 14 日に放送があったもの）を曜日別に |
| `/ch/` `/ch/<ChID>/` | 放送局ごとの番組表と、その局で放送中のアニメ |
| `/news/<slug>/` | ニュースの種別ごと。見出し・説明・URL は `config.json` の `pages.genres` |
| `/archive/…` | 過去のニュース（月別・日別） |
| `/about/` `/404.html` `/feed.xml` `/sitemap.xml` | サイトについて・404・Atom フィード・サイトマップ |

- 過去の記事は `data/archive/news/`、放送予定は `data/archive/programs/` に日ごとに貯めています（放送予定は朝 5 時区切りの放送日ごと。今日以降の日は毎回いまの予定で置き換えます）
- 「毎週○曜○時」は、直近 35 日に同じ局・同じ曜日・同じ時刻の放送が 2 回以上あったときに出します。放送予定が貯まるまでは出ません
- 記事が 3 件未満の種別ページは `noindex` にして sitemap にも載せません
- `site/.htaccess` で圧縮・キャッシュ・404 のページを設定しています。アイコンは「アニ速」のドット絵で、`node scripts/make-favicon.mjs` が `site/favicon.svg`・`favicon-48.png`・`apple-touch-icon.png` を作ります（ドットの配置はスクリプトの中に手で書いてある）
- Google Search Console の所有権の確認に HTML タグを使う場合は、`config.json` の `pages.googleSiteVerification` に content の値を入れてください

## ブラウザに保存しているもの

| キー | 内容 |
| --- | --- |
| `anime:fav` | 「あとで読む」に入れた記事 |
| `anime:read` | 開いた記事（ニュースガチャで未読を優先するため） |
| `anime:state` | 選んでいる種別・並び順などの画面の状態 |

**localStorage にだけ**保存しています。サーバーには何も送りません。
