// しょぼいカレンダー（cal.syoboi.jp）から放送予定を取る。
// 有志が運営しているデータベースなので、負荷をかけないよう 1 回の収集で数リクエストに収め、
// 局の一覧は変わらないのでキャッシュして使い回す。サイトにはクレジットを必ず出すこと。
import { fetchText, log } from "./util.mjs";

const BASE = "https://cal.syoboi.jp/db.php";

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
}

function decode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&");
}

// "2026-09-15 14:00:00"（日本時間）を ISO に直す
function jstToIso(s) {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return "";
  const [, y, mo, d, h, mi, se] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${se}+09:00`;
}

function items(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}\\b[\\s\\S]*?</${name}>`, "g"))].map((m) => m[0]);
}

export async function fetchChannels() {
  const xml = await fetchText(`${BASE}?Command=ChLookup`, { timeoutMs: 20000 });
  return items(xml, "ChItem").map((x) => ({
    id: tag(x, "ChID"),
    name: decode(tag(x, "ChName")),
    url: tag(x, "ChURL"),
    group: tag(x, "ChGID"),
    number: tag(x, "ChNumber"),
  }));
}

// TID → 番組情報。TID はまとめて渡せる
export async function fetchTitles(tids) {
  const out = new Map();
  for (let i = 0; i < tids.length; i += 100) {
    const xml = await fetchText(`${BASE}?Command=TitleLookup&TID=${tids.slice(i, i + 100).join(",")}`, { timeoutMs: 20000 });
    for (const x of items(xml, "TitleItem")) {
      const tid = tag(x, "TID");
      if (!tid) continue;
      out.set(tid, {
        tid,
        title: decode(tag(x, "Title")),
        shortTitle: decode(tag(x, "ShortTitle")),
        cat: tag(x, "Cat"),
        firstYear: tag(x, "FirstYear"),
        firstMonth: tag(x, "FirstMonth"),
        keywords: decode(tag(x, "Keywords")),
      });
    }
  }
  return out;
}

// 期間内の放送予定。from / to は Date
export async function fetchPrograms(from, to) {
  const p = (n) => String(n).padStart(2, "0");
  const fmt = (d) =>
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const xml = await fetchText(`${BASE}?Command=ProgLookup&Range=${fmt(from)}-${fmt(to)}`, { timeoutMs: 25000 });
  const out = [];
  for (const x of items(xml, "ProgItem")) {
    if (tag(x, "Deleted") === "1") continue;
    const st = jstToIso(tag(x, "StTime"));
    if (!st) continue;
    out.push({
      pid: tag(x, "PID"),
      tid: tag(x, "TID"),
      chId: tag(x, "ChID"),
      st,
      ed: jstToIso(tag(x, "EdTime")),
      count: tag(x, "Count"),
      sub: decode(tag(x, "SubTitle")),
      comment: decode(tag(x, "ProgComment")),
    });
  }
  log(`しょぼいカレンダー: 放送予定 ${out.length} 件`);
  return out;
}
