/* Phase G-1 RUM | Real User Monitoring — sampled perf reports (no PII) */

var PERF_RUM_SAMPLE_RATE = 0.1;
var _perfRumSampleHit = false;
var _perfRumLongTaskMax = 0;
var _perfRumSent = false;
var _perfRumObserving = false;

var PERF_RUM_MEASURE_NAMES = [
  "first-view-ready",
  "login-ready",
  "login",
  "read:board",
  "rc:bootstrap",
  "rc:deferred",
  "write-refresh",
  "render-board",
  "render-rooms",
  "render-all",
  "app-ready",
];

function perfRumMetricKey(name) {
  return String(name || "")
    .replace(/^ketang:/, "")
    .replace(/:/g, "_")
    .concat("_ms");
}

/** ?rum=1 或已登录 admin | Force sample (URL flag or logged-in admin) */
function perfRumForceSample() {
  try {
    var params = new URLSearchParams(location.search);
    if (params.get("rum") === "1") return true;
  } catch (e) {
    /* ignore */
  }
  if (typeof isAdmin === "function" && isAdmin()) return true;
  return false;
}

/** 是否应上报：10% 抽签或 force | Report if random hit or force */
function perfRumShouldReport() {
  return _perfRumSampleHit || perfRumForceSample();
}

function perfRumActivePage() {
  var active = document.querySelector(".sidebar-nav-btn.active");
  if (active && active.dataset && active.dataset.view) return active.dataset.view;
  return "board";
}

function perfRumCurrentRole() {
  if (typeof getCurrentUser === "function") {
    var user = getCurrentUser();
    if (user && user.role) return user.role;
  }
  return null;
}

function perfRumAppVersion() {
  var meta = document.querySelector('meta[name="ketang-app-version"]');
  return (meta && meta.getAttribute("content")) || "unknown";
}

function perfRumCollectMeasures() {
  var metrics = {};
  PERF_RUM_MEASURE_NAMES.forEach(function (name) {
    var measureName = "ketang:" + name;
    var entries = performance.getEntriesByName(measureName, "measure");
    if (entries.length) {
      metrics[perfRumMetricKey(name)] = Math.round(
        entries[entries.length - 1].duration || 0,
      );
    }
  });
  if (_perfRumLongTaskMax > 0) {
    metrics.long_task_max_ms = _perfRumLongTaskMax;
  }
  var paints = performance.getEntriesByType("paint");
  paints.forEach(function (entry) {
    if (entry.name === "first-contentful-paint") {
      metrics.fcp_ms = Math.round(entry.startTime);
    }
  });
  var lcpEntries = performance.getEntriesByType("largest-contentful-paint");
  if (lcpEntries.length) {
    metrics.lcp_ms = Math.round(lcpEntries[lcpEntries.length - 1].startTime);
  }
  var nav = performance.getEntriesByType("navigation")[0];
  if (nav) {
    metrics.dom_content_loaded_ms = Math.round(
      nav.domContentLoadedEventEnd - nav.startTime,
    );
    metrics.load_event_ms = Math.round(nav.loadEventEnd - nav.startTime);
  }
  return metrics;
}

function perfRumCollectNetwork() {
  var conn =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  if (!conn) return null;
  return {
    effectiveType: conn.effectiveType || null,
    rtt: conn.rtt != null ? conn.rtt : null,
    downlink: conn.downlink != null ? conn.downlink : null,
    saveData: !!conn.saveData,
  };
}

function perfRumCollectResources() {
  if (!performance.getEntriesByType) return [];
  return performance
    .getEntriesByType("resource")
    .filter(function (entry) {
      return entry.name && entry.name.indexOf("/api/v1/") !== -1;
    })
    .slice(-25)
    .map(function (entry) {
      var path = entry.name;
      try {
        path = new URL(entry.name).pathname + (new URL(entry.name).search || "");
      } catch (e) {
        path = String(entry.name).replace(location.origin, "");
      }
      return {
        name: path.slice(0, 200),
        duration_ms: Math.round(entry.duration || 0),
        transfer_size: entry.transferSize || 0,
        ttfb_ms: Math.round((entry.responseStart || 0) - (entry.startTime || 0)),
        download_ms: Math.round(
          (entry.responseEnd || 0) - (entry.responseStart || 0),
        ),
      };
    });
}

function perfRumBuildPayload(reason) {
  var metrics = perfRumCollectMeasures();
  if (!Object.keys(metrics).length) return null;
  return {
    kind: "perf",
    reason: reason || "report",
    page: perfRumActivePage(),
    role: perfRumCurrentRole(),
    appVersion: perfRumAppVersion(),
    metrics: metrics,
    network: perfRumCollectNetwork(),
    resources: perfRumCollectResources(),
  };
}

function perfRumSend(reason) {
  if (!perfRumShouldReport() || _perfRumSent) return;
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  var payload = perfRumBuildPayload(reason);
  if (!payload) return;
  _perfRumSent = true;
  var body = JSON.stringify(payload);
  var url = "/api/v1/metrics/perf";
  try {
    if (navigator.sendBeacon) {
      var blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
  } catch (e) {
    /* fallback fetch */
  }
  try {
    fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body,
      keepalive: true,
    }).catch(function () {
      /* non-fatal */
    });
  } catch (e) {
    /* ignore */
  }
}

function perfRumEnsureObservers() {
  if (_perfRumObserving || typeof PerformanceObserver === "undefined") return;
  _perfRumObserving = true;
  try {
    var obs = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (entry) {
        var ms = Math.round(entry.duration || 0);
        if (ms > _perfRumLongTaskMax) _perfRumLongTaskMax = ms;
      });
    });
    obs.observe({ type: "longtask", buffered: true });
  } catch (e) {
    /* longtask not supported */
  }
  try {
    var lcpObs = new PerformanceObserver(function (list) {
      list.getEntries();
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
  } catch (e) {
    /* ignore */
  }
}

function perfRumInit() {
  if (typeof performance === "undefined") return;
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) return;
  _perfRumSampleHit = Math.random() < PERF_RUM_SAMPLE_RATE;
  perfRumEnsureObservers();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") perfRumSend("visibility");
  });
}

function perfRumOnLoginReady() {
  if (!perfRumShouldReport()) return;
  setTimeout(function () {
    perfRumSend("login-ready");
  }, 250);
}

/** @deprecated use perfRumOnLoginReady after login-ready measure */
function perfRumOnFirstViewReady() {
  perfRumOnLoginReady();
}
