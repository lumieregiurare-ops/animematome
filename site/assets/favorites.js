(() => {
  const $ = (s) => document.querySelector(s);
  const FAV_KEY = "anime:fav";
  const READ_KEY = "anime:read";

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

  function hhmm(iso) {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

  const CAT_EMOJI = {
    new: "✨", onair: "📺", pv: "🎬", cast2: "🎤", music2: "🎵",
    movie2: "🎦", goods2: "🎁", manga: "📖", biz2: "📈", other: "📰",
  };
  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  function applyPlaceholder(box, seed, glyph) {
    const hue = hashHue(seed);
    box.classList.add("thumb-ph");
    box.style.background = `linear-gradient(135deg, hsl(${hue} 68% 62%), hsl(${(hue + 46) % 360} 68% 46%))`;
    box.textContent = glyph;
  }
  function thumbNode(url, seed, glyph, className) {
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
        applyPlaceholder(box, seed, glyph);
      });
      box.appendChild(img);
    } else {
      applyPlaceholder(box, seed, glyph);
    }
    return box;
  }

  function badge(text, cls) {
    const b = document.createElement("span");
    b.className = `badge ${cls}`;
    b.textContent = text;
    return b;
  }

  function makeRow(it, data, onRemove) {
    const row = document.createElement("article");
    row.className = "row";

    const thumb = thumbNode(it.image, it.title, CAT_EMOJI[it.categories[0]] || CAT_EMOJI.other, "row-thumb");

    const body = document.createElement("div");
    body.className = "row-body";

    const top = document.createElement("div");
    top.className = "row-top";
    if (it.isOfficial) top.appendChild(badge("公式", "badge-official"));
    for (const c of it.categories.slice(0, 1)) {
      const label = data.categories.find((x) => x.id === c)?.label;
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
    star.className = "fav-btn on";
    star.textContent = "★";
    star.title = "外す";
    star.addEventListener("click", () => {
      toggleFav(it.id);
      onRemove();
    });

    row.append(thumb, body, star);
    return row;
  }

  async function boot() {
    $("#year").textContent = new Date().getFullYear();

    let data;
    try {
      const r = await fetch(`data/news.json?t=${Math.floor(Date.now() / 300000)}`);
      data = await r.json();
    } catch {
      $("#favBody").innerHTML = "";
      $("#empty").hidden = false;
      $("#empty").textContent = "読み込めませんでした。時間をおいて開き直してください。";
      return;
    }

    render(data);
  }

  function render(data) {
    const box = $("#favBody");
    box.innerHTML = "";
    const items = fav.map((id) => data.items.find((it) => it.id === id)).filter(Boolean);
    $("#empty").hidden = items.length > 0;
    if (!items.length) return;

    const rows = document.createElement("div");
    rows.className = "rows";
    for (const it of items) {
      rows.appendChild(makeRow(it, data, () => render(data)));
    }
    box.appendChild(rows);
  }

  boot();
})();
