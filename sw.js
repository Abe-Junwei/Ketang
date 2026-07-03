/* 客堂静态资源 Service Worker | Offline shell cache (no API/data) */
var CACHE_VERSION = "ketang-shell-v11";
var PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./resources/bg.jpg",
  "./role-permissions.defaults.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./fonts/fonts.css",
  "./fonts/noto-serif-sc-400.woff2",
  "./fonts/noto-serif-sc-600.woff2",
  "./fonts/noto-serif-sc-700.woff2",
  "./fonts/noto-sans-sc-400.woff2",
  "./fonts/noto-sans-sc-500.woff2",
  "./fonts/source-sans-3-400.woff2",
  "./fonts/source-sans-3-500.woff2",
  "./fonts/source-serif-4-400.woff2",
  "./fonts/source-serif-4-600.woff2",
  "./lib/chart.umd.min.js",
  "./js/utils.js",
  "./js/perf.js",
  "./js/perf-rum.js",
  "./js/db.js",
  "./js/api-client.js",
  "./js/guests.js",
  "./js/audit.js",
  "./js/housekeeping.js",
  "./js/meals.js",
  "./js/checkin.js",
  "./js/lodger-actions.js",
  "./js/reservations.js",
  "./js/history.js",
  "./js/validation.js",
  "./js/chart-theme.js",
  "./js/forecast.js",
  "./js/reports.js",
  "./js/events.js",
  "./js/info.js",
  "./js/permissions.js",
  "./js/auth.js",
  "./js/icons.js",
  "./js/picker.js",
  "./js/mobile-ui.js",
  "./js/rooming-tags.js",
  "./js/rooming-capacity.js",
  "./js/rooming-conflicts.js",
  "./js/rooming-plans.js",
  "./js/rooming-adjustments.js",
  "./js/rooming-publish.js",
  "./js/app.js",
];

function shouldHandleFetch(url, request) {
  if (request.method !== "GET") return false;
  if (url.origin !== self.location.origin) return false;
  var path = url.pathname;
  if (path.indexOf("/api/") !== -1 || path.indexOf("/functions/") !== -1) {
    return false;
  }
  return true;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(PRECACHE);
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return (
                key.indexOf("ketang-shell-") === 0 && key !== CACHE_VERSION
              );
            })
            .map(function (key) {
              return caches.delete(key);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);
  if (!shouldHandleFetch(url, request)) return;

  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) {
            cache.put(request, copy);
          });
        }
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (cached) {
          if (cached) return cached;
          if (request.mode === "navigate") {
            return caches.match("./index.html");
          }
          var path = url.pathname.replace(/\/$/, "");
          if (path.endsWith(".js") || path.endsWith(".css")) {
            return caches.match(path.substring(path.lastIndexOf("/") + 1));
          }
          return undefined;
        });
      }),
  );
});
