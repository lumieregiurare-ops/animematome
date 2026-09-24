// 検索エンジン向けの静的ページを docs/ に書き出す。収集（collect.mjs）とビルド（build.mjs）の最後に呼ぶ。
// トップの画面は app.js が news.json と schedule.json を読んで描くが、それだけだと検索エンジンからは
// 中身が「読み込み中…」にしか見えないので、番組表とニュースの一覧を HTML にも書いておく（app.js が描き直す）。
// あわせて、作品別（放送時間）・放送局別・曜日別の今期アニメ・日別の番組表・ニュースの種別・
// 日別の過去ニュースのページと、sitemap.xml・feed.xml を作る。
// Node の標準機能だけで動く（GitHub Actions の収集で npm ci しないため）。
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { loadArchive, jstDay } from "./archive.mjs";

export function minifyHtml(html) {
  return html
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "") // 条件付きコメント以外のコメントを除去
    .replace(/>\s+</g, "><") // タグ間の空白
    .replace(/\s{2,}/g, " ")
    .trim();
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const FONT_URL = "https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Oswald:wght@400;600&family=Noto+Sans+JP:wght@400;500;700&display=swap";
const SYOBOI = "https://cal.syoboi.jp/";
// 放送の 1 日は朝 5 時で区切る（深夜は 25:30 のように書く、アニメの番組表の慣習）
const BD_SHIFT = 5;
// ニュースの種別ページに載せる件数と、さかのぼる日数
const LIST_MAX = 60;
const LIST_DAYS = 180;
// これより記事が少ないページは noindex にして sitemap にも載せない（中身の薄いページを検索に出さない）
const MIN_INDEXABLE = 3;
// 放送パターン（毎週○曜 ○時）を見る期間
const PATTERN_DAYS = 35;
// 「今期のアニメ」に入れる、最後の放送からの日数
const CURRENT_DAYS = 14;

// ---------- 小物 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function jst(iso) {
  return new Date(new Date(iso).getTime() + 9 * 3600000);
}
const pad = (n) => String(n).padStart(2, "0");
function hhmm(iso) {
  const d = jst(iso);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
// 深夜 0〜5 時は 24〜29 時と書く
function timeOf(iso) {
  const d = jst(iso);
  const h = d.getUTCHours();
  return `${h < BD_SHIFT ? h + 24 : h}:${pad(d.getUTCMinutes())}`;
}
function minutesOf(iso) {
  const d = jst(iso);
  const h = d.getUTCHours();
  return (h < BD_SHIFT ? h + 24 : h) * 60 + d.getUTCMinutes();
}
const bday = (iso) => jstDay(iso, BD_SHIFT);
function dayParts(day) {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, w, wd: WD[w] };
}
const mdw = (day) => {
  const p = dayParts(day);
  return `${p.m}/${p.d}（${p.wd}）`;
};
const jpDay = (day) => {
  const p = dayParts(day);
  return `${p.y}年${p.m}月${p.d}日（${p.wd}）`;
};
const dayPath = (day) => day.replace(/-/g, "/");
function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function ld(obj) {
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`;
}
async function readText(p) {
  try {
    return await readFile(p, "utf8");
  } catch {
    return "";
  }
}
async function readJsonOr(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return fallback;
  }
}
// 改行コードをそろえてから計算する（Windows で git が CRLF に変えたファイルでも、Actions と同じ値になるように）
async function verOf(p) {
  const t = (await readText(p)).replace(/\r\n/g, "\n");
  return t ? createHash("sha1").update(t).digest("hex").slice(0, 8) : "0";
}
// しょぼいカレンダーの回数・サブタイトル。"^" で始まるのは番組の補足なので話数としては出さない（app.js と同じ）
function epText(p) {
  const parts = [];
  if (p.count) parts.push(`#${p.count}`);
  if (p.sub && !p.sub.startsWith("^")) parts.push(p.sub.startsWith("#") ? p.sub : `「${p.sub}」`);
  return parts.join(" ");
}

// ---------- サムネイル（app.js と同じ、画像が無いときは単色の地に頭の 1 文字） ----------
const PH_COLORS = ["#3a4270", "#6b3a5c", "#2f5f63", "#6a5530", "#4a3a70", "#703a3a", "#35573a", "#555a66"];
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function firstGlyph(str) {
  return [...(str || "").trim()].find((c) => !/[「『【\[(（"'"'\s]/.test(c)) || "?";
}
function thumb(url, seed, cls) {
  if (url) return `<div class="${cls}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()"></div>`;
  return `<div class="${cls} thumb-ph" style="background:${PH_COLORS[hashHue(seed) % PH_COLORS.length]}">${esc(firstGlyph(seed))}</div>`;
}

// 作品名から「(2)」「（第2クール）」のような末尾の補足を落とす（ニュースの見出しと突き合わせるため）
function baseTitle(t) {
  return String(t || "")
    .replace(/[（(][^（()）]*[)）]\s*$/, "")
    .trim();
}

// ---------- 本体 ----------
export async function renderPages(root, { log = () => {} } = {}) {
  const config = JSON.parse(await readFile(join(root, "config.json"), "utf8"));
  const DOCS = join(root, "docs");
  const SITE = config.site?.title || "アニメ速報";
  const BASE = (config.site?.url || "/").replace(/\/?$/, "/");
  const abs = (path) => BASE + path.replace(/^\//, "");
  const now = new Date();
  const nowMs = now.getTime();
  const today = bday(now.toISOString());
  const year = jst(now.toISOString()).getUTCFullYear();

  const news = await readJsonOr(join(DOCS, "data", "news.json"), null);
  const sched = await readJsonOr(join(DOCS, "data", "schedule.json"), null);
  const newsArchive = await loadArchive(join(root, "data", "archive", "news"));
  const progArchive = await loadArchive(join(root, "data", "archive", "programs"));
  const indexTpl = await readText(join(root, "site", "index.html"));
  const GA = (indexTpl.match(/gtag\/js\?id=(G-[A-Z0-9]+)/) || [])[1] || "";
  const ver = {
    css: await verOf(join(DOCS, "assets", "app.css")),
    app: await verOf(join(DOCS, "assets", "app.js")),
  };

  // ---------- データの下ごしらえ ----------
  const genres = (config.categories || []).filter((c) => config.pages?.genres?.[c.id]).map((c) => ({ ...c, ...config.pages.genres[c.id] }));
  const catLabel = (id) => (config.categories || []).find((c) => c.id === id)?.label || "";
  const seriesLabel = (id) => (config.series || []).find((c) => c.id === id)?.label || "";

  // 過去のニュース（新しい順・同じ記事は 1 回だけ）
  const seenNews = new Set();
  const allNews = [];
  for (const d of newsArchive)
    for (const it of d.items) {
      if (seenNews.has(it.id)) continue;
      seenNews.add(it.id);
      allNews.push(it);
    }
  allNews.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  const recentNews = allNews.filter((it) => nowMs - new Date(it.publishedAt).getTime() <= LIST_DAYS * 86400000);

  // 放送予定（古い順・同じ枠は 1 回だけ）
  const seenProg = new Set();
  const progs = [];
  for (const d of progArchive)
    for (const p of d.items) {
      if (seenProg.has(p.pid)) continue;
      seenProg.add(p.pid);
      progs.push(p);
    }
  progs.sort((a, b) => (a.st < b.st ? -1 : a.st > b.st ? 1 : 0));
  const upcomingDays = [...new Set(progs.map((p) => bday(p.st)).filter((d) => d >= today))].sort().slice(0, 3);

  // 作品ごと
  const titles = new Map();
  for (const p of progs) {
    if (!titles.has(p.tid)) titles.set(p.tid, { tid: p.tid, progs: [] });
    const t = titles.get(p.tid);
    t.progs.push(p);
    // 名前と画像は新しい枠のものを使う
    t.title = p.title;
    t.fullTitle = p.fullTitle || p.title;
    if (p.image) t.image = p.image;
  }
  // 放送局ごと
  const channels = new Map();
  for (const p of progs) {
    if (!channels.has(p.chId)) channels.set(p.chId, { id: p.chId, name: p.ch, progs: [] });
    channels.get(p.chId).progs.push(p);
  }
  const chOrder = new Map((sched?.channels || []).map((c, i) => [c.id, i]));
  const chList = [...channels.values()].sort((a, b) => (chOrder.get(a.id) ?? 999) - (chOrder.get(b.id) ?? 999) || a.name.localeCompare(b.name));

  // 放送パターン。同じ局・同じ曜日・同じ時刻に 2 回以上あれば「毎週」とみなす
  function patternsOf(list) {
    const from = nowMs - PATTERN_DAYS * 86400000;
    const groups = new Map();
    for (const p of list) {
      if (new Date(p.st).getTime() < from) continue;
      const k = `${p.chId}|${dayParts(bday(p.st)).w}|${timeOf(p.st)}`;
      if (!groups.has(k)) groups.set(k, { ch: p.ch, chId: p.chId, w: dayParts(bday(p.st)).w, time: timeOf(p.st), min: minutesOf(p.st), n: 0 });
      groups.get(k).n++;
    }
    return [...groups.values()].sort((a, b) => b.n - a.n || a.w - b.w || a.min - b.min);
  }
  const titleUrl = (tid) => `/anime/${encodeURIComponent(tid)}/`;
  const chUrl = (id) => `/ch/${encodeURIComponent(id)}/`;

  const written = [];
  const sitemap = [];
  async function out(path, html, { lastmod, index = true } = {}) {
    const file = path.endsWith("/") ? join(DOCS, path, "index.html") : join(DOCS, path);
    const text = path.endsWith(".xml") ? html : minifyHtml(html);
    if ((await readText(file)).replace(/\r\n/g, "\n") !== text) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text, "utf8");
      written.push(path);
    }
    if (index) sitemap.push({ loc: abs(path), lastmod });
  }

  // ---------- 共通の部品 ----------
  const siteLinks = [
    ["/schedule/", "日別の番組表"],
    ["/titles/", "今期のアニメ"],
    ["/ch/", "放送局別"],
    ...genres.map((g) => [`/news/${g.slug}/`, g.label]),
    ["/archive/", "過去のニュース"],
  ];
  const navLinks = () => siteLinks.map(([h, t]) => `<a href="${h}">${esc(t)}</a>`).join("");
  function footerLinks() {
    return `<nav class="footer-nav" aria-label="サイト内のページ">
      <a href="/">トップ</a><a href="/schedule/">今日のアニメ番組表</a><a href="/titles/">今期のアニメ一覧</a><a href="/ch/">放送局別の放送予定</a>
      ${genres.map((g) => `<a href="/news/${g.slug}/">${esc(g.title)}</a>`).join("")}
      <a href="/archive/">過去のニュース</a><a href="/about/">このサイトについて</a><a href="/feed.xml">RSS</a>
    </nav>`;
  }
  const verify = config.pages?.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(config.pages.googleSiteVerification)}">` : "";
  const gtag = GA
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA}');</script>`
    : "";
  const fontLinks = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="preload" as="style" href="${FONT_URL}" onload="this.onload=null;this.rel='stylesheet'"><noscript><link rel="stylesheet" href="${FONT_URL}"></noscript>`;

  // サイドバーは全ページに入るので、収集のたびに変わる値（件数・今日放送があるかどうか）は入れない。
  // 入れると、記事が増えない過去の日別ページまで毎回書き換わり、FTP で送る量とリポジトリが膨らみ続ける
  function sideHtml() {
    const gl = genres.map((g) => `<li><a href="/news/${g.slug}/">${esc(g.label)}</a></li>`).join("");
    const cl = [...channels.values()]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .slice(0, 14)
      .map((c) => `<li><a href="${chUrl(c.id)}">${esc(c.name)}</a></li>`)
      .join("");
    return `<aside class="side side-right">
      <section class="mod"><h2 class="mod-head">放送予定</h2><ul class="side-links">
        <li><a href="/schedule/">今日・明日の番組表</a></li><li><a href="/titles/">今期のアニメ（曜日別）</a></li><li><a href="/ch/">放送局別</a></li><li><a href="/">トップ（いま放送中）</a></li>
      </ul></section>
      <section class="mod"><h2 class="mod-head">ニュースの種別</h2><ul class="side-links">${gl}</ul></section>
      ${cl ? `<section class="mod"><h2 class="mod-head">放送局</h2><ul class="side-links side-links-grid">${cl}</ul></section>` : ""}
      <section class="mod"><h2 class="mod-head">ほかのページ</h2><ul class="side-links"><li><a href="/archive/">過去のニュース</a></li><li><a href="/about/">このサイトについて</a></li></ul></section>
    </aside>`;
  }

  function page({ path, title, desc, h1, lead = "", body, crumbs = [], jsonld = [], noindex = false }) {
    const fullTitle = `${title}｜${SITE}`;
    const trail = [{ name: SITE, path: "/" }, ...crumbs];
    const bc = crumbs.length
      ? {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: abs(c.path) })),
        }
      : null;
    return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${gtag}
  <title>${esc(fullTitle)}</title>
  <meta name="description" content="${esc(desc)}">
  ${noindex ? '<meta name="robots" content="noindex, follow">' : ""}
  ${verify}
  <meta name="theme-color" content="#161a31">
  ${path === "/404.html" ? "" : `<link rel="canonical" href="${abs(path)}">`}
  <meta property="og:site_name" content="${esc(SITE)}">
  <meta property="og:title" content="${esc(fullTitle)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${abs(path)}">
  <meta property="og:image" content="${abs("/assets/og.png")}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${esc(fullTitle)}">
  <meta name="twitter:description" content="${esc(desc)}">
  <meta name="twitter:image" content="${abs("/assets/og.png")}">
  <link rel="alternate" type="application/atom+xml" title="${esc(SITE)}" href="/feed.xml">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon-48.png" type="image/png" sizes="48x48">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  ${bc ? ld(bc) : ""}
  ${jsonld.map(ld).join("")}
  ${fontLinks}
  <link rel="stylesheet" href="/assets/app.css?v=${ver.css}">
</head>
<body>
  <header class="header">
    <div class="wrap header-inner">
      <div class="logo"><a href="/"><span class="logo-text">アニメ<span class="logo-accent">速報</span></span></a></div>
      <p class="tagline">放送予定とアニメニュースまとめ</p>
    </div>
    <nav class="global-nav" aria-label="サイト内のページ"><a href="/">トップ</a>${navLinks()}</nav>
  </header>
  <main class="wrap">
    ${
      crumbs.length
        ? `<nav class="crumbs" aria-label="パンくずリスト"><ol>${trail
            .map((c, i) => (i === trail.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`))
            .join("")}</ol></nav>`
        : ""
    }
    <div class="layout layout-page">
      <div class="col-main">
        <div class="page-intro">
          <h1 class="page-title">${esc(h1)}</h1>
          ${lead ? `<p class="page-lead">${lead}</p>` : ""}
        </div>
        ${body}
      </div>
      ${sideHtml()}
    </div>
  </main>
  <footer class="footer">
    <div class="wrap">
      ${footerLinks()}
      <p><strong>${esc(SITE)}</strong> は、アニメの放送予定とアニメまわりのニュースをまとめているサイトです。30 分おきに更新しています。</p>
      <p>ニュースは見出し・要約の一部・元記事へのリンクのみを掲載しており、本文の転載はしていません。リンク先の記事の権利はそれぞれの発行元に帰属します。</p>
      <p class="notice">放送予定は有志が運営する <a href="${SYOBOI}" target="_blank" rel="noopener">しょぼいカレンダー</a> のデータを利用しています。放送時間は変更されることがあるため、実際の放送は各局の番組表をご確認ください。</p>
      ${config.site?.contactUrl ? `<p class="contact"><a href="${esc(config.site.contactUrl)}" target="_blank" rel="noopener">お問い合わせはこちら</a></p>` : ""}
      <p class="copy">© ${year} ${esc(SITE)}</p>
    </div>
  </footer>
</body>
</html>`;
  }

  // ---------- 部品: ニュースの行 ----------
  function rowHtml(it) {
    const badges = [];
    if (it.isOfficial) badges.push('<span class="badge badge-official">公式</span>');
    for (const s of (it.series || []).slice(0, 1)) if (seriesLabel(s)) badges.push(`<span class="badge badge-series">${esc(seriesLabel(s))}</span>`);
    for (const c of (it.categories || []).slice(0, 1)) if (catLabel(c)) badges.push(`<span class="badge badge-cat">${esc(catLabel(c))}</span>`);
    if (it.isPR) badges.push('<span class="badge badge-pr">PR</span>');
    return `<article class="row">${thumb(it.image, it.title, "row-thumb")}<div class="row-body">
      <div class="row-top">${badges.join("")}<span>${esc(it.source)} ・ <time datetime="${esc(it.publishedAt)}">${mdw(jstDay(it.publishedAt))} ${hhmm(it.publishedAt)}</time></span></div>
      <a class="row-title" href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title)}</a>
      ${it.summary ? `<p class="row-sum">${esc(it.summary)}</p>` : ""}
    </div></article>`;
  }
  function newsGrouped(items, tag = "h2") {
    const groups = new Map();
    for (const it of items) {
      const k = jstDay(it.publishedAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    let html = "";
    for (const [day, list] of groups) html += `<section class="day"><${tag} class="day-head">${mdw(day)}</${tag}><div class="rows">${list.map(rowHtml).join("")}</div></section>`;
    return html;
  }
  function itemList(items, name, urlOf = (it) => it.url, nameOf = (it) => it.title) {
    return {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name,
      numberOfItems: Math.min(items.length, 20),
      itemListElement: items.slice(0, 20).map((it, i) => ({ "@type": "ListItem", position: i + 1, url: urlOf(it), name: nameOf(it) })),
    };
  }

  // ---------- 部品: 番組表（30 分ごとの段） ----------
  function timetableHtml(list, { showCh = true } = {}) {
    if (!list.length) return '<p class="empty-mini">この日の放送はありません。</p>';
    const slots = new Map();
    for (const p of list) {
      const st = new Date(p.st).getTime();
      const key = st - (st % 1800000);
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(p);
    }
    let html = '<div class="slots">';
    for (const [key, ps] of [...slots].sort((a, b) => a[0] - b[0])) {
      const keyIso = new Date(key).toISOString();
      html += `<div class="slot${jst(keyIso).getUTCHours() < BD_SHIFT ? " is-late" : ""}"><div class="slot-time">${timeOf(keyIso)}</div><div class="slot-progs">`;
      for (const p of ps) {
        const startsOff = new Date(p.st).getTime() !== key;
        const long = new Date(p.ed || p.st).getTime() - new Date(p.st).getTime() > 3600000;
        const meta = [showCh ? p.ch : "", startsOff || !showCh ? `${timeOf(p.st)}〜` : "", long ? `〜${timeOf(p.ed)}` : ""].filter(Boolean).join(" ・ ");
        const ep = epText(p);
        html += `<a class="slot-prog" href="${titleUrl(p.tid)}" title="${esc(p.fullTitle || p.title)}">${thumb(p.image, p.title, "sp-cover")}<div class="sp-body">
          <div class="sp-ch">${esc(meta)}</div><div class="sp-title">${esc(p.title)}</div>${ep ? `<div class="sp-ep">${esc(ep)}</div>` : ""}</div></a>`;
      }
      html += "</div></div>";
    }
    return html + "</div>";
  }
  const credit = `<p class="credit">放送予定は <a href="${SYOBOI}" target="_blank" rel="noopener">しょぼいカレンダー</a> のデータを利用しています。放送時間は変わることがあるので、各局の番組表でも確かめてください。</p>`;
  const lastOf = (items, key = "publishedAt") => items.reduce((a, it) => (it[key] > a ? it[key] : a), "") || undefined;

  // ---------- トップ ----------
  if (indexTpl) {
    const items = news?.items || [];
    const listHtml = items.length
      ? newsGrouped(items.slice(0, 40), "h3")
      : '<div class="loading loading-feed"><span class="spinner" role="status" aria-label="読み込み中"></span><span>ニュースを読み込んでいます…</span></div>';
    const todayProgs = progs.filter((p) => bday(p.st) === today);
    let meta = "読み込み中…";
    if (news) {
      const u = jst(news.updatedAt);
      meta = `${news.total} 本のニュース ・ 今日 ${news.todayCount} 本 ・ ${(news.topics || []).length} の話題 ・ 最終更新 ${u.getUTCMonth() + 1}/${u.getUTCDate()} ${hhmm(news.updatedAt)}`;
    }
    const head = [
      verify,
      `<link rel="alternate" type="application/atom+xml" title="${esc(SITE)}" href="feed.xml">`,
      ld({ "@context": "https://schema.org", "@type": "Organization", name: SITE, url: BASE, logo: abs("/apple-touch-icon.png") }),
      items.length ? ld(itemList(items, "アニメの新着ニュース")) : "",
    ].join("");
    const html = indexTpl
      .replace("<!--ssr:head-->", head)
      .replace("<!--ssr:nav-->", navLinks())
      .replace("<!--ssr:list-->", listHtml)
      .replace("<!--ssr:timetable-->", todayProgs.length ? timetableHtml(todayProgs) : "")
      .replace("<!--ssr:footer-links-->", footerLinks())
      .replace('<span id="meta">読み込み中…</span>', `<span id="meta">${esc(meta)}</span>`)
      .replace(/href="assets\/app\.css"/, `href="assets/app.css?v=${ver.css}"`)
      .replace(/src="assets\/app\.js"/, `src="assets/app.js?v=${ver.app}"`);
    await out("/", html, { lastmod: news?.updatedAt });
  }

  // ---------- 番組表（今日から 3 日） ----------
  {
    let body = "";
    for (const d of upcomingDays) {
      const list = progs.filter((p) => bday(p.st) === d);
      body += `<section class="page-sec"><h2 class="sec-title">${d === today ? "今日" : mdw(d)}のアニメ ${list.length} 本 <a class="sec-link" href="/schedule/${dayPath(d)}/">${mdw(d)}の番組表</a></h2>${timetableHtml(list)}</section>`;
    }
    if (!body) body = '<p class="empty">いまは放送予定がありません。</p>';
    await out(
      "/schedule/",
      page({
        path: "/schedule/",
        title: "今日のアニメ放送予定・番組表（地上波・BS・CS・配信）",
        desc: "今日・明日・明後日に放送されるアニメの番組表です。地上波・BS・CS（AT-X など）・配信の放送時間と放送局、話数を時間順に並べています。",
        h1: "今日・明日のアニメ番組表",
        lead: `今日から ${upcomingDays.length} 日分のアニメの放送予定を、時間順に並べています。深夜は 25:30 のように書いています（朝 5 時で日付を区切っています）。作品名を押すと、その作品の放送時間の一覧を見られます。`,
        body: body + credit,
        crumbs: [{ name: "番組表", path: "/schedule/" }],
      }),
      { lastmod: sched?.updatedAt }
    );
  }

  // ---------- 番組表（日別） ----------
  const progDays = [...new Set(progs.map((p) => bday(p.st)))].sort().reverse();
  for (let i = 0; i < progDays.length; i++) {
    const d = progDays[i];
    const list = progs.filter((p) => bday(p.st) === d);
    if (!list.length) continue;
    const p = dayParts(d);
    const path = `/schedule/${dayPath(d)}/`;
    const newer = progDays[i - 1];
    const older = progDays[i + 1];
    const pager = `<nav class="pager" aria-label="前後の日">
      ${older ? `<a href="/schedule/${dayPath(older)}/">← ${mdw(older)}</a>` : "<span></span>"}
      <a href="/schedule/">今日の番組表</a>
      ${newer ? `<a href="/schedule/${dayPath(newer)}/">${mdw(newer)} →</a>` : "<span></span>"}
    </nav>`;
    const names = [...new Set(list.map((x) => x.title))];
    await out(
      path,
      page({
        path,
        title: `${jpDay(d)}のアニメ放送予定・番組表`,
        desc: truncate(`${p.y}年${p.m}月${p.d}日（${p.wd}）に放送のアニメ ${list.length} 本の番組表。${names.slice(0, 6).join("、")}など。`, 120),
        h1: `${jpDay(d)}のアニメ番組表`,
        lead: `${p.m}月${p.d}日の朝 5 時から翌朝 5 時までに放送されるアニメ ${list.length} 本です。深夜は 25:30 のように書いています。`,
        body: timetableHtml(list) + pager + credit,
        crumbs: [
          { name: "番組表", path: "/schedule/" },
          { name: `${p.m}月${p.d}日`, path },
        ],
      }),
      { lastmod: d < today ? `${d}T20:00:00Z` : sched?.updatedAt }
    );
  }

  // ---------- 作品別（放送時間） ----------
  const titleCards = [];
  for (const t of titles.values()) {
    const upcoming = t.progs.filter((p) => new Date(p.ed || p.st).getTime() > nowMs);
    const past = t.progs.filter((p) => new Date(p.ed || p.st).getTime() <= nowMs).reverse();
    const weekly = patternsOf(t.progs).filter((g) => g.n >= 2);
    const next = upcoming[0];
    const key = baseTitle(t.title);
    const related = key.length >= 3 ? recentNews.filter((it) => it.title.includes(key)).slice(0, 12) : [];
    const lastSeen = t.progs[t.progs.length - 1];
    t.lastSeen = lastSeen;
    t.weekly = weekly;
    t.next = next;

    const progLine = (p) => {
      const ep = epText(p);
      return `<li><span class="bc-date">${mdw(bday(p.st))}</span><span class="bc-time">${timeOf(p.st)}〜</span><a class="bc-ch" href="${chUrl(p.chId)}">${esc(p.ch)}</a>${ep ? `<span class="bc-ep">${esc(ep)}</span>` : ""}</li>`;
    };
    let body = `<div class="title-head">${thumb(t.image, t.title, "title-cover")}<div class="title-facts">`;
    if (next) body += `<p class="title-next"><span>${new Date(next.st).getTime() <= nowMs ? "放送中" : "次の放送"}</span><b>${mdw(bday(next.st))} ${timeOf(next.st)}〜</b> <a href="${chUrl(next.chId)}">${esc(next.ch)}</a>${epText(next) ? ` ${esc(epText(next))}` : ""}</p>`;
    if (weekly.length) body += `<ul class="title-weekly">${weekly.slice(0, 6).map((g) => `<li>毎週${WD[g.w]}曜 <b>${g.time}〜</b> <a href="${chUrl(g.chId)}">${esc(g.ch)}</a></li>`).join("")}</ul>`;
    body += `<p class="title-src"><a href="https://cal.syoboi.jp/tid/${esc(t.tid)}" target="_blank" rel="noopener">しょぼいカレンダーで詳しく見る</a></p></div></div>`;
    if (upcoming.length) body += `<section class="page-sec"><h2 class="sec-title">これからの放送</h2><ul class="bc-list">${upcoming.slice(0, 20).map(progLine).join("")}</ul></section>`;
    if (past.length) body += `<section class="page-sec"><h2 class="sec-title">最近の放送</h2><ul class="bc-list is-past">${past.slice(0, 12).map(progLine).join("")}</ul></section>`;
    if (related.length) body += `<section class="page-sec"><h2 class="sec-title">「${esc(key)}」のニュース</h2><div class="rows">${related.map(rowHtml).join("")}</div></section>`;
    body += credit;

    const chs = [...new Set(t.progs.map((p) => p.ch))];
    const nextText = next ? `次の放送は ${mdw(bday(next.st))} ${timeOf(next.st)}〜（${next.ch}）。` : "";
    const weeklyText = weekly.length ? `毎週${WD[weekly[0].w]}曜 ${weekly[0].time}〜 ${weekly[0].ch}ほか。` : "";
    await out(
      titleUrl(t.tid),
      page({
        path: titleUrl(t.tid),
        title: `「${t.title}」の放送時間・放送局`,
        desc: truncate(`アニメ「${t.fullTitle}」の放送日時と放送局の一覧です。${nextText}${weeklyText}放送局: ${chs.slice(0, 5).join("、")}`, 120),
        h1: `「${t.title}」の放送時間`,
        lead: `アニメ「${esc(t.fullTitle)}」の放送日時と放送局です。放送時間は 25:30 のように深夜を 24 時より後で書いています。`,
        body,
        crumbs: [
          { name: "今期のアニメ", path: "/titles/" },
          { name: t.title, path: titleUrl(t.tid) },
        ],
        jsonld: [
          {
            "@context": "https://schema.org",
            "@type": "TVSeries",
            name: t.fullTitle,
            url: abs(titleUrl(t.tid)),
            ...(t.image ? { image: t.image } : {}),
            inLanguage: "ja",
          },
        ],
      }),
      { lastmod: lastOf(t.progs, "st") && new Date(Math.min(nowMs, new Date(lastSeen.st).getTime())).toISOString() }
    );
  }

  // ---------- 今期のアニメ（曜日別） ----------
  {
    const current = [...titles.values()].filter((t) => nowMs - new Date(t.lastSeen.st).getTime() <= CURRENT_DAYS * 86400000 || t.next);
    const byDay = new Map(WD.map((_, i) => [i, []]));
    const daily = [];
    for (const t of current) {
      const pats = patternsOf(t.progs);
      const main = pats[0] || { w: dayParts(bday(t.progs[0].st)).w, time: timeOf(t.progs[0].st), min: minutesOf(t.progs[0].st), ch: t.progs[0].ch, chId: t.progs[0].chId };
      const weekdays = new Set(pats.filter((g) => g.chId === main.chId && g.time === main.time).map((g) => g.w));
      const entry = { t, main, others: pats.filter((g) => g !== main).length };
      if (weekdays.size >= 4) daily.push(entry);
      else byDay.get(main.w).push(entry);
    }
    const li = ({ t, main, others }) =>
      `<li><span class="tl-time">${main.time}</span><a class="tl-title" href="${titleUrl(t.tid)}">${esc(t.title)}</a><span class="tl-ch">${esc(main.ch)}${others ? ` ほか` : ""}</span></li>`;
    let body = "";
    for (const w of [1, 2, 3, 4, 5, 6, 0]) {
      const list = byDay.get(w).sort((a, b) => a.main.min - b.main.min);
      if (!list.length) continue;
      body += `<section class="page-sec"><h2 class="sec-title">${WD[w]}曜日のアニメ <small>${list.length} 本</small></h2><ul class="title-list">${list.map(li).join("")}</ul></section>`;
    }
    if (daily.length) body += `<section class="page-sec"><h2 class="sec-title">毎日・帯で放送 <small>${daily.length} 本</small></h2><ul class="title-list">${daily.sort((a, b) => a.main.min - b.main.min).map(li).join("")}</ul></section>`;
    if (!body) body = '<p class="empty">まだありません。</p>';
    await out(
      "/titles/",
      page({
        path: "/titles/",
        title: "今期のアニメ一覧（曜日別の放送時間・放送局）",
        desc: `いま放送中のアニメ ${current.length} 作品を、曜日ごとに放送時間順に並べています。地上波・BS・AT-X・配信の放送局と時間がわかります。`,
        h1: "今期のアニメ一覧（曜日別）",
        lead: `この ${CURRENT_DAYS} 日以内に放送があった、またはこれから放送があるアニメ ${current.length} 作品です。いちばん多く放送している局と時間で曜日に分けています。作品名を押すと、ほかの局の放送時間も見られます。`,
        body: body + credit,
        crumbs: [{ name: "今期のアニメ", path: "/titles/" }],
        jsonld: [itemList(current, "今期のアニメ", (x) => abs(titleUrl(x.t?.tid || x.tid)), (x) => x.title)],
      }),
      { lastmod: sched?.updatedAt }
    );
  }

  // ---------- 放送局別 ----------
  for (const c of chList) {
    const upcoming = c.progs.filter((p) => bday(p.st) >= today);
    const pats = patternsOf(c.progs);
    const tids = [...new Set(c.progs.filter((p) => nowMs - new Date(p.st).getTime() <= PATTERN_DAYS * 86400000).map((p) => p.tid))];
    let body = "";
    for (const d of [...new Set(upcoming.map((p) => bday(p.st)))].sort().slice(0, 3)) {
      body += `<section class="page-sec"><h2 class="sec-title">${d === today ? "今日" : mdw(d)}の放送</h2>${timetableHtml(
        upcoming.filter((p) => bday(p.st) === d),
        { showCh: false }
      )}</section>`;
    }
    if (tids.length) {
      body += `<section class="page-sec"><h2 class="sec-title">${esc(c.name)}で放送しているアニメ</h2><ul class="title-list">${tids
        .map((tid) => {
          const t = titles.get(tid);
          const g = pats.find((x) => c.progs.some((p) => p.tid === tid && timeOf(p.st) === x.time && dayParts(bday(p.st)).w === x.w));
          return `<li><span class="tl-time">${g ? `${WD[g.w]} ${g.time}` : ""}</span><a class="tl-title" href="${titleUrl(tid)}">${esc(t.title)}</a></li>`;
        })
        .join("")}</ul></section>`;
    }
    if (!body) body = '<p class="empty">いまはこの局の放送予定がありません。</p>';
    const n = upcoming.length;
    await out(
      chUrl(c.id),
      page({
        path: chUrl(c.id),
        title: `${c.name}のアニメ放送予定・番組表`,
        desc: truncate(`${c.name}で放送されるアニメの番組表と、放送中のアニメの一覧です。${tids.slice(0, 5).map((tid) => titles.get(tid).title).join("、")}など。`, 120),
        h1: `${c.name}のアニメ放送予定`,
        lead: `${esc(c.name)}で今日から放送されるアニメ ${n} 本と、この ${PATTERN_DAYS} 日に放送があったアニメ ${tids.length} 作品です。`,
        body: body + credit,
        crumbs: [
          { name: "放送局別", path: "/ch/" },
          { name: c.name, path: chUrl(c.id) },
        ],
        noindex: tids.length === 0 && n === 0,
      }),
      { lastmod: sched?.updatedAt, index: tids.length > 0 || n > 0 }
    );
  }
  await out(
    "/ch/",
    page({
      path: "/ch/",
      title: "放送局別のアニメ放送予定",
      desc: "TOKYO MX・BS11・AT-X・テレビ東京など、放送局ごとのアニメの放送予定と放送中のアニメの一覧です。",
      h1: "放送局別のアニメ放送予定",
      lead: "放送局を選ぶと、その局の番組表と放送中のアニメの一覧を見られます。",
      body: `<ul class="ch-list">${chList
        .map((c) => `<li><a href="${chUrl(c.id)}">${esc(c.name)}<span class="n">${c.progs.filter((p) => bday(p.st) >= today).length} 本</span></a></li>`)
        .join("")}</ul>${credit}`,
      crumbs: [{ name: "放送局別", path: "/ch/" }],
    }),
    { lastmod: sched?.updatedAt }
  );

  // ---------- ニュースの種別 ----------
  for (const g of genres) {
    const items = recentNews.filter((it) => (it.categories || []).includes(g.id)).slice(0, LIST_MAX);
    const path = `/news/${g.slug}/`;
    await out(
      path,
      page({
        path,
        title: `${g.title}（最新まとめ）`,
        desc: g.desc,
        h1: g.title,
        lead: `${esc(g.desc)}新しいものから ${items.length} 件を載せています。`,
        body: items.length ? newsGrouped(items) : '<p class="empty">いまはこの種別のニュースがありません。</p>',
        crumbs: [{ name: g.label, path }],
        jsonld: items.length ? [itemList(items, g.title)] : [],
        noindex: items.length < MIN_INDEXABLE,
      }),
      { lastmod: lastOf(items), index: items.length >= MIN_INDEXABLE }
    );
  }

  // ---------- 過去のニュース（日別・月別） ----------
  const months = new Map();
  for (const d of newsArchive) {
    const k = d.day.slice(0, 7);
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(d);
  }
  for (let i = 0; i < newsArchive.length; i++) {
    const d = newsArchive[i];
    const p = dayParts(d.day);
    const newer = newsArchive[i - 1];
    const older = newsArchive[i + 1];
    const path = `/archive/${dayPath(d.day)}/`;
    const pager = `<nav class="pager" aria-label="前後の日">
      ${older ? `<a href="/archive/${dayPath(older.day)}/">← ${mdw(older.day)}</a>` : "<span></span>"}
      <a href="/archive/${p.y}/${pad(p.m)}/">${p.y}年${p.m}月の一覧</a>
      ${newer ? `<a href="/archive/${dayPath(newer.day)}/">${mdw(newer.day)} →</a>` : "<span></span>"}
    </nav>`;
    await out(
      path,
      page({
        path,
        title: `${jpDay(d.day)}のアニメニュース ${d.items.length} 件`,
        desc: truncate(`${p.y}年${p.m}月${p.d}日のアニメ・声優・劇場版のニュース ${d.items.length} 件。${d.items.slice(0, 3).map((it) => it.title).join(" / ")}`, 120),
        h1: `${jpDay(d.day)}のアニメニュース`,
        lead: `この日に出たアニメまわりのニュース ${d.items.length} 件です。${progDays.includes(d.day) ? `<a href="/schedule/${dayPath(d.day)}/">この日の番組表</a>もあります。` : ""}`,
        body: `<div class="rows">${d.items.map(rowHtml).join("")}</div>${pager}`,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${p.y}年${p.m}月`, path: `/archive/${p.y}/${pad(p.m)}/` },
          { name: `${p.d}日`, path },
        ],
        jsonld: [itemList(d.items, `${jpDay(d.day)}のアニメニュース`)],
      }),
      { lastmod: lastOf(d.items) }
    );
  }
  for (const [k, days] of months) {
    const [y, m] = k.split("-").map(Number);
    const total = days.reduce((a, d) => a + d.items.length, 0);
    const path = `/archive/${y}/${pad(m)}/`;
    await out(
      path,
      page({
        path,
        title: `${y}年${m}月のアニメニュース一覧`,
        desc: `${y}年${m}月に出たアニメ・声優・劇場版・主題歌のニュース ${total} 件を、日ごとにまとめています。`,
        h1: `${y}年${m}月のアニメニュース`,
        lead: `この月のニュース ${total} 件を日ごとに分けています。`,
        body: `<ul class="archive-days">${days
          .map(
            (d) => `<li><a class="archive-day" href="/archive/${dayPath(d.day)}/">${mdw(d.day)}<span class="n">${d.items.length} 件</span></a>
            <ul>${d.items
              .slice(0, 3)
              .map((it) => `<li>${esc(truncate(it.title, 60))}</li>`)
              .join("")}</ul></li>`
          )
          .join("")}</ul>`,
        crumbs: [
          { name: "過去のニュース", path: "/archive/" },
          { name: `${y}年${m}月`, path },
        ],
      }),
      { lastmod: lastOf(days.flatMap((d) => d.items)) }
    );
  }
  await out(
    "/archive/",
    page({
      path: "/archive/",
      title: "過去のアニメニュース",
      desc: "これまでに集めたアニメまわりのニュースを、月ごと・日ごとに見られます。",
      h1: "過去のニュース",
      lead: "これまでに集めたニュースを月ごとにまとめています。",
      body: months.size
        ? `<ul class="archive-days">${[...months]
            .map(([k, days]) => {
              const [y, m] = k.split("-").map(Number);
              return `<li><a class="archive-day" href="/archive/${y}/${pad(m)}/">${y}年${m}月<span class="n">${days.reduce((a, d) => a + d.items.length, 0)} 件</span></a></li>`;
            })
            .join("")}</ul>`
        : '<p class="empty">まだありません。</p>',
      crumbs: [{ name: "過去のニュース", path: "/archive/" }],
    }),
    { lastmod: newsArchive[0] ? lastOf(newsArchive[0].items) : undefined }
  );

  // ---------- このサイトについて ----------
  const sourceNames = (news?.sources || []).map((s) => s.name);
  await out(
    "/about/",
    page({
      path: "/about/",
      title: "このサイトについて",
      desc: `${SITE}は、アニメの放送予定（番組表）と、アニメ・声優・劇場版などのニュースをまとめているサイトです。`,
      h1: "このサイトについて",
      body: `<div class="prose">
        <h2>どんなサイト？</h2>
        <p>${esc(SITE)}は、今日放送のアニメの番組表と、アニメまわりのニュースを一か所で見られるようにしているサイトです。30 分おきに更新しています。</p>
        <h2>放送予定について</h2>
        <p>放送予定は、有志が運営する <a href="${SYOBOI}" target="_blank" rel="noopener">しょぼいカレンダー</a> のデータを利用しています。地上波の主要局・独立局・BS・AT-X などの CS・配信サービスに絞って載せています。放送時間は変更されることがあるので、実際の放送は各局の番組表でご確認ください。作品の画像は AniList のデータを使っていて、別の作品の画像が出てしまうこともあります。</p>
        <h2>ニュースについて</h2>
        <p>載せているのは、記事の見出し・要約の一部・元記事へのリンクと、元記事が設定している紹介用の画像だけです。記事の本文は転載していません。記事と画像の権利は、それぞれの発行元に帰属します。種別の分け方は見出しのことばから機械的に判定しているので、まちがっていることもあります。</p>
        <h2>ブラウザに保存しているもの</h2>
        <p>「あとで読む」に入れた記事や画面の状態は、お使いのブラウザ（localStorage）にだけ保存しています。サーバーには送っていません。アクセスの集計に Google アナリティクスを使っています。</p>
        ${sourceNames.length ? `<h2>おもな収集元</h2><p>${sourceNames.slice(0, 40).map(esc).join(" / ")}</p>` : ""}
        ${config.site?.contactUrl ? `<h2>お問い合わせ</h2><p><a href="${esc(config.site.contactUrl)}" target="_blank" rel="noopener">お問い合わせフォーム</a></p>` : ""}
      </div>`,
      crumbs: [{ name: "このサイトについて", path: "/about/" }],
    })
  );

  // ---------- 404 ----------
  await out(
    "/404.html",
    page({
      path: "/404.html",
      title: "ページが見つかりません",
      desc: "お探しのページは見つかりませんでした。",
      h1: "ページが見つかりません",
      lead: "お探しのページは、移動したか、なくなった可能性があります。",
      body: '<p><a class="more-btn" href="/">トップへ戻る</a></p>',
      noindex: true,
    }),
    { index: false }
  );

  // ---------- feed.xml（Atom） ----------
  {
    const items = (news?.items || []).slice(0, 50);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ja">
  <title>${esc(SITE)}</title>
  <subtitle>${esc(config.site?.tagline || "")}</subtitle>
  <link href="${BASE}" rel="alternate"/>
  <link href="${abs("/feed.xml")}" rel="self"/>
  <id>${BASE}</id>
  <updated>${news?.updatedAt || now.toISOString()}</updated>
  <author><name>${esc(SITE)}</name></author>
${items
  .map(
    (it) => `  <entry>
    <title>${esc(it.title)}</title>
    <link href="${esc(it.url)}"/>
    <id>${BASE}#${it.id}</id>
    <updated>${new Date(it.publishedAt).toISOString()}</updated>
    <summary>${esc(`${it.source}${it.summary ? ` ／ ${it.summary}` : ""}`)}</summary>
  </entry>`
  )
  .join("\n")}
</feed>
`;
    await out("/feed.xml", xml, { index: false });
  }

  // ---------- sitemap.xml ----------
  {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap
  .map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().replace(/\.\d{3}Z$/, "+00:00")}</lastmod>` : ""}</url>`)
  .join("\n")}
</urlset>
`;
    await out("/sitemap.xml", xml, { index: false });
  }

  log(`pages: ${sitemap.length} indexable, ${written.length} written`);
  return written;
}
