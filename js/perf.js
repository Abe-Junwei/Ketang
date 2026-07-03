/* Phase G 轻量性能埋点 | Lightweight performance marks (login/read/write/delta) */

var _ketangPerfMarks = {};

function ketangPerfMark(name) {
  if (!name || typeof performance === "undefined" || !performance.mark) return;
  try {
    performance.mark("ketang:" + name);
    _ketangPerfMarks[name] = performance.now();
  } catch (e) {
    /* ignore */
  }
}

function ketangPerfMeasure(name, startMark, endMark) {
  if (!name || typeof performance === "undefined" || !performance.measure) {
    return null;
  }
  try {
    var start = "ketang:" + (startMark || name + ":start");
    var end = "ketang:" + (endMark || name + ":end");
    performance.measure("ketang:" + name, start, end);
    var entries = performance.getEntriesByName("ketang:" + name);
    return entries.length ? entries[entries.length - 1].duration : null;
  } catch (e) {
    return null;
  }
}

function ketangPerfSummary() {
  return Object.assign({}, _ketangPerfMarks);
}
