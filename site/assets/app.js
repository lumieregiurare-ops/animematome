(() => {
  const $ = (s) => document.querySelector(s);
  const PAGE = 40;
  const TOPICS_FIRST = 4;
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
  const state = Object.assign({ series: "all", cat: "all", q: "", hidePR: false, sort: "new" }, store.get(STATE_KEY, {}));

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
      if (state.series !== "all" && !(it.series || []).includes(state.series)) return false;
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
      star.classList.toggle("on", fav.includes(it.id));
      star.textContent = fav.includes(it.id) ? "★" : "☆";
      renderFav();
    });

    row.append(body, star);
    return row;
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

    $("#count").textContent = `${all.length} 件${state.q ? `「${state.q}」で絞り込み中` : ""}`;
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
    for (const t of list.slice(0, topicsShown)) {
      const card = document.createElement("article");
      card.className = "topic";

      const top = document.createElement("div");
      top.className = "topic-top";
      const stars = document.createElement("span");
      stars.className = "topic-stars";
      // 媒体数をそのまま★にする（最大 5 つ）
      const n = Math.min(5, t.sourceCount);
      stars.textContent = "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
      const count = document.createElement("span");
      count.className = "topic-count";
      count.textContent = `${t.sourceCount} 媒体`;
      const time = document.createElement("span");
      time.className = "topic-time";
      time.textContent = hhmm(t.newestAt || t.items?.[0]?.publishedAt || data.updatedAt);
      top.append(stars, count, time);

      const body = document.createElement("div");
      body.className = "topic-body";
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
      for (const it of (t.items || []).slice(0, 4)) {
        const li = document.createElement("li");
        const s = document.createElement("span");
        s.className = "src";
        s.textContent = it.source;
        const la = document.createElement("a");
        la.href = it.url;
        la.target = "_blank";
        la.rel = "noopener noreferrer";
        la.textContent = it.title;
        la.addEventListener("click", () => markRead(it.id));
        li.append(s, la);
        links.appendChild(li);
      }

      body.append(h, sum, links);
      card.append(top, body);
      grid.appendChild(card);
    }
    const more = $("#topicMore");
    more.hidden = list.length <= topicsShown;
    more.textContent = `ほかの話題を見る（残り ${list.length - topicsShown} 件）`;
  }

  // ---------- 左カラム ----------
  function renderFilters() {
    const nav = $("#seriesNav");
    nav.innerHTML = "";
    const seriesTabs = [{ id: "all", label: "すべて", count: data.total }, ...data.series.filter((s) => s.count > 0)];
    for (const s of seriesTabs) {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.series === s.id));
      b.innerHTML = `${s.label}<span class="n">${s.count}</span>`;
      b.addEventListener("click", () => set({ series: s.id }));
      nav.appendChild(b);
    }

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

    const srcs = $("#srcList");
    srcs.innerHTML = "";
    for (const s of data.sources.slice(0, 12)) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${s.name}</span><span class="c">${s.count}</span>`;
      srcs.appendChild(li);
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
        $("#q").value = w;
        set({ q: w });
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
    const meta = document.createElement("div");
    meta.className = "gacha-meta";
    meta.textContent = `${it.source} ・ ${hhmm(it.publishedAt)}`;
    const t = document.createElement("div");
    t.className = "gacha-title";
    t.textContent = it.title;
    a.append(meta, t);
    box.appendChild(a);
  }

  // ---------- 放送予定（しょぼいカレンダー） ----------
  let sched = null;
  let schedDay = "";
  let chFilter = "all";

  function jstDayKey(d = new Date()) {
    return new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  }
  function timeOf(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  function dayTabLabel(date) {
    const today = jstDayKey();
    const tomorrow = jstDayKey(new Date(Date.now() + 86400000));
    if (date === today) return "今日";
    if (date === tomorrow) return "明日";
    const [, m, d] = date.split("-");
    const wd = ["日", "月", "火", "水", "木", "金", "土"][new Date(`${date}T00:00:00+09:00`).getDay()];
    return `${Number(m)}/${Number(d)}（${wd}）`;
  }
  function allPrograms() {
    return (sched?.days || []).flatMap((d) => d.programs);
  }
  // 放送予定のカード 1 枚
  function programNode(p, { showDay = false } = {}) {
    const a = document.createElement("a");
    a.className = "prog";
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = p.fullTitle || p.title;

    const time = document.createElement("div");
    time.className = "prog-time";
    time.innerHTML = `<span class="t">${timeOf(p.st)}</span>${showDay ? `<span class="d">${dayTabLabel(p.st.slice(0, 10))}</span>` : ""}`;

    const body = document.createElement("div");
    body.className = "prog-body";
    const t = document.createElement("div");
    t.className = "prog-title";
    t.textContent = p.title;
    const meta = document.createElement("div");
    meta.className = "prog-meta";
    const ch = document.createElement("span");
    ch.className = "prog-ch";
    ch.textContent = p.ch;
    meta.appendChild(ch);
    if (p.count) {
      const c = document.createElement("span");
      c.className = "prog-count";
      c.textContent = `#${p.count}`;
      meta.appendChild(c);
    }
    if (p.sub) {
      const s = document.createElement("span");
      s.className = "prog-sub";
      s.textContent = p.sub;
      meta.appendChild(s);
    }
    body.append(t, meta);
    a.append(time, body);
    return a;
  }

  // これから放送。時計が進むと中身が変わるので 1 分ごとに描き直す
  function renderUpcoming() {
    const box = $("#upcomingBody");
    box.innerHTML = "";
    if (!sched) return;
    const now = Date.now();
    const list = allPrograms()
      .filter((p) => new Date(p.st).getTime() > now)
      .sort((a, b) => a.st.localeCompare(b.st))
      .slice(0, 8);
    if (!list.length) {
      box.innerHTML = `<p class="empty-mini">このあと放送予定の番組はありません。</p>`;
      $("#upcomingNote").textContent = "";
      return;
    }
    const soon = Math.round((new Date(list[0].st).getTime() - now) / 60000);
    $("#upcomingNote").textContent = soon < 60 ? `次は約 ${Math.max(1, soon)} 分後です。` : `次は ${timeOf(list[0].st)} からです。`;

    const wrap = document.createElement("div");
    wrap.className = "prog-list";
    for (const p of list) {
      const node = programNode(p, { showDay: p.st.slice(0, 10) !== jstDayKey() });
      const left = Math.round((new Date(p.st).getTime() - now) / 60000);
      if (left <= 60) {
        const tag = document.createElement("span");
        tag.className = "prog-soon";
        tag.textContent = `あと${Math.max(1, left)}分`;
        node.querySelector(".prog-meta").appendChild(tag);
      }
      wrap.appendChild(node);
    }
    box.appendChild(wrap);
  }

  function renderDayTabs() {
    const tabs = $("#dayTabs");
    tabs.innerHTML = "";
    for (const d of sched.days) {
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

  function renderTimetable() {
    const box = $("#timetableBody");
    box.innerHTML = "";
    const day = sched.days.find((d) => d.date === schedDay);
    if (!day) return;
    const list = day.programs.filter((p) => chFilter === "all" || p.chId === chFilter);
    if (!list.length) {
      box.innerHTML = `<p class="empty-mini">この日の放送はありません。</p>`;
      return;
    }
    const now = Date.now();
    const wrap = document.createElement("div");
    wrap.className = "prog-list";
    for (const p of list) {
      const node = programNode(p);
      if (new Date(p.ed || p.st).getTime() < now) node.classList.add("is-past");
      wrap.appendChild(node);
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

  function renderTitleRanking() {
    const box = $("#titleList");
    box.innerHTML = "";
    const list = (sched.titles || []).slice(0, 10);
    const max = Math.max(1, ...list.map((t) => t.count));
    for (const t of list) {
      const li = document.createElement("li");
      li.innerHTML = `<div class="bar-row"><span>${t.title}</span><span class="c">${t.count}</span></div>
        <div class="bar"><span style="width:${Math.round((t.count / max) * 100)}%"></span></div>`;
      li.querySelector("span").style.cursor = "pointer";
      li.addEventListener("click", () => {
        $("#q").value = t.title;
        set({ q: t.title });
      });
      box.appendChild(li);
    }
  }

  // 今夜これ観ませんか（これから放送される番組からランダム）
  let tonightPid = "";
  function renderTonight() {
    const box = $("#tonightBody");
    box.innerHTML = "";
    if (!sched) return;
    const now = Date.now();
    const pool = allPrograms().filter((p) => new Date(p.st).getTime() > now);
    if (!pool.length) {
      box.innerHTML = `<p class="mod-desc">このあとの放送予定がありません。</p>`;
      return;
    }
    const from = pool.filter((p) => p.pid !== tonightPid);
    const p = (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
    tonightPid = p.pid;
    const card = document.createElement("div");
    card.className = "tonight-card";
    card.innerHTML = `<div class="tonight-time">${dayTabLabel(p.st.slice(0, 10))} ${timeOf(p.st)}</div>`;
    const node = programNode(p);
    // 上に日付と時刻を出しているので、カード側の時刻は消す
    node.classList.add("no-time");
    card.appendChild(node);
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
      $("#titleMod").hidden = true;
      return;
    }
    const today = jstDayKey();
    schedDay = sched.days.some((d) => d.date === today) ? today : sched.days[0]?.date || "";
    renderUpcoming();
    renderDayTabs();
    renderTimetable();
    renderChannels();
    renderTitleRanking();
    renderTonight();
    // 時計が進むと「これから放送」の中身が変わる
    setInterval(renderUpcoming, 60000);
  }

  function renderFav() {
    const box = $("#favList");
    box.innerHTML = "";
    const items = fav.map((id) => data.items.find((it) => it.id === id)).filter(Boolean);
    $("#favDesc").textContent = items.length ? "このブラウザにだけ保存しています。" : "記事の ☆ を押すとここに貯まります。";
    for (const it of items.slice(0, 12)) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = it.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.title;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "fav-del";
      del.textContent = "×";
      del.title = "外す";
      del.addEventListener("click", () => {
        toggleFav(it.id);
        renderFav();
        renderList();
      });
      li.append(a, del);
      box.appendChild(li);
    }
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
    $("#q").value = state.q;

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
    renderFav();
  }

  // ---------- 操作 ----------
  let qTimer = 0;
  $("#q").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => set({ q: e.target.value }), 200);
  });
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
    topicsShown += 4;
    renderTopics();
  });
  $("#gachaAgain").addEventListener("click", () => swapWithSpinner($("#gachaBody"), renderGacha));
  $("#tonightAgain").addEventListener("click", () => swapWithSpinner($("#tonightBody"), renderTonight, { min: 96, max: 200 }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("#q")) {
      e.preventDefault();
      $("#q").focus();
    }
  });
  const toTop = $("#toTop");
  const onScroll = () => (toTop.hidden = window.scrollY < 500);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  boot();
})();
