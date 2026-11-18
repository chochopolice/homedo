/* HomeQuest service worker
 * - 画面（HTML）はネット優先：つながる時は常に最新、圏外の時だけ保存済みを表示
 *   → housework.html を更新すれば、アプリ版にも次回起動時に反映されます
 * - アイコン等はキャッシュを先に返し、裏で更新
 * - Firebase のSDK（バージョン付きURL）とフォントはキャッシュ
 * - Firestore / ログイン等の通信には一切手を出さない
 * 中身を大きく変えたときは CACHE の番号を上げてください。
 */
const CACHE = "homequest-v1";
const PRECACHE = [
  "housework.html",
  "manual.html",
  "privacy.html",
  "delete-account.html",
  "terms.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // 1件失敗してもインストール自体は止めない
      Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const shell = await cache.match("housework.html");
    if (shell) return shell;
    throw e;
  }
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
    // このフォルダ（/homedo/）の中だけ扱う
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
