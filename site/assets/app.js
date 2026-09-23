(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const TOPICS_FIRST = 7;
  const SPIN_MS = 320;
  const FAV_KEY = "anime:fav";
  const READ_KEY = "anime:read";
  const STATE_KEY = "anime:state";

  let data = null;
  let shown = PAGE;
  let topicsShown = TOPICS_FIRST;
  let shuffleSeed = Math.random();

  const store = {
    get(key, fallback) {
      try {
        const v = JSON.parse(localStorage.getItem(key) || "null");
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* プライベートモードなどでは保存しない */
      }
    },
  };

  let fav = store.get(FAV_KEY, []);
  let read = store.get(READ_KEY, []);
  const state = Object.assign({ cat: "all", q: "", hidePR: false, sort: "new" }, store.get(STATE_KEY, {}));

  // ---------- 小物 ----------
  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function dayKey(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - date) / 86400000);
    const wd = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
    if (diff === 0) return `今日 ${m}/${d}（${wd}）`;
    if (diff === 1) return `昨日 ${m}/${d}（${wd}）`;
    return `${m}/${d}（${wd}）`;
  }
  function labelOfCat(id) {
    return data.categories.find((c) => c.id === id)?.label || "";
  }
  function labelOfSeries(id) {
    return data.series.find((s) => s.id === id)?.label || "";
  }
  // ---------- サムネイル ----------
  // 画像が取れなかった記事・放送予定には、見出しから決めた単色の地に頭の 1 文字を出す
  const PH_COLORS = ["#3a4270", "#6b3a5c", "#2f5f63", "#6a5530", "#4a3a70", "#703a3a", "#35573a", "#555a66"];
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function firstGlyph(str) {
    return [...(str || "").trim()].find((c) => !/[「『【\[(（"'"'\s]/.test(c)) || "?";
  }
  function applyPlaceholder(box, seed) {
    box.classList.add("thumb-ph");
    box.style.background = PH_COLORS[hashHue(seed) % PH_COLORS.length];
    box.textContent = firstGlyph(seed);
  }
  // url があれば画像、なければプレースホルダー。画像の読み込みに失敗したらプレースホルダーに差し替える
  function thumbNode(url, seed, className) {
    const box = document.createElement("div");
    box.className = className;
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.remove();
        applyPlaceholder(box, seed);
      });
      box.appendChild(img);
    } else {
      applyPlaceholder(box, seed);
    }
    return box;
  }
  function spinnerNode() {
    const sp = document.createElement("span");
    sp.className = "spinner";
    sp.setAttribute("role", "status");
    sp.setAttribute("aria-label", "読み込み中");
    return sp;
  }
  // 高さを保ったままクルクルを挟んでから中身を入れ替える。
  // 描画前や非表示のタブでは offsetHeight が 0 や極端な値になるので、常識的な範囲に丸める
  function swapWithSpinner(box, render, { min = 76, max = 260 } = {}) {
    const h = Math.min(max, Math.max(min, box.offsetHeight || 0));
    box.style.minHeight = `${h}px`;
    box.classList.add("is-loading");
    box.innerHTML = "";
    box.appendChild(spinnerNode());
    setTimeout(() => {
      render();
      box.classList.remove("is-loading");
      box.style.minHeight = "";
    }, SPIN_MS);
  }

  function save() {
    store.set(STATE_KEY, state);
  }
  function set(patch) {
    Object.assign(state, patch);
    shown = PAGE;
    save();
    renderFilters();
    renderList();
  }

  // ---------- 絞り込み ----------
  function visible() {
    const q = state.q.trim().toLowerCase();
    return data.items.filter((it) => {
      if (state.cat !== "all" && !it.categories.includes(state.cat)) return false;
      if (state.hidePR && it.isPR) return false;
      if (q && !`${it.title} ${it.summary || ""} ${it.source}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  // おまかせ順。並べ替えのたびに変わらないよう、seed から決める
  function shuffled(list) {
    const arr = list.map((it, i) => ({ it, k: Math.sin((i + 1) * 9301 + shuffleSeed * 49297) }));
    arr.sort((a, b) => a.k - b.k);
    return arr.map((x) => x.it);
  }

  // ---------- 記事の行 ----------
  function makeRow(it) {
    const row = document.createElement("article");
    row.className = "row" + (it.isNew ? " is-new" : "");

    const thumb = thumbNode(it.image, it.title, "row-thumb");

    const body = document.createElement("div");
    body.className = "row-body";

    const top = document.createElement("div");
    top.className = "row-top";
    if (it.isNew) top.appendChild(badge("NEW", "badge-new"));
    if (it.isOfficial) top.appendChild(badge("公式", "badge-official"));
    for (const s of (it.series || []).slice(0, 1)) top.appendChild(badge(labelOfSeries(s), "badge-series"));
    for (const c of it.categories.slice(0, 1)) {
      const label = labelOfCat(c);
      if (label) top.appendChild(badge(label, "badge-cat"));
    }
    if (it.isPR) top.appendChild(badge("PR", "badge-pr"));
    const src = document.createElement("span");
    src.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
    top.appendChild(src);

    const a = document.createElement("a");
    a.className = "row-title";
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = it.title;
    a.addEventListener("click", () => markRead(it.id));

    const sum = document.createElement("p");
    sum.className = "row-sum";
    sum.textContent = it.summary || "";

    body.append(top, a, sum);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "fav-btn" + (fav.includes(it.id) ? " on" : "");
    star.textContent = fav.includes(it.id) ? "★" : "☆";
    star.title = "あとで読む";
    star.addEventListener("click", () => {
      toggleFav(it.id);
      const isOn = fav.includes(it.id);
      star.classList.toggle("on", isOn);
      star.textContent = isOn ? "★" : "☆";
      if (isOn) burstStar(star);
      onFavChanged();
    });

    row.append(thumb, body, star);
    return row;
  }

  function burstStar(el) {
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
    const burst = document.createElement("span");
    burst.className = "fav-burst";
    const n = 6;
    for (let i = 0; i < n; i++) {
      const p = document.createElement("i");
      p.className = "fav-burst-star";
      p.style.setProperty("--angle", `${(360 / n) * i}deg`);
      p.style.animationDelay = `${i * 12}ms`;
      burst.appendChild(p);
    }
    el.appendChild(burst);
    setTimeout(() => burst.remove(), 700);
  }

  function badge(text, cls) {
    const b = document.createElement("span");
    b.className = `badge ${cls}`;
    b.textContent = text;
    return b;
  }

  function markRead(id) {
    if (read.includes(id)) return;
    read = [id, ...read].slice(0, 400);
    store.set(READ_KEY, read);
  }
  function toggleFav(id) {
    fav = fav.includes(id) ? fav.filter((x) => x !== id) : [id, ...fav].slice(0, 200);
    store.set(FAV_KEY, fav);
  }

  // ---------- 一覧 ----------
  function renderList() {
    const all = visible();
    const ordered = state.sort === "shuffle" ? shuffled(all) : all;
    const list = ordered.slice(0, shown);
    const box = $("#list");
    box.innerHTML = "";

    const countEl = $("#count");
    countEl.innerHTML = "";
    countEl.append(`${all.length} 件`);
    if (state.q) {
      countEl.append(`「${state.q}」で絞り込み中 `);
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "q-clear";
      clear.textContent = "✕ 解除";
      clear.addEventListener("click", () => set({ q: "" }));
      countEl.appendChild(clear);
    }
    $("#empty").hidden = all.length > 0;

    if (state.sort === "shuffle") {
      const rows = document.createElement("div");
      rows.className = "rows";
      for (const it of list) rows.appendChild(makeRow(it));
      box.appendChild(rows);
    } else {
      const groups = new Map();
      for (const it of list) {
        const k = dayKey(it.publishedAt);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(it);
      }
      for (const [key, items] of groups) {
        const sec = document.createElement("section");
        sec.className = "day";
        const h = document.createElement("h3");
        h.className = "day-head";
        h.textContent = dayLabel(key);
        const rows = document.createElement("div");
        rows.className = "rows";
        for (const it of items) rows.appendChild(makeRow(it));
        sec.append(h, rows);
        box.appendChild(sec);
      }
    }

    const more = $("#listMore");
    more.hidden = all.length <= list.length;
    more.textContent = `もっと見る（残り ${all.length - list.length} 件）`;
  }

  // ---------- 注目の話題 ----------
  function renderTopics() {
    const list = data.topics || [];
    const sec = $("#topicsSection");
    if (!list.length) {
      sec.hidden = true;
      return;
    }
    sec.hidden = false;
    const grid = $("#topicGrid");
    grid.innerHTML = "";
    list.slice(0, topicsShown).forEach((t, i) => {
      const card = document.createElement("article");
      // 先頭（いちばん多くの媒体が報じた話題）だけ横いっぱいにする
      card.className = "topic" + (i === 0 ? " is-lead" : "");

      const thumb = thumbNode(t.image, t.title, "topic-thumb");

      const top = document.createElement("div");
      top.className = "topic-top";
      const count = document.createElement("span");
      count.className = "topic-count";
      count.innerHTML = `<b>${Number(t.sourceCount) || 0}</b>媒体`;
      const time = document.createElement("span");
      time.className = "topic-time";
      time.textContent = hhmm(t.publishedAt || data.updatedAt);
      top.append(count, time);

      const body = document.createElement("div");
      body.className = "topic-body";
      body.style.minWidth = "0";
      const h = document.createElement("h3");
      h.className = "topic-title";
      const a = document.createElement("a");
      a.href = t.url || t.items?.[0]?.url || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = t.title;
      h.appendChild(a);
      const sum = document.createElement("p");
      sum.className = "topic-sum";
      sum.textContent = t.summary || "";

      const links = document.createElement("ul");
      links.className = "topic-links";
      for (const it of (t.articles || []).slice(0, 4)) {
        const li = document.createElement("li");
        const s = document.createElement("span");
        s.className = "src";
        s.textContent = it.source;
        const la = document.createElement("a");
        la.href = it.url;
        la.target = "_blank";
        la.rel = "noopener noreferrer";
        la.textContent = it.title;
        la.addEventListener("click", () => markRead(it.id || it.url));
        li.append(s, la);
        links.appendChild(li);
      }

      body.append(top, h, sum, links);
      card.append(thumb, body);
      grid.appendChild(card);
    });
    const more = $("#topicMore");
    more.hidden = list.length <= topicsShown;
    more.textContent = `ほかの話題を見る（残り ${list.length - topicsShown} 件）`;
  }

  // ---------- 左カラム ----------
  function renderFilters() {
    const cl = $("#catList");
    cl.innerHTML = "";
    const cats = [{ id: "all", label: "すべて", count: data.total }, ...data.categories.filter((c) => c.count > 0)];
    for (const c of cats) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = state.cat === c.id ? "active" : "";
      b.innerHTML = `${c.label}<span class="n">${c.count}</span>`;
      b.addEventListener("click", () => set({ cat: c.id }));
      cl.appendChild(b);
    }

    $("#sourceList").textContent = data.sources.map((s) => s.name).join(" / ");

    $("#hidePR").checked = state.hidePR;
    for (const b of document.querySelectorAll("#sortSeg button")) b.classList.toggle("active", b.dataset.sort === state.sort);
  }

  // 見出しによく出ている語。押すと検索に入る
  const STOP = new Set(["モンスターハンター", "モンハン", "ワイルズ", "モンスター", "ハンター", "ゲーム", "情報", "発表", "公開", "配信", "実施", "開始", "登場", "予定", "紹介", "今日", "本日", "最新", "対応", "シリーズ", "カプコン"]);
  function renderWords() {
    const count = new Map();
    for (const it of data.items) {
      const t = it.title.replace(/[「」『』【】（）()\[\]｜|・,.、。！!？?:：;；〜~＋+"'"']/g, " ");
      for (const m of t.matchAll(/[ァ-ヴー]{3,}|[一-龥]{2,}/g)) {
        const w = m[0];
        if (STOP.has(w) || w.length > 10) continue;
        count.set(w, (count.get(w) || 0) + 1);
      }
    }
    const top = [...count.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 18);
    if (!top.length) return;
    $("#wordMod").hidden = false;
    const box = $("#wordCloud");
    box.innerHTML = "";
    for (const [w, n] of top) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${w} ${n}`;
      b.addEventListener("click", () => {
        set({ q: w });
        $("#feedSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      box.appendChild(b);
    }
  }

  // ---------- 右カラム ----------
  let gachaId = "";
  function renderGacha() {
    const pool = data.items.filter((it) => !it.isPR);
    const box = $("#gachaBody");
    box.innerHTML = "";
    if (!pool.length) return;
    // まだ開いていない記事を優先する（毎回同じものが出ないように）
    const unread = pool.filter((it) => !read.includes(it.id) && it.id !== gachaId);
    const from = unread.length ? unread : pool.filter((it) => it.id !== gachaId);
    const it = (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
    gachaId = it.id;

    const a = document.createElement("a");
    a.className = "gacha-item";
    a.href = it.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.addEventListener("click", () => markRead(it.id));
    const thumb = thumbNode(it.image, it.title, "gacha-thumb");
    const info = document.createElement("div");
    info.className = "gacha-info";
    const meta = document.createElement("div");
    meta.className = "gacha-meta";
    meta.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
    const t = document.createElement("div");
    t.className = "gacha-title";
    t.textContent = it.title;
    info.append(meta, t);
    a.append(thumb, info);
    box.appendChild(a);
  }

  // ---------- 放送予定（しょぼいカレンダー） ----------
  let sched = null;
  let schedDay = "";
  let chFilter = "all";
  let showPast = false;

  // 放送の 1 日は朝 5 時で区切り、深夜は 25:30 のように書く（アニメの番組表の慣習）
  const DAY_SHIFT = 5 * 3600000;
  function jstDayKey(d = new Date()) {
    return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  }
  function bdayKey(t) {
    return jstDayKey(new Date(new Date(t).getTime() - DAY_SHIFT));
  }
  function jstParts(t) {
    const j = new Date(new Date(t).getTime() + 9 * 3600000);
    return { h: j.getUTCHours(), m: j.getUTCMinutes() };
  }
  function timeOf(t) {
    const { h, m } = jstParts(t);
    return `${h < 5 ? h + 24 : h}:${String(m).padStart(2, "0")}`;
  }
  function isLate(t) {
    const { h } = jstParts(t);
    return h < 5;
  }
  function addDays(key, n) {
    const d = new Date(`${key}T12:00:00+09:00`);
    return jstDayKey(new Date(d.getTime() + n * 86400000));
  }
  function dayTabLabel(date) {
    const today = bdayKey(Date.now());
    if (date === today) return "今日";
    if (date === addDays(today, 1)) return "明日";
    const [, m, d] = date.split("-");
    const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T12:00:00+09:00`).getDay()];
    return `${Number(m)}/${Number(d)}（${wd}）`;
  }
  function allPrograms() {
    return (sched?.days || []).flatMap((d) => d.programs);
  }
  function endOf(p) {
    return new Date(p.ed || p.st).getTime();
  }
  // しょぼいカレンダーの回数・サブタイトル。"^" で始まるのは番組の補足なので話数としては出さない
  function epText(p) {
    const parts = [];
    if (p.count) parts.push(`#${p.count}`);
    if (p.sub && !p.sub.startsWith("^")) parts.push(p.sub.startsWith("#") ? p.sub : `「${p.sub}」`);
    return parts.join(" ");
  }
  // 放送予定の 1 行（今夜これ観ませんか で使う）
  function programNode(p) {
    const a = document.createElement("a");
    a.className = "prog";
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = p.fullTitle || p.title;
    const thumb = thumbNode(p.image || "", p.title, "prog-thumb");
    const body = document.createElement("div");
    body.className = "prog-body";
    const t = document.createElement("div");
    t.className = "prog-title";
    t.textContent = p.title;
    const meta = document.createElement("div");
    meta.className = "prog-meta";
    const ch = document.createElement("span");
    ch.textContent = p.ch;
    meta.appendChild(ch);
    const ep = epText(p);
    if (ep) {
      const s = document.createElement("span");
      s.textContent = ep;
      meta.appendChild(s);
    }
    body.append(t, meta);
    a.append(thumb, body);
    return a;
  }

  // いま放送中 + このあと。時計が進むと中身が変わるので 1 分ごとに描き直す
  function renderUpcoming() {
    const box = $("#upcomingBody");
    box.innerHTML = "";
    if (!sched) return;
    const now = Date.now();
    const { h, m } = jstParts(now);
    $("#onairClock").textContent = `現在 ${h < 5 ? h + 24 : h}:${String(m).padStart(2, "0")}`;

    const progs = allPrograms();
    // 何時間も続く一挙配信より、ふつうの放送を先に出す
    const dur = (p) => endOf(p) - new Date(p.st).getTime();
    const live = progs.filter((p) => new Date(p.st).getTime() <= now && endOf(p) > now).sort((x, y) => dur(x) - dur(y) || x.st.localeCompare(y.st));
    const next = progs.filter((p) => new Date(p.st).getTime() > now).sort((x, y) => x.st.localeCompare(y.st));
    $("#onairLamp").classList.toggle("lit", live.length > 0);

    if (live.length) {
      const wrap = document.createElement("div");
      wrap.className = "onair-now";
      for (const p of live.slice(0, 3)) {
        const a = document.createElement("a");
        a.className = "live";
        a.href = p.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        const st = new Date(p.st).getTime();
        const pct = Math.min(100, Math.max(0, ((now - st) / (endOf(p) - st)) * 100));
        a.innerHTML = `<span class="live-tag">ON AIR</span><span class="live-title"></span><span class="live-ch"></span>
          <span class="live-bar"><span>${timeOf(p.st)}</span><span class="track"><i style="width:${pct}%"></i></span><span>${timeOf(p.ed || p.st)}</span></span>`;
        const title = a.querySelector(".live-title");
        title.textContent = p.title;
        const ep = epText(p);
        if (ep) {
          const e = document.createElement("span");
          e.className = "ep";
          e.textContent = ep;
          title.appendChild(e);
        }
        a.querySelector(".live-ch").textContent = p.ch;
        wrap.appendChild(a);
      }
      if (live.length > 3) {
        const more = document.createElement("p");
        more.className = "onair-more";
        more.textContent = `ほかに ${live.length - 3} 本が放送中です`;
        wrap.appendChild(more);
      }
      box.appendChild(wrap);
    } else {
      const none = document.createElement("p");
      none.className = "onair-none";
      if (next.length) {
        const left = Math.round((new Date(next[0].st).getTime() - now) / 60000);
        none.innerHTML = `いま放送中のアニメはありません。次は <b>${timeOf(next[0].st)}</b> から（あと ${left >= 60 ? `${Math.floor(left / 60)}時間${left % 60}分` : `${Math.max(1, left)}分`}）`;
      } else {
        none.textContent = "いま放送中のアニメはありません。";
      }
      box.appendChild(none);
    }

    if (!next.length) return;
    const sub = document.createElement("h3");
    sub.className = "onair-sub";
    sub.textContent = "このあと";
    const rail = document.createElement("div");
    rail.className = "poster-rail";
    for (const p of next.slice(0, 12)) {
      const a = document.createElement("a");
      a.className = "poster";
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = p.fullTitle || p.title;
      const img = thumbNode(p.image || "", p.title, "poster-img");
      const time = document.createElement("span");
      time.className = "poster-time";
      const sameDay = bdayKey(p.st) === bdayKey(now);
      time.textContent = sameDay ? timeOf(p.st) : `${dayTabLabel(bdayKey(p.st))} ${timeOf(p.st)}`;
      img.appendChild(time);
      const left = Math.round((new Date(p.st).getTime() - now) / 60000);
      if (left <= 60) {
        const soon = document.createElement("span");
        soon.className = "poster-soon";
        soon.textContent = `あと${Math.max(1, left)}分`;
        img.appendChild(soon);
      }
      const ch = document.createElement("div");
      ch.className = "poster-ch";
      ch.textContent = p.ch;
      const t = document.createElement("div");
      t.className = "poster-title";
      t.textContent = p.title;
      a.append(img, ch, t);
      const ep = epText(p);
      if (ep) {
        const e = document.createElement("div");
        e.className = "poster-ep";
        e.textContent = ep;
        a.appendChild(e);
      }
      rail.appendChild(a);
    }
    box.append(sub, rail);
  }

  // 番組表のタブは「放送日」（朝 5 時区切り）で作る。終わった日は出さない
  function broadcastDays() {
    const today = bdayKey(Date.now());
    const map = new Map();
    for (const p of allPrograms()) {
      const k = bdayKey(p.st);
      if (k < today) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([date, programs]) => ({
      date,
      programs: programs.sort((x, y) => x.st.localeCompare(y.st)),
    }));
  }

  function renderDayTabs() {
    const tabs = $("#dayTabs");
    tabs.innerHTML = "";
    for (const d of broadcastDays()) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(schedDay === d.date));
      b.innerHTML = `${dayTabLabel(d.date)}<span class="n">${d.programs.length}</span>`;
      b.addEventListener("click", () => {
        schedDay = d.date;
        renderDayTabs();
        renderTimetable();
      });
      tabs.appendChild(b);
    }
  }

  // 30 分ごとの段に分け、同じ段で始まる番組を横に並べる
  function renderTimetable() {
    const box = $("#timetableBody");
    box.innerHTML = "";
    const day = broadcastDays().find((d) => d.date === schedDay);
    const list = (day?.programs || []).filter((p) => chFilter === "all" || p.chId === chFilter);
    if (!list.length) {
      box.innerHTML = `<p class="empty-mini">この日の放送はありません。</p>`;
      return;
    }
    const now = Date.now();
    const slots = new Map();
    for (const p of list) {
      const st = new Date(p.st).getTime();
      const key = st - (st % 1800000);
      if (!slots.has(key)) slots.set(key, []);
      slots.get(key).push(p);
    }
    const wrap = document.createElement("div");
    wrap.className = "slots";
    // 今日の表は、終わった段をたたんでおく（いまの 1 時間前より前）
    const hidden = [...slots.entries()].filter(([key, progs]) => !showPast && key < now - 3600000 && progs.every((p) => endOf(p) <= now));
    if (hidden.length) {
      const n = hidden.reduce((sum, [, progs]) => sum + progs.length, 0);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "past-toggle";
      btn.textContent = `放送が終わった ${n} 本を表示（${timeOf(hidden[0][0])}〜）`;
      btn.addEventListener("click", () => {
        showPast = true;
        renderTimetable();
      });
      wrap.appendChild(btn);
      for (const [key] of hidden) slots.delete(key);
    }
    let nowDrawn = false;
    for (const [key, progs] of slots) {
      if (!nowDrawn && key > now) {
        nowDrawn = true;
        // 先頭より前（まだ何も始まっていない）なら線は引かない
        if (wrap.querySelector(".slot")) {
          const line = document.createElement("div");
          line.className = "now-line";
          line.innerHTML = `<span>いま ${timeOf(now)}</span>`;
          wrap.appendChild(line);
        }
      }
      const row = document.createElement("div");
      row.className = "slot";
      if (isLate(key)) row.classList.add("is-late");
      if (progs.every((p) => endOf(p) <= now)) row.classList.add("is-past");
      const time = document.createElement("div");
      time.className = "slot-time";
      time.textContent = timeOf(key);
      const cells = document.createElement("div");
      cells.className = "slot-progs";
      for (const p of progs) {
        const a = document.createElement("a");
        a.className = "slot-prog";
        a.href = p.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = p.fullTitle || p.title;
        const cover = thumbNode(p.image || "", p.title, "sp-cover");
        const body = document.createElement("div");
        body.className = "sp-body";
        const ch = document.createElement("div");
        ch.className = "sp-ch";
        const startsOff = new Date(p.st).getTime() !== key;
        const long = endOf(p) - new Date(p.st).getTime() > 3600000;
        ch.textContent = [p.ch, startsOff ? `${timeOf(p.st)}〜` : "", long ? `〜${timeOf(p.ed)}` : ""].filter(Boolean).join(" ・ ");
        const t = document.createElement("div");
        t.className = "sp-title";
        if (new Date(p.st).getTime() <= now && endOf(p) > now) {
          const l = document.createElement("span");
          l.className = "sp-live";
          l.textContent = "放送中";
          t.appendChild(l);
        }
        t.append(p.title);
        body.append(ch, t);
        const ep = epText(p);
        if (ep) {
          const e = document.createElement("div");
          e.className = "sp-ep";
          e.textContent = ep;
          body.appendChild(e);
        }
        a.append(cover, body);
        cells.appendChild(a);
      }
      row.append(time, cells);
      wrap.appendChild(row);
    }
    box.appendChild(wrap);
  }

  function renderChannels() {
    const box = $("#chList");
    box.innerHTML = "";
    const counts = new Map();
    for (const p of allPrograms()) counts.set(p.chId, (counts.get(p.chId) || 0) + 1);
    const list = [{ id: "all", name: "すべて", count: allPrograms().length }, ...sched.channels.map((c) => ({ ...c, count: counts.get(c.id) || 0 }))];
    for (const c of list) {
      if (c.id !== "all" && !c.count) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = chFilter === c.id ? "active" : "";
      b.innerHTML = `${c.name}<span class="n">${c.count}</span>`;
      b.addEventListener("click", () => {
        chFilter = c.id;
        renderChannels();
        renderTimetable();
      });
      box.appendChild(b);
    }
  }

  // 今夜これ観ませんか。今夜（朝 5 時まで）に始まる番組から選び、なければこの先の番組から
  let tonightPid = "";
  function renderTonight() {
    const box = $("#tonightBody");
    box.innerHTML = "";
    if (!sched) return;
    const now = Date.now();
    const upcoming = allPrograms().filter((p) => new Date(p.st).getTime() > now);
    const tonight = upcoming.filter((p) => bdayKey(p.st) === bdayKey(now));
    const pool = tonight.length ? tonight : upcoming;
    if (!pool.length) {
      box.innerHTML = `<p class="mod-desc">このあとの放送予定がありません。</p>`;
      return;
    }
    const from = pool.filter((p) => p.pid !== tonightPid);
    const p = (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
    tonightPid = p.pid;
    const card = document.createElement("div");
    card.className = "tonight-card";
    const time = document.createElement("div");
    time.className = "tonight-time";
    time.innerHTML = `<small>${dayTabLabel(bdayKey(p.st))}</small>${timeOf(p.st)}`;
    card.append(time, programNode(p));
    box.appendChild(card);
  }

  async function loadSchedule() {
    try {
      const r = await fetch(`data/schedule.json?t=${Math.floor(Date.now() / 300000)}`);
      sched = await r.json();
    } catch {
      $("#upcomingBody").innerHTML = `<p class="empty-mini">放送予定を読み込めませんでした。</p>`;
      $("#timetableSection").hidden = true;
      $("#chMod").hidden = true;
      return;
    }
    const days = broadcastDays();
    const today = bdayKey(Date.now());
    schedDay = days.some((d) => d.date === today) ? today : days[0]?.date || "";
    renderUpcoming();
    renderDayTabs();
    renderTimetable();
    renderChannels();
    renderTonight();
    // 時計が進むと「これから放送」の中身が変わる
    setInterval(() => {
      renderUpcoming();
      if (schedDay === bdayKey(Date.now())) renderTimetable();
    }, 60000);
  }

  function updateFavCount() {
    const el = $("#favCount");
    el.hidden = fav.length === 0;
    el.textContent = String(fav.length);
  }

  function renderFavView() {
    const box = $("#favViewBody");
    box.innerHTML = "";
    const items = fav.map((id) => data.items.find((it) => it.id === id)).filter(Boolean);
    $("#favViewEmpty").hidden = items.length > 0;
    if (!items.length) return;
    const rows = document.createElement("div");
    rows.className = "rows";
    for (const it of items) rows.appendChild(makeRow(it));
    box.appendChild(rows);
  }

  function onFavChanged() {
    updateFavCount();
    if (favViewOpen) renderFavView();
  }

  // ---------- あとで読む（中央エリアだけを差し替える簡易ルーティング） ----------
  let favViewOpen = false;
  const BASE_TITLE = document.title;
  function showFavView() {
    favViewOpen = true;
    for (const id of ["upcomingSection", "timetableSection", "topicsSection", "feedSection", "chMod", "catMod", "wordMod"]) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
    $(".side-left").classList.add("fav-hide");
    $("#favView").hidden = false;
    renderFavView();
    document.title = `あとで読む｜${BASE_TITLE}`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function hideFavView() {
    favViewOpen = false;
    $("#favView").hidden = true;
    $("#upcomingSection").hidden = false;
    $("#timetableSection").hidden = false;
    $("#topicsSection").hidden = !(data?.topics?.length);
    $("#feedSection").hidden = false;
    $("#chMod").hidden = false;
    $("#catMod").hidden = false;
    $("#wordMod").hidden = $("#wordCloud").children.length === 0;
    $(".side-left").classList.remove("fav-hide");
    document.title = BASE_TITLE;
  }
  function syncFavView() {
    if (location.hash === "#favorites") showFavView();
    else hideFavView();
  }

  // ---------- 更新の様子 ----------
  function renderChurn() {
    const c = data.churn;
    const el = $("#churn");
    if (!c || !c.previousCount) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `前回から <b>${c.newCount}</b> 本が新着<span class="next" id="nextUpdate"></span>`;
    tickCountdown();
    setInterval(tickCountdown, 30000);
  }

  function tickCountdown() {
    const el = $("#nextUpdate");
    if (!el) return;
    const left = data.nextUpdateAt ? new Date(data.nextUpdateAt).getTime() - Date.now() : 0;
    if (left > 0) {
      const m = Math.round(left / 60000);
      el.textContent = m >= 60 ? `・次の更新まで約 ${Math.round(m / 60)} 時間` : `・次の更新まで約 ${Math.max(1, m)} 分`;
      return;
    }
    // 目安を過ぎたら「まもなく」と言い続けず、最後に更新した時刻を出す
    const min = Math.max(0, Math.round((Date.now() - new Date(data.updatedAt).getTime()) / 60000));
    el.textContent = min < 120 ? `・最終更新 ${min} 分前` : `・最終更新 ${Math.round(min / 60)} 時間前`;
  }

  // ---------- 起動 ----------
  async function boot() {
    $("#year").textContent = new Date().getFullYear();

    try {
      const r = await fetch(`data/news.json?t=${Math.floor(Date.now() / 300000)}`);
      data = await r.json();
    } catch {
      $("#meta").textContent = "データを読み込めませんでした。";
      $("#list").innerHTML = "";
      $("#empty").hidden = false;
      $("#empty").textContent = "ニュースを読み込めませんでした。時間をおいて開き直してください。";
      return;
    }

    const u = new Date(data.updatedAt);
    $("#meta").textContent = `${data.total} 本のニュース ・ 今日 ${data.todayCount} 本 ・ ${data.topics.length} の話題 ・ 最終更新 ${u.getMonth() + 1}/${u.getDate()} ${hhmm(data.updatedAt)}`;

    renderChurn();
    renderFilters();
    renderWords();
    renderTopics();
    renderList();
    renderGacha();
    loadSchedule();
    updateFavCount();
    syncFavView();
  }

  // ---------- 操作 ----------
  window.addEventListener("hashchange", syncFavView);
  $("#favBack").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname + location.search);
    hideFavView();
  });
  document.querySelectorAll(".global-nav a").forEach((a) => a.addEventListener("click", () => hideFavView()));
  $("#hidePR").addEventListener("change", (e) => set({ hidePR: e.target.checked }));
  for (const b of document.querySelectorAll("#sortSeg button")) {
    b.addEventListener("click", () => {
      shuffleSeed = Math.random();
      set({ sort: b.dataset.sort });
    });
  }
  $("#listMore").addEventListener("click", () => {
    shown += PAGE;
    renderList();
  });
  $("#topicMore").addEventListener("click", () => {
    topicsShown += 6;
    renderTopics();
  });
  $("#gachaAgain").addEventListener("click", () => swapWithSpinner($("#gachaBody"), renderGacha));
  $("#tonightAgain").addEventListener("click", () => swapWithSpinner($("#tonightBody"), renderTonight, { min: 96, max: 200 }));
  const toTop = $("#toTop");
  const onScroll = () => (toTop.hidden = window.scrollY < 500);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  // スマホ幅では「放送局でしぼる」を番組表の直前に、「ニュースの種別」「ホットなキーワード」を
  // 新着ニュースの直前に移す（デスクトップは左カラムのまま）
  const mobileQuery = window.matchMedia("(max-width: 820px)");
  function layoutSideMods() {
    const chMod = $("#chMod");
    const catMod = $("#catMod");
    const wordMod = $("#wordMod");
    const sideLeft = $(".side-left");
    const timetableSection = $("#timetableSection");
    const feedSection = $("#feedSection");
    if (mobileQuery.matches) {
      if (chMod.nextElementSibling !== timetableSection) timetableSection.before(chMod);
      if (wordMod.nextElementSibling !== feedSection) feedSection.before(wordMod);
      if (catMod.nextElementSibling !== wordMod) wordMod.before(catMod);
    } else {
      sideLeft.prepend(wordMod);
      sideLeft.prepend(catMod);
      sideLeft.prepend(chMod);
    }
  }
  mobileQuery.addEventListener("change", layoutSideMods);
  layoutSideMods();

  boot();
})();
