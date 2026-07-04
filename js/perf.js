/* Phase G 轻量性能埋点 | Lightweight performance marks (login/read/write/delta/push) */

var _ketangPerfMarks = {};
var _ketangPerfCounters = {
  delta_count: 0,
  delta_not_modified_count: 0,
  delta_full_sync_count: 0,
  delta_apply_count: 0,
  push_count: 0,
  push_sse_count: 0,
  push_poll_count: 0,
};
var _ketangPerfSamples = {
  push_latency_ms: [],
  delta_ms: [],
  read_module_ms: [],
};
var PERF_SAMPLE_CAP = 50;

function ketangPerfMark(name) {
  if (!name || typeof performance === "undefined" || !performance.mark) return;
  try {
    performance.mark("ketang:" + name);
    _ketangPerfMarks[name] = performance.now();
  } catch (e) {
    /* ignore */
  }
}

function ketangPerfRecordSample(bucket, ms) {
  if (!bucket || ms == null || !isFinite(ms) || ms < 0) return;
  if (!_ketangPerfSamples[bucket]) _ketangPerfSamples[bucket] = [];
  var arr = _ketangPerfSamples[bucket];
  arr.push(Math.round(ms));
  if (arr.length > PERF_SAMPLE_CAP) arr.shift();
}

function ketangPerfSampleP95(bucket) {
  var arr = _ketangPerfSamples[bucket] || [];
  if (!arr.length) return null;
  var ordered = arr.slice().sort(function (a, b) {
    return a - b;
  });
  var idx = Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * 0.95) - 1),
  );
  return ordered[idx];
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
    var duration = entries.length
      ? entries[entries.length - 1].duration
      : null;
    if (duration != null) {
      if (name === "delta") ketangPerfRecordSample("delta_ms", duration);
      if (name === "push") ketangPerfRecordSample("push_latency_ms", duration);
      if (String(name).indexOf("read:") === 0) {
        ketangPerfRecordSample("read_module_ms", duration);
      }
    }
    return duration;
  } catch (e) {
    return null;
  }
}

function ketangPerfInc(name, n) {
  if (!_ketangPerfCounters.hasOwnProperty(name)) return;
  _ketangPerfCounters[name] += n == null ? 1 : n;
}

function ketangPerfCounters() {
  return Object.assign({}, _ketangPerfCounters);
}

function ketangPerfSummary() {
  return {
    marks: Object.assign({}, _ketangPerfMarks),
    counters: ketangPerfCounters(),
    samples: {
      push_latency_p95_ms: ketangPerfSampleP95("push_latency_ms"),
      delta_p95_ms: ketangPerfSampleP95("delta_ms"),
      read_module_p95_ms: ketangPerfSampleP95("read_module_ms"),
      push_latency_n: (_ketangPerfSamples.push_latency_ms || []).length,
      delta_n: (_ketangPerfSamples.delta_ms || []).length,
      read_module_n: (_ketangPerfSamples.read_module_ms || []).length,
    },
  };
}
