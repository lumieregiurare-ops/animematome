// 載せた記事・放送予定を日ごとのファイルに貯めておく。news.json は数日、schedule.json は 3 日分しか
// 持たないが、こちらは残るので、作品別・放送局別・日別のページを作る材料になる。
// 1 日 1 ファイルにしているのは、収集のたびに書き換わるのをその日前後のファイルだけにするため
// （大きなファイル 1 つにすると、30 分おきのコミットでリポジトリがどんどん膨らむ）。
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// 日本時間の日付。shiftHours を渡すと、その時刻までを前の日として数える（放送日は朝 5 時区切り）
export function jstDay(iso, shiftHours = 0) {
  return new Date(new Date(iso).getTime() + (9 - shiftHours) * 3600000).toISOString().slice(0, 10);
}

function fileOf(dir, day) {
  const [y, m, d] = day.split("-");
  return join(dir, y, m, `${d}.json`);
}

async function readDay(dir, day) {
  try {
    return JSON.parse(await readFile(fileOf(dir, day), "utf8"));
  } catch {
    return [];
  }
}

// items を日ごとのファイルへ足し込み、中身が変わったファイルだけ書き直す。
// replaceFrom 以降の日は、いま持っている一覧でまるごと置き換える（放送予定は変更・取り消しがあるため）。
// それより前の日は、すでに貯めてある分に足し込む（掲載期間を過ぎて消えた記事も残すため）。
export async function updateArchive(dir, items, { fields, dayOf, idKey = "id", sortKey, desc = true, keepNonEmpty = [], replaceFrom = "" }) {
  const byDay = new Map();
  for (const it of items) {
    const day = dayOf(it);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(it);
  }
  let written = 0;
  for (const [day, list] of byDay) {
    const prev = await readDay(dir, day);
    const replace = replaceFrom && day >= replaceFrom;
    const map = new Map(replace ? [] : prev.map((it) => [it[idKey], it]));
    const oldById = new Map(prev.map((it) => [it[idKey], it]));
    for (const it of list) {
      const next = {};
      for (const k of fields) if (it[k] !== undefined) next[k] = it[k];
      // 画像や要約は後から取れることがあるので、取れていた値は空で上書きしない
      const old = oldById.get(it[idKey]);
      if (old) for (const k of keepNonEmpty) if (!next[k] && old[k]) next[k] = old[k];
      map.set(it[idKey], next);
    }
    const merged = [...map.values()].sort((a, b) => {
      const x = a[sortKey] || "";
      const y = b[sortKey] || "";
      return (x < y ? -1 : x > y ? 1 : 0) * (desc ? -1 : 1);
    });
    const out = JSON.stringify(merged, null, 1);
    if (out === JSON.stringify(prev, null, 1)) continue;
    const f = fileOf(dir, day);
    await mkdir(join(f, ".."), { recursive: true });
    await writeFile(f, out, "utf8");
    written++;
  }
  return written;
}

// いまの docs/data/news.json と schedule.json を data/archive/ に貯める
export async function archiveCurrent(root) {
  const read = async (p) => {
    try {
      return JSON.parse(await readFile(p, "utf8"));
    } catch {
      return null;
    }
  };
  const news = await read(join(root, "docs", "data", "news.json"));
  const sched = await read(join(root, "docs", "data", "schedule.json"));
  let n = 0;
  if (news?.items?.length) {
    n += await updateArchive(join(root, "data", "archive", "news"), news.items, {
      fields: ["id", "title", "url", "source", "summary", "publishedAt", "image", "categories", "series", "isPR", "isOfficial"],
      dayOf: (it) => jstDay(it.publishedAt),
      sortKey: "publishedAt",
      keepNonEmpty: ["image", "summary"],
    });
  }
  const progs = (sched?.days || []).flatMap((d) => d.programs);
  if (progs.length) {
    // 放送日は朝 5 時区切り。今日以降の放送日は、いまの放送予定でまるごと置き換える（変更・取り消しがあるため）
    n += await updateArchive(join(root, "data", "archive", "programs"), progs, {
      fields: ["pid", "tid", "title", "fullTitle", "ch", "chId", "st", "ed", "count", "sub", "image"],
      dayOf: (p) => jstDay(p.st, 5),
      idKey: "pid",
      sortKey: "st",
      desc: false,
      keepNonEmpty: ["image"],
      replaceFrom: jstDay(new Date().toISOString(), 5),
    });
  }
  return n;
}

// すべての日を読む。返り値は [{ day: "2026-09-24", items: [...] }]（新しい日から）
export async function loadArchive(dir) {
  const days = [];
  let years = [];
  try {
    years = await readdir(dir);
  } catch {
    return days;
  }
  for (const y of years.filter((x) => /^\d{4}$/.test(x))) {
    for (const m of (await readdir(join(dir, y))).filter((x) => /^\d{2}$/.test(x))) {
      for (const f of (await readdir(join(dir, y, m))).filter((x) => /^\d{2}\.json$/.test(x))) {
        const day = `${y}-${m}-${f.slice(0, 2)}`;
        const items = await readDay(dir, day);
        if (items.length) days.push({ day, items });
      }
    }
  }
  return days.sort((a, b) => (a.day < b.day ? 1 : -1));
}
