// モンハン関連ニュースの収集。各社の RSS、Google ニュースの検索フィード、
// Steam の公式アナウンスを読む。記事本文は持たず、見出し・要約の一部・リンクだけを扱う。
import { fetchText, fetchJson, cleanUrl, hostOf, log, truncate } from "./util.mjs";
import { parseFeed, stripTags, decodeEntities, firstImage } from "./xml.mjs";

// Google ニュースの見出しは「本文 - 媒体名」の形なので分ける
function splitGoogleTitle(title) {
  const m = title.match(/^(.*)\s[-–—]\s([^-–—]{2,30})$/);
  return m ? { title: m[1].trim(), source: m[2].trim() } : { title: title.trim(), source: "" };
}

export async function fetchFeed(feed) {
  const xml = await fetchText(feed.url, { timeoutMs: 20000 });
  return parseFeed(xml).map((e) => {
    const summary = stripTags(e.description || e.content || "");
    return {
      source: feed.name,
      sourceKind: feed.kind || "news",
      title: decodeEntities(e.title || "").trim(),
      url: cleanUrl(e.link || ""),
      summary: truncate(summary, 160),
      publishedAt: e.date ? new Date(e.date).toISOString() : null,
      image: firstImage(e.content || e.description || ""),
      tags: e.categories || [],
      // モンハン専門のフィードを足したときは、キーワード判定を通さずそのまま載せる
      always: !!feed.always,
    };
  });
}

// Google ニュースはキーワード検索の結果を RSS で返す。媒体名が source 要素に入る
export async function fetchGoogleNews(query, { within = "2d", perQuery = 40 } = {}) {
  const q = encodeURIComponent(`${query} when:${within}`);
  const xml = await fetchText(`https://news.google.com/rss/search?q=${q}&hl=ja&gl=JP&ceid=JP:ja`, { timeoutMs: 20000 });
  const blocks = xml.split(/<item>/).slice(1, perQuery + 1);
  const out = [];
  for (const b of blocks) {
    const rawTitle = decodeEntities((b.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
    const link = decodeEntities((b.match(/<link>([^<]*)<\/link>/) || [])[1] || "").trim();
    const date = (b.match(/<pubDate>([^<]*)<\/pubDate>/) || [])[1] || "";
    const srcName = decodeEntities((b.match(/<source url="[^"]*">([^<]*)<\/source>/) || [])[1] || "").trim();
    const srcUrl = (b.match(/<source url="([^"]*)"/) || [])[1] || "";
    if (!rawTitle || !link) continue;
    const t = splitGoogleTitle(rawTitle);
    out.push({
      source: srcName || t.source || "Google ニュース",
      sourceKind: "news",
      sourceHost: hostOf(srcUrl),
      title: t.title,
      url: link,
      summary: "",
      publishedAt: date ? new Date(date).toISOString() : null,
      image: "",
      tags: [],
      viaGoogle: true,
      query,
    });
  }
  return out;
}

// Steam の公式アナウンス。開発・運営が出した一次情報なので、
// キーワードの判定を通さずそのまま載せる（英語のままのことが多い）。
export async function fetchSteamNews(app, { count = 8 } = {}) {
  const j = await fetchJson(
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${app.appid}&count=${count}&maxlength=300`,
    { timeoutMs: 20000 }
  );
  return (j.appnews?.newsitems || [])
    // 外部メディアの記事も混ざるので、公式のアナウンスだけを拾う
    .filter((n) => n.feedname === "steam_community_announcements")
    .map((n) => ({
      source: app.name,
      sourceKind: "official",
      title: decodeEntities(n.title || "").trim(),
      url: cleanUrl(n.url || ""),
      summary: truncate(stripTags(decodeEntities(n.contents || "")), 160),
      publishedAt: n.date ? new Date(n.date * 1000).toISOString() : null,
      image: "",
      tags: [],
      series: app.series || "",
      always: true,
    }));
}

export async function fetchAll(config) {
  const items = [];
  const stats = {};

  for (const feed of config.feeds || []) {
    try {
      const got = await fetchFeed(feed);
      items.push(...got);
      stats[feed.name] = (stats[feed.name] || 0) + got.length;
    } catch (e) {
      log(`feed failed ${feed.name}: ${e.message}`);
      stats[feed.name] = `error`;
    }
  }

  const s = config.steamNews || {};
  if (s.enabled !== false) {
    for (const app of s.apps || []) {
      try {
        const got = await fetchSteamNews(app, { count: s.count });
        items.push(...got);
        stats[app.name] = got.length;
      } catch (e) {
        log(`steam news failed (${app.name}): ${e.message}`);
        stats[app.name] = "error";
      }
    }
  }

  const g = config.googleNews || {};
  if (g.enabled !== false) {
    let n = 0;
    for (const q of g.queries || []) {
      try {
        const got = await fetchGoogleNews(q, { within: g.within, perQuery: g.perQuery });
        items.push(...got);
        n += got.length;
      } catch (e) {
        log(`google news failed (${q}): ${e.message}`);
      }
    }
    stats["Google ニュース"] = n;
  }

  return { items, stats };
}
