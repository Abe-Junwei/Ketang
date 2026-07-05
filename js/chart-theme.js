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

function isKetangChartElementVisible(el) {
  if (!el || !el.isConnected || typeof document === "undefined") return false;
  var view = el.closest(".view");
  if (view && !view.classList.contains("active")) return false;
  var rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  var node = el.parentElement;
  while (node && node !== document.body) {
    var style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    node = node.parentElement;
  }
  return true;
}

function getKetangChartVisibilityElement(el) {
  if (el && el.__ketangEchartHost && el.__ketangEchartHost.isConnected) {
    return el.__ketangEchartHost;
  }
  return el;
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
  Object.keys(ketangChartDeferred).slice().forEach(function (key) {
    var pending = ketangChartDeferred[key];
    if (!pending) return;
    var el = resolveChartCanvas(pending.canvasOrId);
    if (!el || !root.contains(el)) return;
    // 视图已激活时直接 flush，避免 canvas 尚未布局时 rect 为 0 卡住延迟队列。
    if (root.classList.contains("active")) {
      flushDeferredKetangChart(key);
      return;
    }
    var visibleEl = getKetangChartVisibilityElement(el);
    if (isKetangChartElementVisible(visibleEl)) {
      flushDeferredKetangChart(key);
    }
  });
  Object.keys(ketangEcharts).forEach(function (key) {
    var meta = ketangEchartMeta[key];
    if (meta && meta.canvasEl && root.contains(meta.canvasEl)) {
      resizeKetangChart(key);
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

function resolveKetangEchartHost(canvasEl, key, mode) {
  if (!canvasEl) return null;
  if (canvasEl.tagName !== "CANVAS") return canvasEl;
  if (canvasEl.__ketangEchartHost && canvasEl.__ketangEchartHost.isConnected) {
    return canvasEl.__ketangEchartHost;
  }
  var host = document.createElement("div");
  host.className = "ketang-echart-host";
  if (mode === "ring") host.classList.add("ketang-echart-host--ring");
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
  host.style.flex = "1";
  host.style.minHeight = "0";
  host.style.width = "100%";
  canvasEl.style.display = "none";
  if (canvasEl.parentNode) {
    canvasEl.parentNode.insertBefore(host, canvasEl.nextSibling);
  }
  canvasEl.__ketangEchartHost = host;
  host.__ketangChartCanvas = canvasEl;
  return host;
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
  if (host && host.parentNode) host.parentNode.removeChild(host);
  canvasEl.style.display = "";
  delete canvasEl.__ketangEchartHost;
}

function resizeKetangChart(key) {
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
  connectKetangEchartsGroup(groupId);
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
    Object.keys(ketangEcharts).forEach(function (key) {
      resizeKetangChart(key);
    });
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
    },
    tooltip: {
      trigger: type === "bar" || type === "line" ? "axis" : "item",
      axisPointer: { type: "shadow" },
    },
    legend: chartJsLegendToEcharts(chartOpts, mode),
    color: getChartColors(Math.max(datasets.length, labels.length, 1)),
  };

  if (type === "pie" || type === "doughnut") {
    var first = datasets[0] || { data: [] };
    var cutout = parseCutoutPercent(
      chartOpts.cutout,
      mode === "ring" ? 76 : 50,
    );
    var radius =
      type === "doughnut"
        ? [cutout + "%", mode === "ring" ? "92%" : "78%"]
        : "72%";
    var segmentColors = Array.isArray(first.backgroundColor)
      ? first.backgroundColor
      : null;
    option.series = [
      {
        type: "pie",
        radius: radius,
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: getChartTheme().card,
          borderWidth: 2,
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
    left: 28,
    right: 16,
    top: 20,
    bottom: 36,
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
  var host = resolveKetangEchartHost(canvasEl, key, mode);
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
  host = resolveKetangEchartHost(canvasEl, key, mode);
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
  var visible = options.skipDefer || isKetangChartElementVisible(visibleEl);
  if (shouldUseKetangEchartsForKey(key)) {
    var echartHost =
      el.__ketangEchartHost && el.__ketangEchartHost.isConnected
        ? el.__ketangEchartHost
        : null;
    if (
      !visible &&
      !canReuseKetangEchart(key, echartHost, merged.type)
    ) {
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
      { display: true, position: "bottom" },
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
