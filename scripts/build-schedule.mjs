// しょぼいカレンダーから 3 日分の放送予定を取って docs/data/schedule.json を作る。
// collect.mjs から呼ばれるほか、単体でも実行できる。
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readJson, writeJson, log } from "./lib/util.mjs";
import { fetchChannels, fetchPrograms, fetchTitles } from "./lib/syoboi.mjs";
import { searchCoverImage } from "./lib/anilist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "data", "schedule.json");
const CH_CACHE = join(ROOT, "data", "channels.json");
const IMG_CACHE = join(ROOT, "data", "anime-images.json");

// 番組のサムネイルを AniList から取って tid ごとにキャッシュする。
// しょぼいカレンダーの ID とは体系が違うので、タイトルの文字列検索でマッチさせるしかない
// （見つからない／違う作品に当たることもある。その場合は次回 30 日後に再挑戦する）。
async function attachImages(titleList, { limit = 60, minGapMs = 2100, budgetMs = 5 * 60000 } = {}) {
  const cache = (await readJson(IMG_CACHE, null)) || { images: {} };
  const now = Date.now();
  const STALE_MS = 30 * 86400000;
  const targets = titleList.filter((t) => {
    const c = cache.images[t.tid];
    return !c || (!c.image && now - new Date(c.at).getTime() > STALE_MS);
  });
  if (targets.length) {
    const start = Date.now();
    let got = 0;
    for (const t of targets.slice(0, limit)) {
      if (Date.now() - start > budgetMs) {
        log(`AniList 画像取得: 時間切れのため中断（残りは次回）`);
        break;
      }
      try {
        const image = await searchCoverImage(t.title);
        cache.images[t.tid] = { image, at: new Date().toISOString() };
        if (image) got++;
      } catch (e) {
        log(`AniList 検索に失敗 (${t.title}): ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, minGapMs));
    }
    await writeJson(IMG_CACHE, cache);
    log(`AniList 画像: ${got}/${targets.length} 件取得`);
  }
  for (const t of titleList) t.image = cache.images[t.tid]?.image || "";
}

export async function buildSchedule(config) {
  const cfg = config.schedule || {};
  const days = cfg.days ?? 3;

  // 局の一覧はめったに変わらないので、1 週間はキャッシュを使う
  let chCache = await readJson(CH_CACHE, null);
  const stale = !chCache || Date.now() - new Date(chCache.at || 0).getTime() > 7 * 86400000;
  if (stale) {
    chCache = { at: new Date().toISOString(), channels: await fetchChannels() };
    await writeJson(CH_CACHE, chCache);
    log(`局マスタを更新: ${chCache.channels.length} 局`);
  }
  const chById = new Map(chCache.channels.map((c) => [c.id, c]));

  // 載せる局。多すぎると放送予定が埋もれるので、主要局だけに絞る
  const allow = (cfg.channels || []).map((k) => new RegExp(k));
  const allowed = (name) => !allow.length || allow.some((re) => re.test(name));

  // 今日の 0 時から days 日ぶん
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + days * 86400000 - 1000);

  const programs = await fetchPrograms(from, to);
  const kept = programs.filter((p) => {
    const ch = chById.get(p.chId);
    return ch && allowed(ch.name);
  });

  const titles = await fetchTitles([...new Set(kept.map((p) => p.tid))]);

  // 日付（日本時間）ごとにまとめる
  const byDay = new Map();
  const usedCh = new Map();
  for (const p of kept) {
    const t = titles.get(p.tid);
    if (!t || !t.title) continue;
    const ch = chById.get(p.chId);
    const day = p.st.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    usedCh.set(ch.id, ch);
    byDay.get(day).push({
      pid: p.pid,
      tid: p.tid,
      title: t.shortTitle || t.title,
      fullTitle: t.title,
      ch: ch.name,
      chId: ch.id,
      st: p.st,
      ed: p.ed,
      count: p.count,
      sub: p.sub,
      // 番組ページ（しょぼいカレンダー）。出典として必ずリンクする
      url: `https://cal.syoboi.jp/tid/${p.tid}`,
    });
  }

  // 前の日から続いている長時間の枠（一挙放送など）は開始日が昨日になる。
  // 今日より前の日付のタブが残ると紛らわしいので落とす
  const todayKey = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const daysOut = [...byDay.entries()]
    .filter(([date]) => date >= todayKey)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, programs: list.sort((a, b) => a.st.localeCompare(b.st)) }));

  // 今期の番組（放送予定に出てくるタイトル）の一覧。多い順に見せる
  const countByTid = new Map();
  for (const d of daysOut) for (const p of d.programs) countByTid.set(p.tid, (countByTid.get(p.tid) || 0) + 1);
  const titleList = [...countByTid.entries()]
    .map(([tid, count]) => ({ tid, title: titles.get(tid)?.shortTitle || titles.get(tid)?.title || "", count }))
    .filter((t) => t.title)
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

  // ---------- 番組表のサムネイル（AniList） ----------
  // 失敗しても放送予定自体は出したいので、ここで止まらないようにする
  try {
    const imgCfg = config.schedule?.images || {};
    if (imgCfg.enabled !== false) await attachImages(titleList, imgCfg);
  } catch (e) {
    log("番組画像の取得に失敗:", e.message);
  }
  const imageByTid = new Map(titleList.map((t) => [t.tid, t.image || ""]));
  for (const d of daysOut) for (const p of d.programs) p.image = imageByTid.get(p.tid) || "";

  const out = {
    updatedAt: new Date().toISOString(),
    source: { name: "しょぼいカレンダー", url: "https://cal.syoboi.jp/" },
    channels: [...usedCh.values()].sort((a, b) => Number(a.number || 999) - Number(b.number || 999)).map((c) => ({ id: c.id, name: c.name })),
    titles: titleList,
    days: daysOut,
  };
  await writeJson(OUT, out);
  log(`放送予定: ${daysOut.reduce((n, d) => n + d.programs.length, 0)} 件 / ${out.channels.length} 局 / ${titleList.length} 番組`);
  return out;
}

// 単体実行
if (process.argv[1] && process.argv[1].endsWith("build-schedule.mjs")) {
  const config = await readJson(join(ROOT, "config.json"));
  await buildSchedule(config);
}
