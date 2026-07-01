/* ============================================================
   Chart.js 主题与实例管理 | Ketang chart theme & registry
   宣纸墨韵 — 色值读取 CSS 变量，与 styles.css 一致
   ============================================================ */

var ketangCharts = {};

function destroyKetangChart(key) {
  if (ketangCharts[key]) {
    ketangCharts[key].destroy();
    delete ketangCharts[key];
  }
}

function destroyKetangChartsByPrefix(prefix) {
  Object.keys(ketangCharts).forEach(function (k) {
    if (k.indexOf(prefix) === 0) destroyKetangChart(k);
  });
}

function cssHex(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgba(hex, alpha) {
  hex = String(hex).replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map(function (c) { return c + c; }).join('');
  }
  var r = parseInt(hex.slice(0, 2), 16);
  var g = parseInt(hex.slice(2, 4), 16);
  var b = parseInt(hex.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

/** Semantic colors aligned with 宣纸墨韵 tokens (from CSS variables) */
function getChartTheme() {
  return {
    primary: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.9),
    primarySoft: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.18),
    success: hexToRgba(cssHex('--color-success', '#4a6266'), 0.9),
    successSoft: hexToRgba(cssHex('--color-success', '#4a6266'), 0.18),
    warning: hexToRgba(cssHex('--color-warning', '#8a7340'), 0.88),
    warningSoft: hexToRgba(cssHex('--color-warning', '#8a7340'), 0.2),
    dai: hexToRgba(cssHex('--color-dai-light', '#4a6266'), 0.9),
    muted: hexToRgba(cssHex('--color-muted', '#6a5e52'), 0.55),
    foreground: hexToRgba(cssHex('--color-foreground', '#3d3028'), 0.35),
    male: hexToRgba(cssHex('--color-dai-light', '#4a6266'), 0.9),
    female: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.9),
    arrive: hexToRgba(cssHex('--color-success', '#4a6266'), 0.75),
    depart: hexToRgba(cssHex('--color-warning', '#8a7340'), 0.85),
    bf: hexToRgba(cssHex('--color-warning', '#8a7340'), 0.88),
    lc: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.88),
    dn: hexToRgba(cssHex('--color-dai-light', '#4a6266'), 0.88),
    capacity: hexToRgba(cssHex('--color-dai', '#3a4f52'), 0.92),
    capacityFemale: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.85),
    registered: hexToRgba(cssHex('--color-success', '#4a6266'), 0.88),
    gap: hexToRgba(cssHex('--color-surface', '#e3d9c6'), 0.95),
    flowIn: hexToRgba(cssHex('--color-success', '#4a6266'), 0.88),
    flowOut: hexToRgba(cssHex('--color-primary', '#a64b3f'), 0.88),
    card: cssHex('--color-card', '#fffcf7'),
    border: cssHex('--color-border', '#d4c9b4'),
    tick: cssHex('--color-muted', '#6a5e52'),
    grid: hexToRgba(cssHex('--color-border', '#d4c9b4'), 0.45)
  };
}

function getChartPalette() {
  var T = getChartTheme();
  return [T.primary, T.success, T.warning, T.dai, T.depart, T.muted, T.flowIn, T.lc];
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
  if (mode === 'ring' || mode === 'pie') {
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
    if (!opts.plugins.legend.labels.color) opts.plugins.legend.labels.color = T.tick;
    if (!opts.plugins.legend.labels.boxWidth) opts.plugins.legend.labels.boxWidth = 10;
    if (!opts.plugins.legend.labels.font) opts.plugins.legend.labels.font = { size: 11 };
    if (!opts.plugins.legend.labels.padding) opts.plugins.legend.labels.padding = 12;
  }
  if (mode !== 'ring' && mode !== 'pie' && !opts.scales) opts.scales = {};
  if (mode !== 'ring' && mode !== 'pie') {
    ['x', 'y'].forEach(function (axis) {
      if (!opts.scales[axis]) opts.scales[axis] = {};
      if (!opts.scales[axis].ticks) opts.scales[axis].ticks = {};
      if (!opts.scales[axis].ticks.color) opts.scales[axis].ticks.color = T.tick;
      if (!opts.scales[axis].ticks.font) opts.scales[axis].ticks.font = { size: 11 };
      if (!opts.scales[axis].grid) opts.scales[axis].grid = {};
      if (opts.scales[axis].grid.display !== false && !opts.scales[axis].grid.color) {
        opts.scales[axis].grid.color = T.grid;
      }
      if (!opts.scales[axis].border) opts.scales[axis].border = {};
      if (!opts.scales[axis].border.color) opts.scales[axis].border.color = 'transparent';
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

function createKetangChart(key, canvasOrId, config) {
  if (typeof Chart === 'undefined') return null;
  var el = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!el) return null;
  destroyKetangChart(key);
  var merged = Object.assign({}, config);
  merged.options = applyKetangChartDefaults(config.options || {}, 'bar');
  ketangCharts[key] = new Chart(el, merged);
  return ketangCharts[key];
}

/** 正圆环形图 — 须放在 .chart-ring-wrap 内，配合 HTML 中心文案 */
function createKetangRingChart(key, canvasOrId, config) {
  if (typeof Chart === 'undefined') return null;
  var el = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!el) return null;
  destroyKetangChart(key);
  var merged = Object.assign({}, config);
  if (merged.data && merged.data.datasets) styleRingDatasets(merged.data.datasets);
  var opts = config.options || {};
  opts.cutout = opts.cutout || '76%';
  opts.plugins = opts.plugins || {};
  opts.plugins.legend = Object.assign({ display: false }, opts.plugins.legend || {});
  opts.plugins.tooltip = Object.assign({
    backgroundColor: hexToRgba(cssHex('--color-foreground', '#3d3028'), 0.92),
    titleColor: cssHex('--color-apricot', '#fff8f0'),
    bodyColor: cssHex('--color-apricot', '#fff8f0'),
    padding: 10,
    cornerRadius: 6
  }, opts.plugins.tooltip || {});
  merged.options = applyKetangChartDefaults(opts, 'ring');
  ketangCharts[key] = new Chart(el, merged);
  return ketangCharts[key];
}

/** 饼图 — 按身份等分类，图例在下方 */
function createKetangPieChart(key, canvasOrId, config) {
  if (typeof Chart === 'undefined') return null;
  var el = typeof canvasOrId === 'string' ? document.getElementById(canvasOrId) : canvasOrId;
  if (!el) return null;
  destroyKetangChart(key);
  var merged = Object.assign({}, config);
  if (merged.data && merged.data.datasets) styleRingDatasets(merged.data.datasets);
  var opts = config.options || {};
  opts.plugins = opts.plugins || {};
  opts.plugins.legend = Object.assign({ display: true, position: 'bottom' }, opts.plugins.legend || {});
  opts.plugins.tooltip = Object.assign({
    backgroundColor: hexToRgba(cssHex('--color-foreground', '#3d3028'), 0.92),
    titleColor: cssHex('--color-apricot', '#fff8f0'),
    bodyColor: cssHex('--color-apricot', '#fff8f0'),
    padding: 10,
    cornerRadius: 6
  }, opts.plugins.tooltip || {});
  merged.options = applyKetangChartDefaults(opts, 'pie');
  ketangCharts[key] = new Chart(el, merged);
  return ketangCharts[key];
}

function chartLegendHtml(items) {
  return items.map(function (item) {
    return '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:' + escapeHtml(item.color) + '"></span>' +
      escapeHtml(item.label) + ' <strong>' + escapeHtml(String(item.value)) + '</strong></span>';
  }).join('');
}

function chartBoxHtml(title, canvasId, wide) {
  var cls = wide ? 'forecast-chart-box wide' : 'forecast-chart-box';
  return '<div class="' + cls + '"><h4>' + escapeHtml(title) + '</h4><canvas id="' + canvasId + '"></canvas></div>';
}
