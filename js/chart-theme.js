/* ============================================================
   Chart.js 主题与实例管理 | Ketang chart theme & registry
   宣纸墨韵 — 色值读取 CSS 变量，与 styles.css 一致
   ============================================================ */

var ketangCharts = {};
var ketangChartMeta = {};
var ketangEcharts = {};
var ketangEchartMeta = {};
var ketangChartUpdateQueue = {};
var ketangChartUpdateScheduled = false;
var ketangEchartUpdateQueue = {};
var ketangEchartUpdateScheduled = false;
var ketangChartEngineWarned = false;
var ketangChartDeferred = {};
var ketangChartDeferredObserver = null;
var ketangEchartLayoutRefreshQueue = {};
var ketangEchartLayoutRefreshScheduled = false;
var ketangEchartsConnectPending = {};
var ketangEchartsConnectScheduled = false;
var ketangEchartResizeTimers = {};
var ketangWindowResizeTimer = null;
var ketangChartPerf = {
  initCount: 0,
  updateCount: 0,
  destroyCount: 0,
  reuseCount: 0,
  deferCount: 0,
  flushCount: 0,
  lastInitMs: 0,
  lastUpdateMs: 0,
  totalInitMs: 0,
  totalUpdateMs: 0,
};

var KETANG_CHART_ENGINE_STORAGE_KEY = "ketang_chart_engine";

function ketangChartNow() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

function recordKetangChartPerf(kind, startMs) {
  var duration = Math.max(0, ketangChartNow() - startMs);
  if (kind === "init") {
    ketangChartPerf.initCount += 1;
    ketangChartPerf.lastInitMs = duration;
    ketangChartPerf.totalInitMs += duration;
    return;
  }
  if (kind === "update") {
    ketangChartPerf.updateCount += 1;
    ketangChartPerf.lastUpdateMs = duration;
    ketangChartPerf.totalUpdateMs += duration;
  }
}

function getKetangChartPerfSummary() {
  return Object.assign({}, ketangChartPerf);
}

function isKetangChartPresentationHidden(el) {
  if (!el || !el.isConnected || typeof document === "undefined") return true;
  var node = el;
  while (node && node !== document.body) {
    var style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return true;
    node = node.parentElement;
  }
  return false;
}

function isKetangChartElementVisible(el) {
  if (!el || !el.isConnected || typeof document === "undefined") return false;
  var view = el.closest(".view");
  if (view && !view.classList.contains("active")) return false;
  if (isKetangChartPresentationHidden(el)) return false;
  var rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return true;
}

function getKetangChartVisibilityElement(el) {
  if (el && el.__ketangEchartHost && el.__ketangEchartHost.isConnected) {
    return el.__ketangEchartHost;
  }
  return el;
}

function isKetangChartMountReady(el) {
  if (!el || !el.isConnected) return false;
  var view = el.closest(".view");
  if (view && !view.classList.contains("active")) return false;
  var sizedRoot = el.closest(
    ".chart-ring-wrap, .board-chart-body--bar, .board-cap-chart-wrap, .meals-meal-chart-body--pie, .forecast-chart-box, .report-chart-body",
  );
  if (sizedRoot) {
    var rect = sizedRoot.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    if (
      sizedRoot.classList.contains("chart-ring-wrap") &&
      (rect.width > 0 || sizedRoot.clientWidth > 0)
    ) {
      return true;
    }
  }
  return isKetangChartElementVisible(getKetangChartVisibilityElement(el));
}

function needsKetangEchartLayoutRefresh(host) {
  if (!host) return false;
  syncKetangEchartHostLayout(host);
  return host.offsetWidth <= 0 || host.offsetHeight <= 0;
}

function ketangEchartTooltipBase() {
  return {
    backgroundColor: hexToRgba(cssHex("--color-foreground", "#3d3028"), 0.92),
    borderWidth: 0,
    padding: [8, 12],
    textStyle: {
      color: cssHex("--color-apricot", "#fff8f0"),
      fontSize: 12,
    },
  };
}

function ensureKetangChartDeferredObserver() {
  if (
    ketangChartDeferredObserver ||
    typeof IntersectionObserver === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  ketangChartDeferredObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      Object.keys(ketangChartDeferred).some(function (key) {
        var pending = ketangChartDeferred[key];
        if (!pending) return false;
        var el = resolveChartCanvas(pending.canvasOrId);
        if (el !== entry.target) return false;
        flushDeferredKetangChart(key);
        return true;
      });
    });
  });
}

function observeDeferredKetangChart(key, el) {
  ensureKetangChartDeferredObserver();
  if (!ketangChartDeferredObserver || !el) return;
  el.dataset.ketangChartDeferredKey = key;
  ketangChartDeferredObserver.observe(el);
}

function unobserveDeferredKetangChart(el) {
  if (!ketangChartDeferredObserver || !el) return;
  ketangChartDeferredObserver.unobserve(el);
  delete el.dataset.ketangChartDeferredKey;
}

function deferKetangChart(key, canvasOrId, config, mode, prepare) {
  ketangChartDeferred[key] = {
    canvasOrId: canvasOrId,
    config: Object.assign({}, config || {}),
    mode: mode,
    prepare: prepare,
  };
  ketangChartPerf.deferCount += 1;
  var el = resolveChartCanvas(canvasOrId);
  if (el) observeDeferredKetangChart(key, el);
  return null;
}

function flushDeferredKetangChart(key) {
  var pending = ketangChartDeferred[key];
  if (!pending) return null;
  delete ketangChartDeferred[key];
  ketangChartPerf.flushCount += 1;
  var el = resolveChartCanvas(pending.canvasOrId);
  if (el) unobserveDeferredKetangChart(el);
  var chart = upsertKetangChart(
    key,
    pending.canvasOrId,
    pending.config,
    pending.mode,
    pending.prepare,
    { skipDefer: true },
  );
  resizeKetangChart(key);
  return chart;
}

function mountKetangChartsInRoot(root) {
  if (!root) return;
  var flushed = {};
  Object.keys(ketangChartDeferred).slice().forEach(function (key) {
    var pending = ketangChartDeferred[key];
    if (!pending) return;
    var el = resolveChartCanvas(pending.canvasOrId);
    if (!el || !root.contains(el)) return;
    if (isKetangChartPresentationHidden(el)) return;
    if (isKetangChartMountReady(el) || root.classList.contains("active")) {
      flushDeferredKetangChart(key);
      flushed[key] = true;
    }
  });
  Object.keys(ketangEcharts).forEach(function (key) {
    if (flushed[key]) return;
    var meta = ketangEchartMeta[key];
    if (meta && meta.canvasEl && root.contains(meta.canvasEl)) {
      scheduleKetangEchartLayoutRefresh(key);
    }
  });
}

function normalizeKetangChartEngine(engine) {
  return String(engine || "chartjs").toLowerCase() === "echarts"
    ? "echarts"
    : "chartjs";
}

function readKetangChartEnginePreference() {
  var fromUrl = null;
  try {
    if (typeof window !== "undefined" && window.location) {
      fromUrl = new URLSearchParams(window.location.search).get("chart_engine");
    }
  } catch (e) {
    /* ignore */
  }
  if (fromUrl) return normalizeKetangChartEngine(fromUrl);
  if (typeof window !== "undefined" && window.KETANG_CHART_ENGINE) {
    return normalizeKetangChartEngine(window.KETANG_CHART_ENGINE);
  }
  try {
    var stored = localStorage.getItem(KETANG_CHART_ENGINE_STORAGE_KEY);
    if (stored) return normalizeKetangChartEngine(stored);
  } catch (e) {
    /* ignore */
  }
  return "echarts";
}

function isKetangChartRuntimeReady() {
  return isKetangEchartsReady() || typeof Chart !== "undefined";
}

function setKetangChartEngine(engine, options) {
  var normalized = normalizeKetangChartEngine(engine);
  var persist = !(options && options.persist === false);
  if (typeof window !== "undefined") {
    window.KETANG_CHART_ENGINE = normalized;
  }
  if (persist) {
    try {
      localStorage.setItem(KETANG_CHART_ENGINE_STORAGE_KEY, normalized);
    } catch (e) {
      /* ignore */
    }
  }
  return normalized;
}

function isKetangEchartsReady() {
  return typeof echarts !== "undefined";
}

function resolveKetangChartEngine() {
  var requested = readKetangChartEnginePreference();
  if (requested === "echarts" && isKetangEchartsReady()) return "echarts";
  if (requested === "echarts" && !ketangChartEngineWarned) {
    ketangChartEngineWarned = true;
    console.warn(
      "ECharts 未就绪，已回退到 Chart.js | ECharts unavailable, fallback to Chart.js",
    );
  }
  return "chartjs";
}

function getKetangChartEngine() {
  return resolveKetangChartEngine();
}

function readKetangEchartsPilotKeys() {
  var keys = [];
  try {
    if (typeof window !== "undefined" && window.location) {
      var fromUrl = new URLSearchParams(window.location.search).get(
        "chart_pilot_keys",
      );
      if (fromUrl) {
        keys = fromUrl
          .split(",")
          .map(function (v) {
            return String(v || "").trim();
          })
          .filter(Boolean);
      }
    }
  } catch (e) {
    /* ignore */
  }
  if (!keys.length && typeof window !== "undefined") {
    var arr = window.KETANG_ECHARTS_PILOT_KEYS;
    if (Array.isArray(arr)) {
      keys = arr
        .map(function (v) {
          return String(v || "").trim();
        })
        .filter(Boolean);
    }
  }
  return keys;
}

function shouldUseKetangEchartsForKey(chartKey) {
  if (resolveKetangChartEngine() !== "echarts") return false;
  var pilots = readKetangEchartsPilotKeys();
  if (!pilots.length) return true;
  return pilots.indexOf(String(chartKey || "")) !== -1;
}

function destroyKetangChart(key) {
  if (ketangCharts[key]) {
    ketangCharts[key].destroy();
    delete ketangCharts[key];
    ketangChartPerf.destroyCount += 1;
  }
  if (ketangEcharts[key]) {
    ketangEcharts[key].dispose();
    delete ketangEcharts[key];
    ketangChartPerf.destroyCount += 1;
  }
  releaseKetangEchartHostByKey(key);
  if (ketangChartDeferred[key]) {
    var pendingEl = resolveChartCanvas(ketangChartDeferred[key].canvasOrId);
    if (pendingEl) unobserveDeferredKetangChart(pendingEl);
    delete ketangChartDeferred[key];
  }
  delete ketangChartMeta[key];
  delete ketangEchartMeta[key];
  delete ketangChartUpdateQueue[key];
  delete ketangEchartUpdateQueue[key];
}

function destroyKetangChartsByPrefix(prefix) {
  var keys = {};
  Object.keys(ketangCharts).forEach(function (k) {
    keys[k] = true;
  });
  Object.keys(ketangEcharts).forEach(function (k) {
    keys[k] = true;
  });
  Object.keys(ketangChartDeferred).forEach(function (k) {
    keys[k] = true;
  });
  Object.keys(keys).forEach(function (k) {
    if (k.indexOf(prefix) === 0) destroyKetangChart(k);
  });
}

function cssHex(name, fallback) {
  if (typeof document === "undefined") return fallback;
  var v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  hex = String(hex).replace("#", "");
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map(function (c) {
        return c + c;
      })
      .join("");
  }
  var r = parseInt(hex.slice(0, 2), 16);
  var g = parseInt(hex.slice(2, 4), 16);
  var b = parseInt(hex.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

/** Semantic colors aligned with 宣纸墨韵 tokens (from CSS variables) */
function getChartTheme() {
  return {
    primary: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.9),
    primarySoft: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.18),
    success: hexToRgba(cssHex("--color-success", "#4a6266"), 0.9),
    successSoft: hexToRgba(cssHex("--color-success", "#4a6266"), 0.18),
    warning: hexToRgba(cssHex("--color-warning", "#8a7340"), 0.88),
    warningSoft: hexToRgba(cssHex("--color-warning", "#8a7340"), 0.2),
    dai: hexToRgba(cssHex("--color-dai-light", "#4a6266"), 0.9),
    muted: hexToRgba(cssHex("--color-muted", "#6a5e52"), 0.55),
    foreground: hexToRgba(cssHex("--color-foreground", "#3d3028"), 0.35),
    male: hexToRgba(cssHex("--color-dai-light", "#4a6266"), 0.9),
    female: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.9),
    arrive: hexToRgba(cssHex("--color-success", "#4a6266"), 0.75),
    depart: hexToRgba(cssHex("--color-warning", "#8a7340"), 0.85),
    bf: hexToRgba(cssHex("--color-warning", "#8a7340"), 0.88),
    lc: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.88),
    dn: hexToRgba(cssHex("--color-dai-light", "#4a6266"), 0.88),
    capacity: hexToRgba(cssHex("--color-dai", "#3a4f52"), 0.92),
    capacityFemale: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.85),
    registered: hexToRgba(cssHex("--color-success", "#4a6266"), 0.88),
    gap: hexToRgba(cssHex("--color-surface", "#e3d9c6"), 0.95),
    flowIn: hexToRgba(cssHex("--color-success", "#4a6266"), 0.88),
    flowOut: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.88),
    card: cssHex("--color-card", "#fffcf7"),
    border: cssHex("--color-border", "#d4c9b4"),
    tick: cssHex("--color-muted", "#6a5e52"),
    grid: hexToRgba(cssHex("--color-border", "#d4c9b4"), 0.45),
  };
}

function getChartPalette() {
  var T = getChartTheme();
  return [
    T.primary,
    T.success,
    T.warning,
    T.dai,
    T.depart,
    T.muted,
    T.flowIn,
    T.lc,
  ];
}

function getChartColors(count) {
  var palette = getChartPalette();
  var colors = [];
  for (var i = 0; i < count; i++) colors.push(palette[i % palette.length]);
  return colors;
}

function applyKetangChartDefaults(options, mode) {
  var opts = options || {};
  var T = getChartTheme();
  opts.responsive = opts.responsive !== false;
  if (mode === "ring" || mode === "pie") {
    opts.maintainAspectRatio = true;
    opts.aspectRatio = 1;
    opts.layout = opts.layout || { padding: 2 };
  } else if (opts.maintainAspectRatio !== true) {
    opts.maintainAspectRatio = false;
  }
  if (!opts.plugins) opts.plugins = {};
  if (!opts.plugins.legend) opts.plugins.legend = {};
  if (!opts.plugins.legend.labels) opts.plugins.legend.labels = {};
  if (opts.plugins.legend.display !== false) {
    if (!opts.plugins.legend.labels.color)
      opts.plugins.legend.labels.color = T.tick;
    if (!opts.plugins.legend.labels.boxWidth)
      opts.plugins.legend.labels.boxWidth = 10;
    if (!opts.plugins.legend.labels.font)
      opts.plugins.legend.labels.font = { size: 11 };
    if (!opts.plugins.legend.labels.padding)
      opts.plugins.legend.labels.padding = 12;
  }
  if (mode !== "ring" && mode !== "pie" && !opts.scales) opts.scales = {};
  if (mode !== "ring" && mode !== "pie") {
    ["x", "y"].forEach(function (axis) {
      if (!opts.scales[axis]) opts.scales[axis] = {};
      if (!opts.scales[axis].ticks) opts.scales[axis].ticks = {};
      if (!opts.scales[axis].ticks.color)
        opts.scales[axis].ticks.color = T.tick;
      if (!opts.scales[axis].ticks.font)
        opts.scales[axis].ticks.font = { size: 11 };
      if (!opts.scales[axis].grid) opts.scales[axis].grid = {};
      if (
        opts.scales[axis].grid.display !== false &&
        !opts.scales[axis].grid.color
      ) {
        opts.scales[axis].grid.color = T.grid;
      }
      if (!opts.scales[axis].border) opts.scales[axis].border = {};
      if (!opts.scales[axis].border.color)
        opts.scales[axis].border.color = "transparent";
    });
  }
  return opts;
}

function styleRingDatasets(datasets) {
  var T = getChartTheme();
  datasets.forEach(function (ds) {
    if (ds.borderWidth == null) ds.borderWidth = 3;
    if (!ds.borderColor) ds.borderColor = T.card;
    if (ds.hoverOffset == null) ds.hoverOffset = 5;
  });
}

function resolveChartCanvas(canvasOrId) {
  return typeof canvasOrId === "string"
    ? document.getElementById(canvasOrId)
    : canvasOrId;
}

function resolveKetangEchartHost(canvasEl, key, mode, chartType) {
  if (!canvasEl) return null;
  if (canvasEl.tagName !== "CANVAS") return canvasEl;
  chartType = chartType || defaultChartTypeForMode(mode);
  if (canvasEl.__ketangEchartHost && canvasEl.__ketangEchartHost.isConnected) {
    return canvasEl.__ketangEchartHost;
  }
  var host = document.createElement("div");
  host.className = "ketang-echart-host";
  if (mode === "ring") host.classList.add("ketang-echart-host--ring");
  else if (mode === "pie" || chartType === "pie") {
    host.classList.add("ketang-echart-host--pie");
  } else if (chartType === "doughnut") {
    host.classList.add("ketang-echart-host--doughnut");
  }
  if (canvasEl.id) host.id = canvasEl.id + "-echart";
  host.setAttribute("data-ketang-chart-key", String(key || ""));
  if (canvasEl.getAttribute("role")) {
    host.setAttribute("role", canvasEl.getAttribute("role"));
  }
  if (canvasEl.getAttribute("aria-label")) {
    host.setAttribute("aria-label", canvasEl.getAttribute("aria-label"));
  }
  if (canvasEl.getAttribute("aria-describedby")) {
    host.setAttribute(
      "aria-describedby",
      canvasEl.getAttribute("aria-describedby"),
    );
  }
  host.style.width = "100%";
  if (mode === "ring") {
    host.style.position = "absolute";
    host.style.inset = "0";
    host.style.flex = "none";
  } else if (mode === "pie" || chartType === "pie") {
    host.style.flex = "none";
    host.style.maxHeight = "180px";
    host.style.aspectRatio = "1";
  } else if (chartType === "doughnut") {
    host.style.flex = "1";
    host.style.minHeight = "120px";
    host.style.maxHeight = "220px";
    host.style.aspectRatio = "1";
  } else {
    host.style.flex = "1";
    host.style.minHeight = "0";
  }
  canvasEl.style.display = "none";
  if (canvasEl.parentNode) {
    canvasEl.parentNode.insertBefore(host, canvasEl.nextSibling);
  }
  canvasEl.__ketangEchartHost = host;
  host.__ketangChartCanvas = canvasEl;
  syncKetangEchartHostLayout(host);
  return host;
}

/** 饼/环形容器在 flex 内 aspect-ratio 可能算不出高度，需显式同步 | Explicit pie/doughnut sizing in flex layouts */
function syncKetangEchartHostLayout(host) {
  if (!host) return;
  if (host.classList.contains("ketang-echart-host--ring")) {
    var wrap = host.closest(".chart-ring-wrap");
    var wrapRect = wrap ? wrap.getBoundingClientRect() : null;
    var ringSize = wrapRect
      ? Math.round(Math.min(wrapRect.width, wrapRect.height))
      : 0;
    if (ringSize <= 0 && wrap) {
      ringSize = Math.round(wrap.clientWidth || wrap.offsetWidth || 0);
    }
    if (ringSize <= 0) {
      if (!wrap || isKetangChartPresentationHidden(wrap)) return;
      ringSize = 132;
    }
    host.style.position = "absolute";
    host.style.left = "0";
    host.style.top = "0";
    host.style.width = ringSize + "px";
    host.style.height = ringSize + "px";
    host.style.flex = "none";
    return;
  }
  if (host.classList.contains("ketang-echart-host--pie")) {
    var pieMax = 180;
    var pieParent = host.parentElement;
    var pieParentW = pieParent ? pieParent.clientWidth : 0;
    var pieSize = pieParentW > 0 ? Math.min(pieMax, pieParentW) : pieMax;
    host.style.flex = "none";
    host.style.width = pieSize + "px";
    host.style.height = pieSize + "px";
    host.style.maxHeight = pieMax + "px";
    return;
  }
  if (host.classList.contains("ketang-echart-host--doughnut")) {
    var doughnutMax = 220;
    var doughnutMin = 120;
    var doughnutParent = host.parentElement;
    var doughnutParentW = doughnutParent ? doughnutParent.clientWidth : 0;
    var doughnutSize =
      doughnutParentW > 0
        ? Math.min(doughnutMax, Math.max(doughnutMin, doughnutParentW))
        : doughnutMax;
    host.style.width = doughnutSize + "px";
    host.style.height = doughnutSize + "px";
    host.style.maxHeight = doughnutMax + "px";
    return;
  }
  var barBody = host.closest(
    ".board-chart-body--bar, .board-cap-chart-wrap, .forecast-chart-box, .report-chart-body",
  );
  if (barBody) {
    var barRect = barBody.getBoundingClientRect();
    var barH = Math.round(barRect.height || barBody.clientHeight || 0);
    if (barH > 0) {
      host.style.flex = "1";
      host.style.minHeight = barH + "px";
      host.style.height = barH + "px";
      host.style.width = "100%";
    }
  }
}

function unobserveKetangEchartHost(host) {
  if (!host || !host.__ketangResizeObs) return;
  host.__ketangResizeObs.disconnect();
  delete host.__ketangResizeObs;
}

function observeKetangEchartHost(key, host) {
  if (!host || typeof ResizeObserver === "undefined") return;
  unobserveKetangEchartHost(host);
  var target =
    host.closest(
      ".chart-ring-wrap, .board-chart-body--bar, .board-chart-body, .board-cap-chart-wrap, .meals-meal-chart-body--pie, .forecast-chart-box, .report-chart-body",
    ) || host.parentElement;
  if (!target) return;
  var obs = new ResizeObserver(function () {
    if (!ketangEcharts[key]) return;
    if (ketangEchartResizeTimers[key]) {
      clearTimeout(ketangEchartResizeTimers[key]);
    }
    ketangEchartResizeTimers[key] = setTimeout(function () {
      if (!ketangEcharts[key]) return;
      syncKetangEchartHostLayout(host);
      ketangEcharts[key].resize();
    }, 80);
  });
  obs.observe(target);
  host.__ketangResizeObs = obs;
}

function scheduleKetangEchartLayoutRefresh(key) {
  if (!key) return;
  ketangEchartLayoutRefreshQueue[key] = true;
  if (ketangEchartLayoutRefreshScheduled) return;
  ketangEchartLayoutRefreshScheduled = true;
  var run = function () {
    ketangEchartLayoutRefreshScheduled = false;
    var keys = Object.keys(ketangEchartLayoutRefreshQueue);
    ketangEchartLayoutRefreshQueue = {};
    keys.forEach(function (queuedKey) {
      var meta = ketangEchartMeta[queuedKey];
      if (meta && meta.el) syncKetangEchartHostLayout(meta.el);
      resizeKetangChart(queuedKey);
    });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 16);
}

function scheduleKetangEchartsConnect(groupId) {
  if (!groupId) return;
  ketangEchartsConnectPending[groupId] = true;
  if (ketangEchartsConnectScheduled) return;
  ketangEchartsConnectScheduled = true;
  var run = function () {
    ketangEchartsConnectScheduled = false;
    var groups = Object.keys(ketangEchartsConnectPending);
    ketangEchartsConnectPending = {};
    groups.forEach(function (gid) {
      connectKetangEchartsGroup(gid);
    });
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(run);
    return;
  }
  setTimeout(run, 0);
}

function releaseKetangEchartHostByKey(key) {
  var meta = ketangEchartMeta[key];
  if (meta && meta.canvasEl) {
    releaseKetangEchartHost(meta.canvasEl);
    return;
  }
  var canvasMeta = ketangChartMeta[key];
  if (canvasMeta && canvasMeta.el) {
    releaseKetangEchartHost(canvasMeta.el);
  }
}

function releaseKetangEchartHost(canvasEl) {
  if (!canvasEl) return;
  var host = canvasEl.__ketangEchartHost;
  if (host) unobserveKetangEchartHost(host);
  if (host && host.parentNode) host.parentNode.removeChild(host);
  canvasEl.style.display = "";
  delete canvasEl.__ketangEchartHost;
}

function resizeKetangChart(key) {
  var meta = ketangEchartMeta[key];
  if (meta && meta.el) syncKetangEchartHostLayout(meta.el);
  if (ketangEcharts[key] && typeof ketangEcharts[key].resize === "function") {
    ketangEcharts[key].resize();
  }
}

function canReuseKetangChart(key, el, type) {
  var chart = ketangCharts[key];
  var meta = ketangChartMeta[key];
  return !!(
    chart &&
    meta &&
    meta.el === el &&
    meta.type === type &&
    chart.canvas === el &&
    el.isConnected &&
    typeof el.getContext === "function"
  );
}

function applyKetangChartUpdate(chart, next) {
  var nextData = next.data || {};
  chart.data.labels = nextData.labels || [];
  chart.data.datasets = nextData.datasets || [];
  Object.keys(nextData).forEach(function (key) {
    if (key === "labels" || key === "datasets") return;
    chart.data[key] = nextData[key];
  });
  Object.assign(chart.options, next.options || {});
}

function scheduleKetangChartUpdate(key, merged) {
  ketangChartUpdateQueue[key] = merged;
  if (ketangChartUpdateScheduled) return;
  ketangChartUpdateScheduled = true;
  var schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : function (fn) {
          return setTimeout(fn, 0);
        };
  schedule(function () {
    var queue = ketangChartUpdateQueue;
    ketangChartUpdateQueue = {};
    ketangChartUpdateScheduled = false;
    Object.keys(queue).forEach(function (queuedKey) {
      try {
        var chart = ketangCharts[queuedKey];
        var next = queue[queuedKey];
        if (!chart || !next) return;
        // 同帧只应用最后一次更新，减少同步刷新抖动 | Apply only the last same-frame update to reduce refresh jank.
        var updateStart = ketangChartNow();
        applyKetangChartUpdate(chart, next);
        chart.update("none");
        recordKetangChartPerf("update", updateStart);
      } catch (err) {
        console.error("图表更新失败 | Chart update failed:", queuedKey, err);
      }
    });
  });
}

function scheduleKetangEchartUpdate(key, chart, option) {
  ketangEchartUpdateQueue[key] = { chart: chart, option: option };
  if (ketangEchartUpdateScheduled) return;
  ketangEchartUpdateScheduled = true;
  var schedule =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : function (fn) {
          return setTimeout(fn, 0);
        };
  schedule(function () {
    var queue = ketangEchartUpdateQueue;
    ketangEchartUpdateQueue = {};
    ketangEchartUpdateScheduled = false;
    Object.keys(queue).forEach(function (queuedKey) {
      try {
        var item = queue[queuedKey];
        if (!item || ketangEcharts[queuedKey] !== item.chart) return;
        // 与 Chart.js 保持同帧合并语义 | Keep ECharts updates coalesced with Chart.js.
        var updateStart = ketangChartNow();
        var updateMeta = ketangEchartMeta[queuedKey];
        if (updateMeta && updateMeta.el) {
          syncKetangEchartHostLayout(updateMeta.el);
        }
        item.chart.setOption(item.option, true, true);
        item.chart.resize();
        recordKetangChartPerf("update", updateStart);
      } catch (err) {
        console.error("图表更新失败 | Chart update failed:", queuedKey, err);
      }
    });
  });
}

function defaultChartTypeForMode(mode) {
  if (mode === "ring") return "doughnut";
  if (mode === "pie") return "pie";
  return "bar";
}

function chartJsDatasetColor(ds, idx) {
  if (!ds) return null;
  if (Array.isArray(ds.backgroundColor)) {
    return ds.backgroundColor[idx] || ds.backgroundColor[0] || null;
  }
  return ds.backgroundColor || ds.borderColor || null;
}

function parseCutoutPercent(cutout, fallback) {
  if (cutout == null) return fallback;
  var n = parseFloat(String(cutout).replace("%", ""));
  return isNaN(n) ? fallback : n;
}

function chartJsLegendToEcharts(chartOpts, mode) {
  var legend = (chartOpts && chartOpts.plugins && chartOpts.plugins.legend) || {};
  if (legend.display === false || mode === "ring") {
    return { show: false };
  }
  var result = {
    show: true,
    textStyle: { color: cssHex("--color-muted", "#6a5e52") },
  };
  var pos = legend.position || "bottom";
  if (pos === "right") {
    result.orient = "vertical";
    result.right = 0;
    result.top = "middle";
  } else if (pos === "top") {
    result.top = 0;
  } else {
    result.bottom = 0;
  }
  return result;
}

function applyKetangEchartsDataZoom(option, labels, threshold, isHorizontal) {
  threshold = threshold || 10;
  if (!labels || labels.length <= threshold) return;
  var sliderBase = {
    type: "slider",
    borderColor: "transparent",
    fillerColor: hexToRgba(cssHex("--color-primary", "#a64b3f"), 0.15),
  };
  if (isHorizontal) {
    option.dataZoom = [
      { type: "inside", yAxisIndex: 0 },
      Object.assign({}, sliderBase, {
        yAxisIndex: 0,
        width: 14,
        right: 2,
      }),
    ];
    option.grid = option.grid || {};
    option.grid.right = (option.grid.right || 16) + 22;
    return;
  }
  option.dataZoom = [
    { type: "inside", xAxisIndex: 0 },
    Object.assign({}, sliderBase, {
      xAxisIndex: 0,
      height: 14,
      bottom: 2,
    }),
  ];
  option.grid = option.grid || {};
  option.grid.bottom = (option.grid.bottom || 36) + 22;
}

function chartJsBarSeriesData(ds, isHorizontal) {
  var values = ds.data || [];
  if (
    Array.isArray(ds.backgroundColor) &&
    ds.backgroundColor.length === values.length
  ) {
    return values.map(function (v, idx) {
      return {
        value: Number(v || 0),
        itemStyle: {
          color: ds.backgroundColor[idx],
          borderRadius: isHorizontal ? [0, 6, 6, 0] : 6,
        },
      };
    });
  }
  return values.map(function (v) {
    return Number(v || 0);
  });
}

function getKetangEchartsGroupId(key) {
  if (String(key || "").indexOf("board-") === 0) return "ketang-board";
  if (String(key || "").indexOf("report-") === 0) return "ketang-report";
  if (String(key || "").indexOf("forecast-") === 0) return "ketang-forecast";
  return null;
}

function connectKetangEchartsGroup(groupId) {
  if (!groupId || typeof echarts === "undefined" || !echarts.connect) return;
  echarts.connect(groupId);
}

function assignKetangEchartsGroup(chart, groupId) {
  if (!chart || !groupId) return;
  chart.group = groupId;
  scheduleKetangEchartsConnect(groupId);
}

function ensureKetangChartResizeListener() {
  if (
    ensureKetangChartResizeListener._ready ||
    typeof window === "undefined"
  ) {
    return;
  }
  ensureKetangChartResizeListener._ready = true;
  window.addEventListener("resize", function () {
    if (ketangWindowResizeTimer) clearTimeout(ketangWindowResizeTimer);
    ketangWindowResizeTimer = setTimeout(function () {
      Object.keys(ketangEcharts).forEach(function (key) {
        resizeKetangChart(key);
      });
    }, 120);
  });
}

function chartJsConfigToEchartsOption(merged, mode) {
  var type = merged.type || defaultChartTypeForMode(mode);
  var data = merged.data || {};
  var labels = data.labels || [];
  var datasets = data.datasets || [];
  var chartOpts = merged.options || {};
  var indexAxis = chartOpts.indexAxis || "x";
  var isHorizontal = indexAxis === "y";
  var scales = chartOpts.scales || {};
  var stacked =
    !!(scales.x && scales.x.stacked) ||
    !!(scales.y && scales.y.stacked) ||
    datasets.some(function (ds) {
      return !!ds.stack;
    });
  var axisStyle = {
    axisLine: { lineStyle: { color: "transparent" } },
    axisTick: { show: false },
    axisLabel: { color: cssHex("--color-muted", "#6a5e52") },
  };
  var valueAxisStyle = {
    type: "value",
    splitLine: {
      lineStyle: {
        color: hexToRgba(cssHex("--color-border", "#d4c9b4"), 0.45),
      },
    },
    axisLabel: { color: cssHex("--color-muted", "#6a5e52") },
  };
  var option = {
    animation: false,
    textStyle: {
      color: cssHex("--color-muted", "#6a5e52"),
      fontSize: 11,
    },
    tooltip: Object.assign(
      {
        trigger: type === "bar" || type === "line" ? "axis" : "item",
        axisPointer: { type: "shadow" },
      },
      ketangEchartTooltipBase(),
    ),
    legend: chartJsLegendToEcharts(chartOpts, mode),
    color: getChartColors(Math.max(datasets.length, labels.length, 1)),
  };

  if (type === "pie" || type === "doughnut") {
    var first = datasets[0] || { data: [] };
    var cutout = parseCutoutPercent(
      chartOpts.cutout,
      mode === "ring" ? 76 : 50,
    );
    var legendCfg = chartJsLegendToEcharts(chartOpts, mode);
    option.legend = legendCfg;
    var center = ["50%", "50%"];
    if (legendCfg.show && legendCfg.right != null) {
      center = ["38%", "50%"];
    } else if (legendCfg.show && legendCfg.bottom === 0) {
      center = ["50%", "44%"];
    }
    var radius =
      type === "doughnut"
        ? [cutout + "%", mode === "ring" ? "92%" : "78%"]
        : ["0%", "68%"];
    if (mode === "pie" && !legendCfg.show) {
      radius = ["0%", "72%"];
    }
    var pieBorderRadius = mode === "ring" ? 4 : 5;
    var segmentColors = Array.isArray(first.backgroundColor)
      ? first.backgroundColor
      : null;
    option.series = [
      {
        type: "pie",
        center: center,
        radius: radius,
        minAngle: 4,
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 6,
          label: { show: false },
        },
        itemStyle: {
          borderRadius: pieBorderRadius,
          borderColor: getChartTheme().card,
          borderWidth: mode === "ring" ? 2 : 1,
        },
        data: labels.map(function (label, idx) {
          var item = {
            name: label,
            value: Number(first.data[idx] || 0),
          };
          if (segmentColors && segmentColors[idx]) {
            item.itemStyle = Object.assign({}, item.itemStyle || {}, {
              color: segmentColors[idx],
            });
          }
          return item;
        }),
      },
    ];
    return option;
  }

  option.grid = {
    left: 24,
    right: 12,
    top: 16,
    bottom: 32,
    containLabel: true,
  };
  if (isHorizontal) {
    option.yAxis = Object.assign({ type: "category", data: labels }, axisStyle);
    option.xAxis = valueAxisStyle;
  } else {
    option.xAxis = Object.assign({ type: "category", data: labels }, axisStyle);
    option.yAxis = valueAxisStyle;
  }

  var hasLineSeries = datasets.some(function (ds) {
    return (ds.type || type) === "line";
  });

  if (type === "line" && !hasLineSeries) {
    hasLineSeries = true;
  }

  if (hasLineSeries) {
    option.series = datasets.map(function (ds, idx) {
      var dsType = ds.type || type;
      if (dsType === "line") {
        return {
          type: "line",
          name: ds.label || "",
          data: (ds.data || []).map(function (v) {
            return Number(v || 0);
          }),
          smooth: ds.tension ? true : false,
          showSymbol: ds.pointRadius !== 0,
          lineStyle: {
            color: ds.borderColor || chartJsDatasetColor(ds, idx),
            type: ds.borderDash ? "dashed" : "solid",
            width: ds.borderWidth || 2,
          },
          itemStyle: {
            color: ds.borderColor || chartJsDatasetColor(ds, idx),
          },
          areaStyle: ds.fill
            ? {
                color: ds.backgroundColor || chartJsDatasetColor(ds, idx),
                opacity: 0.18,
              }
            : undefined,
          z: 2,
        };
      }
      var barSeries = {
        type: "bar",
        name: ds.label || "",
        data: chartJsBarSeriesData(ds, isHorizontal),
        barMaxWidth: ds.maxBarThickness || 44,
        barCategoryGap: "32%",
        itemStyle: {
          borderRadius: isHorizontal ? [0, 6, 6, 0] : 6,
          color: chartJsDatasetColor(ds, idx) || undefined,
        },
        z: 1,
      };
      if (stacked || ds.stack) barSeries.stack = String(ds.stack || "total");
      return barSeries;
    });
    applyKetangEchartsDataZoom(option, labels, 8, isHorizontal);
    return option;
  }

  option.series = datasets.map(function (ds, idx) {
    var series = {
      type: "bar",
      name: ds.label || "",
      data: chartJsBarSeriesData(ds, isHorizontal),
      barMaxWidth: ds.maxBarThickness || 44,
      barCategoryGap: "32%",
      itemStyle: {
        borderRadius: isHorizontal ? [0, 6, 6, 0] : 6,
        color: chartJsDatasetColor(ds, idx) || undefined,
      },
    };
    if (stacked || ds.stack) series.stack = String(ds.stack || "total");
    return series;
  });
  applyKetangEchartsDataZoom(option, labels, 12, isHorizontal);
  return option;
}

function canReuseKetangEchart(key, el, type) {
  var chart = ketangEcharts[key];
  var meta = ketangEchartMeta[key];
  return !!(
    chart &&
    meta &&
    meta.el === el &&
    meta.type === type &&
    el.isConnected
  );
}

function upsertKetangEchart(key, canvasEl, merged, mode) {
  var type = merged.type || defaultChartTypeForMode(mode);
  var host = resolveKetangEchartHost(canvasEl, key, mode, type);
  if (!host) return null;
  var option = chartJsConfigToEchartsOption(merged, mode);
  if (canReuseKetangEchart(key, host, type)) {
    var existingGroupId = getKetangEchartsGroupId(key);
    assignKetangEchartsGroup(ketangEcharts[key], existingGroupId);
    ketangChartPerf.reuseCount += 1;
    scheduleKetangEchartUpdate(key, ketangEcharts[key], option);
    return ketangEcharts[key];
  }
  destroyKetangChart(key);
  host = resolveKetangEchartHost(canvasEl, key, mode, type);
  syncKetangEchartHostLayout(host);
  var groupId = getKetangEchartsGroupId(key);
  var initStart = ketangChartNow();
  ensureKetangChartResizeListener();
  var chart = echarts.init(
    host,
    null,
    groupId ? { group: groupId } : undefined,
  );
  chart.setOption(option, true, true);
  chart.resize();
  assignKetangEchartsGroup(chart, groupId);
  observeKetangEchartHost(key, host);
  if (needsKetangEchartLayoutRefresh(host)) {
    scheduleKetangEchartLayoutRefresh(key);
  }
  recordKetangChartPerf("init", initStart);
  ketangEcharts[key] = chart;
  ketangEchartMeta[key] = { el: host, canvasEl: canvasEl, type: type };
  return chart;
}

function upsertKetangChart(key, canvasOrId, config, mode, prepare, options) {
  options = options || {};
  var el = resolveChartCanvas(canvasOrId);
  if (!el) return null;
  var merged = Object.assign({}, config || {});
  if (typeof prepare === "function") prepare(merged);
  merged.type = merged.type || defaultChartTypeForMode(mode);
  merged.options = applyKetangChartDefaults(merged.options || {}, mode);
  var visibleEl = getKetangChartVisibilityElement(el);
  var presentationHidden = isKetangChartPresentationHidden(el);
  var visible =
    options.skipDefer ||
    (!presentationHidden &&
      (isKetangChartMountReady(el) || isKetangChartElementVisible(visibleEl)));
  if (shouldUseKetangEchartsForKey(key)) {
    var echartHost =
      el.__ketangEchartHost && el.__ketangEchartHost.isConnected
        ? el.__ketangEchartHost
        : null;
    if (!visible) {
      return deferKetangChart(key, canvasOrId, config, mode, prepare);
    }
    delete ketangChartDeferred[key];
    unobserveDeferredKetangChart(el);
    return upsertKetangEchart(key, el, merged, mode);
  }
  releaseKetangEchartHost(el);
  if (!isKetangChartRuntimeReady()) return null;
  var type = merged.type;
  if (canReuseKetangChart(key, el, type)) {
    delete ketangChartDeferred[key];
    unobserveDeferredKetangChart(el);
    ketangChartPerf.reuseCount += 1;
    scheduleKetangChartUpdate(key, merged);
    return ketangCharts[key];
  }
  if (!visible) {
    return deferKetangChart(key, canvasOrId, config, mode, prepare);
  }
  delete ketangChartDeferred[key];
  unobserveDeferredKetangChart(el);
  destroyKetangChart(key);
  var initStart = ketangChartNow();
  ketangCharts[key] = new Chart(el, merged);
  recordKetangChartPerf("init", initStart);
  ketangChartMeta[key] = { el: el, type: type };
  return ketangCharts[key];
}

function createKetangChart(key, canvasOrId, config) {
  return upsertKetangChart(key, canvasOrId, config, "bar");
}

/** 正圆环形图 — 须放在 .chart-ring-wrap 内，配合 HTML 中心文案 */
function createKetangRingChart(key, canvasOrId, config) {
  return upsertKetangChart(key, canvasOrId, config, "ring", function (merged) {
    if (merged.data && merged.data.datasets)
      styleRingDatasets(merged.data.datasets);
    var opts = merged.options || {};
    opts.cutout = opts.cutout || "76%";
    opts.plugins = opts.plugins || {};
    opts.plugins.legend = Object.assign(
      { display: false },
      opts.plugins.legend || {},
    );
    opts.plugins.tooltip = Object.assign(
      {
        backgroundColor: hexToRgba(
          cssHex("--color-foreground", "#3d3028"),
          0.92,
        ),
        titleColor: cssHex("--color-apricot", "#fff8f0"),
        bodyColor: cssHex("--color-apricot", "#fff8f0"),
        padding: 10,
        cornerRadius: 6,
      },
      opts.plugins.tooltip || {},
    );
    merged.options = opts;
  });
}

/** 饼图 — 按身份等分类，图例在下方 */
function createKetangPieChart(key, canvasOrId, config) {
  return upsertKetangChart(key, canvasOrId, config, "pie", function (merged) {
    if (merged.data && merged.data.datasets)
      styleRingDatasets(merged.data.datasets);
    var opts = merged.options || {};
    opts.plugins = opts.plugins || {};
    opts.plugins.legend = Object.assign(
      { display: false, position: "bottom" },
      opts.plugins.legend || {},
    );
    opts.plugins.tooltip = Object.assign(
      {
        backgroundColor: hexToRgba(
          cssHex("--color-foreground", "#3d3028"),
          0.92,
        ),
        titleColor: cssHex("--color-apricot", "#fff8f0"),
        bodyColor: cssHex("--color-apricot", "#fff8f0"),
        padding: 10,
        cornerRadius: 6,
      },
      opts.plugins.tooltip || {},
    );
    merged.options = opts;
  });
}

function chartLegendHtml(items) {
  return items
    .map(function (item) {
      return (
        '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:' +
        escapeHtml(item.color) +
        '"></span>' +
        escapeHtml(item.label) +
        " <strong>" +
        escapeHtml(String(item.value)) +
        "</strong></span>"
      );
    })
    .join("");
}

function chartBoxHtml(title, canvasId, wide) {
  var cls = wide ? "forecast-chart-box wide" : "forecast-chart-box";
  return (
    '<div class="' +
    cls +
    '"><h4>' +
    escapeHtml(title) +
    '</h4><canvas id="' +
    canvasId +
    '"></canvas></div>'
  );
}
