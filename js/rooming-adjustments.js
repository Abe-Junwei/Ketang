/* Phase 9.5.2 活动调整记录与复盘 | Rooming adjustment log & retrospective */

function roomingAdjustmentOperator() {
  if (typeof currentUser !== "undefined" && currentUser) {
    return currentUser.display_name || currentUser.username || "";
  }
  return "";
}

function getPublishedRoomingPlan(eventId) {
  return roomingGetPublishedPlan(eventId);
}

function formatRoomingBedLabel(bedId, bedNumber, roomName, roomLocation) {
  if (!bedId) return "-";
  var loc = roomLocation ? roomLocation + " " : "";
  return loc + (roomName || "") + " " + (bedNumber || "");
}

function getLocalRoomingAdjustments(eventId) {
  return query(
    "SELECT a.*, " +
      "fb.bed_number AS from_bed_number, fr.name AS from_room_name, fr.location AS from_room_location, " +
      "tb.bed_number AS to_bed_number, tr.name AS to_room_name, tr.location AS to_room_location " +
      "FROM rooming_adjustments a " +
      "LEFT JOIN beds fb ON fb.id = a.from_bed_id " +
      "LEFT JOIN rooms fr ON fr.id = fb.room_id " +
      "LEFT JOIN beds tb ON tb.id = a.to_bed_id " +
      "LEFT JOIN rooms tr ON tr.id = tb.room_id " +
      "WHERE a.event_id = ? ORDER BY a.created_at DESC, a.id DESC",
    [eventId],
  );
}

async function logRoomingAdjustment(payload) {
  var eventId = payload.event_id;
  if (!eventId) return;
  var body = {
    action: "log_adjustment",
    event_id: eventId,
    plan_id: payload.plan_id || null,
    queue_id: payload.queue_id || null,
    lodger_id: payload.lodger_id || null,
    adjustment_kind: payload.adjustment_kind || "其他",
    member_name: payload.member_name || "",
    from_bed_id: payload.from_bed_id || null,
    to_bed_id: payload.to_bed_id || null,
    reason: payload.reason || "",
    operator: payload.operator || roomingAdjustmentOperator(),
  };
  if (useOnlineDataPath()) {
    var writeResult = await apiRoomingPlanAction("log_adjustment", body);
    await roomingRefreshAfterWrite(eventId, writeResult);
    return;
  }
  run(
    "INSERT INTO rooming_adjustments (event_id, plan_id, queue_id, lodger_id, adjustment_kind, member_name, from_bed_id, to_bed_id, reason, operator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      eventId,
      body.plan_id,
      body.queue_id,
      body.lodger_id,
      body.adjustment_kind,
      body.member_name,
      body.from_bed_id,
      body.to_bed_id,
      body.reason,
      body.operator,
    ],
  );
  await saveDB();
}

function maybeLogRoomingChangeBed(lodgerId, oldBedId, newBedId) {
  var lodger = roomingLodgerEventRow(lodgerId);
  if (!lodger || !lodger.event_id) return;
  var plan = getPublishedRoomingPlan(lodger.event_id);
  if (!plan) return;
  logRoomingAdjustment({
    event_id: lodger.event_id,
    plan_id: plan.id,
    lodger_id: lodgerId,
    adjustment_kind: "换床",
    member_name: lodger.name,
    from_bed_id: oldBedId,
    to_bed_id: newBedId,
    reason: "",
  }).catch(function (err) {
    console.error("rooming adjustment log failed", err);
  });
}

async function logRoomingQueueSkipAdjustment(item, eventId) {
  var plan = getPublishedRoomingPlan(eventId);
  if (!plan) return;
  await logRoomingAdjustment({
    event_id: eventId,
    plan_id: plan.id,
    queue_id: item.id,
    adjustment_kind: "跳过预分",
    member_name: item.member_name,
    from_bed_id: item.suggested_bed_id,
    reason: "待入住清单标记为已跳过",
  });
}

function roomingRetrospectiveSummary(queue, adjustments) {
  queue = queue || [];
  adjustments = adjustments || [];
  return {
    total: queue.length,
    pending: queue.filter(function (q) {
      return q.queue_status === "待办理";
    }).length,
    done: queue.filter(function (q) {
      return q.queue_status === "已办理";
    }).length,
    skipped: queue.filter(function (q) {
      return q.queue_status === "已跳过";
    }).length,
    adjustments: adjustments.length,
  };
}

async function fetchRoomingRetrospective(eventId) {
  if (useOnlineDataPath()) {
    await roomingEnsureEvent(eventId, false);
    var remoteEvent = roomingGetEvent(eventId);
    if (!remoteEvent) throw new Error("营期不存在");
    var remotePlan = roomingGetPlan(eventId);
    var remoteQueue = roomingCheckinQueueForEvent(eventId);
    var remoteAdjustments = roomingAdjustmentsForEvent(eventId);
    return {
      event: remoteEvent,
      plan: remotePlan || null,
      queue: remoteQueue,
      adjustments: remoteAdjustments,
      summary: roomingRetrospectiveSummary(remoteQueue, remoteAdjustments),
    };
  }
  var evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) throw new Error("营期不存在");
  var plan = query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
  var queue = getLocalRoomingCheckinQueue(eventId);
  var adjustments = getLocalRoomingAdjustments(eventId);
  return {
    event: evt,
    plan: plan || null,
    queue: queue,
    adjustments: adjustments,
    summary: roomingRetrospectiveSummary(queue, adjustments),
  };
}

function renderRoomingAdjustmentsTable(rows) {
  if (!rows.length) {
    return '<p class="empty-tip">暂无活动期调整记录。</p>';
  }
  var html =
    '<div class="table-wrap"><table class="rooming-retro-adjust-table"><thead><tr>' +
    "<th>时间</th><th>类型</th><th>姓名</th><th>原床位</th><th>新床位</th><th>说明</th><th>操作人</th>" +
    "</tr></thead><tbody>";
  rows.forEach(function (row) {
    html +=
      "<tr><td>" +
      infoEscape(String(row.created_at || "").slice(0, 16)) +
      "</td><td>" +
      infoEscape(row.adjustment_kind) +
      "</td><td>" +
      infoEscape(row.member_name || "-") +
      "</td><td>" +
      infoEscape(
        formatRoomingBedLabel(
          row.from_bed_id,
          row.from_bed_number,
          row.from_room_name,
          row.from_room_location,
        ),
      ) +
      "</td><td>" +
      infoEscape(
        formatRoomingBedLabel(
          row.to_bed_id,
          row.to_bed_number,
          row.to_room_name,
          row.to_room_location,
        ),
      ) +
      "</td><td>" +
      infoEscape(row.reason || "-") +
      "</td><td>" +
      infoEscape(row.operator || "-") +
      "</td></tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

async function renderRoomingRetrospective(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("lodging.read")) {
    alert("权限不足");
    return;
  }
  if (!roomingUseLocalRead()) {
    await roomingEnsureEvent(eventId, false);
  }
  try {
    var data = await fetchRoomingRetrospective(eventId);
    var evt = data.event;
    var summary = data.summary || {};
    var canNote =
      typeof hasPermission === "function" && hasPermission("lodging.checkin");

    var toolbar =
      '<button class="btn btn-default" onclick="renderRoomingCheckinQueue(' +
      eventId +
      ')">← 返回待入住清单</button>' +
      ' <button class="btn btn-default" onclick="exportRoomingRetrospectiveCSV(' +
      eventId +
      ')">导出复盘 CSV</button>' +
      (canNote
        ? ' <button class="btn btn-default" onclick="handleRoomingManualNote(' +
          eventId +
          ')">记录调整备注</button>'
        : "");

    var bodyHtml =
      '<div class="rooming-retro-shell">' +
      '<h3 class="rooming-plan-title">' +
      infoEscape(evt.name) +
      " · 活动复盘</h3>" +
      '<p class="rooming-plan-hint">汇总待入住清单办理情况与活动期调整记录，供活动结束后交接与复盘。</p>' +
      '<div class="rooming-summary">' +
      '<div class="rooming-summary-item"><span class="rooming-summary-label">清单总数</span><span class="rooming-summary-value">' +
      (summary.total || 0) +
      "</span></div>" +
      '<div class="rooming-summary-item"><span class="rooming-summary-label">已办理</span><span class="rooming-summary-value">' +
      (summary.done || 0) +
      "</span></div>" +
      '<div class="rooming-summary-item"><span class="rooming-summary-label">已跳过</span><span class="rooming-summary-value">' +
      (summary.skipped || 0) +
      "</span></div>" +
      '<div class="rooming-summary-item"><span class="rooming-summary-label">待办理</span><span class="rooming-summary-value' +
      ((summary.pending || 0) > 0 ? " rooming-gap" : "") +
      '">' +
      (summary.pending || 0) +
      "</span></div>" +
      '<div class="rooming-summary-item"><span class="rooming-summary-label">调整记录</span><span class="rooming-summary-value">' +
      (summary.adjustments || 0) +
      "</span></div>" +
      "</div>" +
      "<h4>活动期调整</h4>" +
      renderRoomingAdjustmentsTable(data.adjustments || []) +
      "</div>";

    infoPageShell(toolbar, bodyHtml);
  } catch (err) {
    alert("加载复盘失败：" + (err.message || err));
  }
}

async function handleRoomingManualNote(eventId) {
  if (
    typeof hasPermission === "function" &&
    !hasPermission("lodging.checkin")
  ) {
    alert("权限不足");
    return;
  }
  var reason = prompt("请输入调整说明（将记入活动调整记录）：");
  if (!reason || !String(reason).trim()) return;
  var plan = getPublishedRoomingPlan(eventId);
  try {
    await logRoomingAdjustment({
      event_id: eventId,
      plan_id: plan ? plan.id : null,
      adjustment_kind: "手动备注",
      reason: String(reason).trim(),
    });
    showToast("已记录调整备注");
    await renderRoomingRetrospective(eventId);
  } catch (err) {
    alert("记录失败：" + (err.message || err));
  }
}

async function exportRoomingRetrospectiveCSV(eventId) {
  var data = await fetchRoomingRetrospective(eventId);
  var rows = data.adjustments || [];
  if (!rows.length) {
    alert("暂无调整记录可导出");
    return;
  }
  var lines = [
    "\uFEFF" +
      ["营期", "时间", "类型", "姓名", "原床位", "新床位", "说明", "操作人"]
        .map(csvCell)
        .join(","),
  ];
  rows.forEach(function (row) {
    lines.push(
      [
        data.event.name,
        row.created_at || "",
        row.adjustment_kind,
        row.member_name || "",
        formatRoomingBedLabel(
          row.from_bed_id,
          row.from_bed_number,
          row.from_room_name,
          row.from_room_location,
        ),
        formatRoomingBedLabel(
          row.to_bed_id,
          row.to_bed_number,
          row.to_room_name,
          row.to_room_location,
        ),
        row.reason || "",
        row.operator || "",
      ]
        .map(csvCell)
        .join(","),
    );
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "rooming_retro_" + eventId + ".csv");
}
