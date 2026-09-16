// AniList（https://anilist.co）から作品のカバー画像を検索する。
// しょぼいカレンダーの番組表には画像が無いので、番組表のサムネイル用にここで補う。
// 認証なしだと大まかに 30 req/分ほどでレート制限されるため、呼び出し側で間隔をあけて使うこと。
import { fetchText } from "./util.mjs";

const ENDPOINT = "https://graphql.anilist.co";
const QUERY = `query($s:String){Media(search:$s,type:ANIME){coverImage{large}}}`;

// 検索精度を上げるため、しょぼいカレンダーの短縮タイトルに付く
// 末尾の話数（5）や年号(1996)、ローマ数字（Ⅱ Ⅲ… / II III…全角半角どちらも）、
// 「！2」のような区切り記号のあとの通し数字の注記を落とす
function searchTitleOf(title) {
  return title
    .replace(/[（(][^（()）]*[)）]\s*$/, "")
    .replace(/[\sー]*[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ]+\s*$/, "")
    .replace(/[\sー]*(?:I{2,3}|IV|VI{0,3}|IX|X)$/, "")
    .replace(/[！!？?・\s]+\d{1,2}$/, "")
    .trim();
}

export async function searchCoverImage(title, { timeoutMs = 10000 } = {}) {
  const s = searchTitleOf(title) || title;
  if (!s) return "";
  try {
    const text = await fetchText(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { s } }),
      timeoutMs,
    });
    const j = JSON.parse(text);
    return j?.data?.Media?.coverImage?.large || "";
  } catch (e) {
    // 404 は「該当作品なし」という正常な結果。それ以外（タイムアウト・レート制限など）は
    // 呼び出し側でリトライできるよう、区別して投げ直す
    if (/^HTTP 404\b/.test(e.message)) return "";
    throw e;
  }
}
