/* HomeQuest service worker
 * - 画面（HTML）はネット優先：つながる時は常に最新、圏外の時だけ保存済みを表示
 *   → index.html を更新すれば、アプリ版にも次回起動時に反映されます
 * - サーバーがエラー（サイト停止・障害など）を返したときも、保存済みの画面で動かす
 *   （データは Firebase に直接つながるので、画面さえ出せば使える）
 * - アイコン等はキャッシュを先に返し、裏で更新
 * - Firebase のSDK（バージョン付きURL）とフォントはキャッシュ
 * - Firestore / ログイン等の通信には一切手を出さない
 * 中身を大きく変えたときは CACHE の番号を上げてください。
 */
const CACHE = "homequest-v4";
/* 画面の土台：一般公開版（Netlify）はトップ、家族用（GitHub Pages）は housework.html */
const SHELL = self.location.hostname === "chochopolice.github.io" ? "housework.html" : "./";
const PRECACHE = [
  SHELL,
  "manual.html",
  "privacy.html",
  "delete-account.html",
  "terms.html",
  "manifest.webmanifest",
  "icons/icon-192.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // 1件失敗してもインストール自体は止めない
      Promise.all(PRECACHE.map((url) =>
        fetch(url, { cache: "no-cache" })
          .then((res) => res.ok ? clean(res).then((r) => cache.put(url, r)) : null)
          .catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("homequest-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isHtml(request) {
  return request.mode === "navigate" ||
    (request.headers.get("accept") || "").includes("text/html");
}

/* リダイレクトを経た応答は、画面遷移の応答に使うとエラーになるので作り直して保存する */
async function clean(res) {
  if (!res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function fromCache(cache, request) {
  return (await cache.match(request, { ignoreSearch: true })) ||
         (request.mode === "navigate" ? await cache.match(SHELL) : undefined);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  let res;
  try {
    res = await fetch(request);
  } catch (e) {
    const hit = await fromCache(cache, request);
    if (hit) return hit;
    throw e;
  }
  if (res.ok) {
    const copy = await clean(res.clone());
    cache.put(request, copy);
    return res;
  }
  // 404 以外のエラー（サイトの一時停止・障害など）は、保存済みの画面があればそちらを出す
  if (res.type !== "opaqueredirect" && res.status !== 404) {
    const hit = await fromCache(cache, request);
    if (hit) return hit;
  }
  return res;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const update = fetch(request).then((res) => {
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  }).catch(() => hit);
  return hit || update;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // このサイトの中（sw.js と同じ階層以下）だけ扱う
    if (!url.pathname.startsWith(new URL("./", self.location).pathname)) return;
    event.respondWith(isHtml(req) ? networkFirst(req) : staleWhileRevalidate(req));
    return;
  }
  // Firebase SDK（URLにバージョンが入っているので中身は変わらない）
  if (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/")) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Google Fonts
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  // それ以外（Firestore・認証など）はブラウザに任せる
});
