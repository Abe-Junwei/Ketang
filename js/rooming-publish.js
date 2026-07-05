/* Phase 9.5 发布待入住清单 | Publish rooming plan to check-in queue */

var ROOMING_QUEUE_KIND_LABELS = {
  lodger: "在住",
  reservation: "预约",
};

function roomingQueueProcessedAt() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function getLocalRoomingCheckinQueue(eventId) {
  return query(
    "SELECT q.*, r.name AS room_name, r.location AS room_location, r.dorm_type, b.bed_number " +
      "FROM rooming_checkin_queue q " +
      "LEFT JOIN beds b ON b.id = q.suggested_bed_id " +
      "LEFT JOIN rooms r ON r.id = b.room_id " +
      "WHERE q.event_id = ? ORDER BY q.sort_order, q.id",
    [eventId],
  );
}

function getLocalRoomingPlanAssignments(planId) {
  return query(
    "SELECT * FROM rooming_assignments WHERE plan_id = ? AND member_kind IN ('lodger','reservation') ORDER BY sort_order, id",
    [planId],
  );
}

function assertLocalRoomingPublishable(eventId, plan) {
  var check = evaluateLocalRoomingConflicts(
    eventId,
    plan.id,
    query(
      "SELECT ra.*, r.name AS room_name, r.location AS room_location, r.dorm_type, b.bed_number " +
        "FROM rooming_assignments ra " +
        "LEFT JOIN beds b ON b.id = ra.bed_id " +
        "LEFT JOIN rooms r ON r.id = b.room_id " +
        "WHERE ra.plan_id = ? ORDER BY ra.sort_order, ra.id",
      [plan.id],
    ),
  );
  if (check.error_count > 0) {
    throw new Error("存在 " + check.error_count + " 项硬性冲突，无法发布");
  }
  var assignments = getLocalRoomingPlanAssignments(plan.id);
  if (!assignments.length) {
    throw new Error("没有可发布的在住/预约条目");
  }
  return assignments;
}

function insertLocalRoomingQueueRows(planId, eventId, assignments) {
  assignments.forEach(function (row, index) {
    run(
      "INSERT INTO rooming_checkin_queue (plan_id, assignment_id, event_id, member_kind, member_ref_id, member_name, member_gender, participant_identity, age_group, special_needs, suggested_bed_id, queue_status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待办理', ?)",
      [
        planId,
        row.id,
        eventId,
        row.member_kind,
        row.member_ref_id,
        row.member_name,
        row.member_gender,
        row.participant_identity,
        row.age_group,
        row.special_needs,
        row.bed_id,
        index,
      ],
    );
  });
}

async function publishLocalRoomingPlan(eventId) {
  var evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) throw new Error("营期不存在");
  var plan = query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
  if (!plan) throw new Error("请先生成并保存预分房草稿");
  if (plan.status !== "已确认") {
    throw new Error("仅「已确认」的预分房方案可发布");
  }
  if (plan.published_at) throw new Error("该方案已发布");

  var assignments = assertLocalRoomingPublishable(eventId, plan);

  await withTransaction(async function () {
    run("DELETE FROM rooming_checkin_queue WHERE plan_id = ?", [plan.id]);
    insertLocalRoomingQueueRows(plan.id, eventId, assignments);
    run(
      "UPDATE rooming_plans SET published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [plan.id],
    );
  });
  await saveDB();
  return {
    published_count: assignments.length,
    queue: getLocalRoomingCheckinQueue(eventId),
  };
}

async function republishLocalRoomingPlan(eventId) {
  var plan = query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
  if (!plan) throw new Error("预分房方案不存在");
  if (!plan.published_at) throw new Error("尚未发布，请使用首次发布");
  if (plan.status !== "已确认") {
    throw new Error("仅「已确认」的预分房方案可重新发布");
  }

  var assignments = assertLocalRoomingPublishable(eventId, plan);
  var existing = query(
    "SELECT assignment_id, queue_status FROM rooming_checkin_queue WHERE plan_id = ?",
    [plan.id],
  );
  var finalizedAssignmentIds = {};
  existing.forEach(function (row) {
    if (row.queue_status !== "待办理" && row.assignment_id != null) {
      finalizedAssignmentIds[row.assignment_id] = true;
    }
  });

  var pendingAssignments = assignments.filter(function (row) {
    return !finalizedAssignmentIds[row.id];
  });

  await withTransaction(async function () {
    run(
      "DELETE FROM rooming_checkin_queue WHERE plan_id = ? AND queue_status = '待办理'",
      [plan.id],
    );
    insertLocalRoomingQueueRows(plan.id, eventId, pendingAssignments);
    run(
      "UPDATE rooming_plans SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [plan.id],
    );
  });
  await saveDB();
  return { queue: getLocalRoomingCheckinQueue(eventId) };
}

async function fetchRoomingQueueBundle(eventId) {
  if (useOnlineDataPath()) {
    await roomingEnsureEvent(eventId, false);
    return {
      plan: roomingGetPlan(eventId) || null,
      queue: roomingCheckinQueueForEvent(eventId),
    };
  }
  var plan = query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
  return { plan: plan || null, queue: getLocalRoomingCheckinQueue(eventId) };
}

async function findRoomingQueueItem(queueId, eventId) {
  var bundle = await fetchRoomingQueueBundle(eventId);
  var queue = bundle.queue || [];
  for (var i = 0; i < queue.length; i++) {
    if (queue[i].id === queueId) return queue[i];
  }
  return null;
}

async function markRoomingQueueItemStatus(queueId, status, eventId) {
  if (useOnlineDataPath()) {
    var writeResult = await apiRoomingPlanAction("update_queue", {
      queue_id: queueId,
      queue_status: status,
    });
    await roomingRefreshAfterWrite(eventId, writeResult);
    return;
  }
  var processed = status === "待办理" ? null : roomingQueueProcessedAt();
  run(
    "UPDATE rooming_checkin_queue SET queue_status = ?, processed_at = ? WHERE id = ?",
    [status, processed, queueId],
  );
  await saveDB();
}

function roomingQueueBedLabel(row) {
  if (!row.suggested_bed_id) return "未指定";
  var loc = row.room_location ? row.room_location + " " : "";
  return loc + (row.room_name || "") + " " + (row.bed_number || "");
}

function renderRoomingQueueTable(eventId, queue, canProcess) {
  if (!queue.length) {
    return '<p class="empty-tip">暂无待入住清单。请先在预分房中发布已确认方案。</p>';
  }
  var html =
    '<div class="table-wrap rooming-queue-table-wrap"><table><thead><tr>' +
    "<th>姓名</th><th>来源</th><th>性别</th><th>建议床位</th><th>状态</th><th>操作</th>" +
    "</tr></thead><tbody>";
  queue.forEach(function (row) {
    var actions = "";
    if (canProcess && row.queue_status === "待办理") {
      if (row.suggested_bed_id) {
        actions +=
          '<button type="button" class="btn btn-sm btn-primary" onclick="handleRoomingQueueCheckin(event.currentTarget, ' +
          row.id +
          "," +
          eventId +
          ')">按预分床办理</button> ';
      }
      actions +=
        '<button type="button" class="btn btn-sm btn-default" onclick="handleRoomingQueueSkip(event.currentTarget, ' +
        row.id +
        "," +
        eventId +
        ')">跳过</button>';
    } else if (row.queue_status !== "待办理") {
      actions =
        '<span class="text-muted">' + infoEscape(row.queue_status) + "</span>";
    }
    html +=
      "<tr>" +
      "<td>" +
      infoEscape(row.member_name) +
      "</td>" +
      "<td>" +
      infoEscape(
        ROOMING_QUEUE_KIND_LABELS[row.member_kind] || row.member_kind,
      ) +
      "</td>" +
      "<td>" +
      infoEscape(row.member_gender || "-") +
      "</td>" +
      "<td>" +
      infoEscape(roomingQueueBedLabel(row)) +
      "</td>" +
      "<td>" +
      infoEscape(row.queue_status) +
      "</td>" +
      "<td class='rooming-queue-actions'>" +
      actions +
      "</td>" +
      "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

async function renderRoomingCheckinQueue(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("lodging.read")) {
    await uiAlert("权限不足");
    return;
  }
  if (!roomingUseLocalRead()) {
    await roomingEnsureEvent(eventId, false);
  }
  var evt = roomingGetEvent(eventId);
  if (!evt) {
    await uiAlert("营期不存在");
    return;
  }
  var bundle = await fetchRoomingQueueBundle(eventId);
  var queue = bundle.queue || [];
  var plan = bundle.plan;
  var pending = queue.filter(function (q) {
    return q.queue_status === "待办理";
  }).length;
  var canProcess =
    typeof hasPermission === "function" && hasPermission("lodging.checkin");
  var canRepublish =
    typeof hasPermission === "function" &&
    hasPermission("settings.write") &&
    plan &&
    plan.published_at &&
    plan.status === "已确认";

  var toolbar =
    '<button class="btn btn-default" onclick="renderRoomingPlan(' +
    eventId +
    ')">← 返回预分房</button>' +
    (canRepublish
      ? ' <button class="btn btn-warning" onclick="handleRepublishRoomingPlan(event.currentTarget, ' +
        eventId +
        ')">重新发布清单</button>'
      : "") +
    ' <button class="btn btn-default" onclick="exportRoomingCheckinListCSV(' +
    eventId +
    ')">导出签到表 CSV</button>' +
    ' <button class="btn btn-default" onclick="exportRoomingRoomTableCSV(' +
    eventId +
    ')">导出房间表 CSV</button>' +
    ' <button class="btn btn-default" onclick="printRoomingRoomTable(' +
    eventId +
    ')">打印房间表</button>' +
    ' <button class="btn btn-default" onclick="printRoomingDoorLabels(' +
    eventId +
    ')">打印门贴</button>' +
    ' <button class="btn btn-default" onclick="printRoomingBedLabels(' +
    eventId +
    ')">打印床位名牌</button>' +
    ' <button class="btn btn-default" onclick="renderRoomingRetrospective(' +
    eventId +
    ')">活动复盘</button>';

  var bodyHtml =
    '<div class="rooming-queue-shell">' +
    '<h3 class="rooming-plan-title">' +
    infoEscape(evt.name) +
    " · 待入住清单</h3>" +
    '<p class="rooming-plan-hint">由预分房发布生成，不自动占床；知客师请逐条核对后办理入住或分配床位。</p>' +
    '<div class="rooming-summary">' +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">发布状态</span><span class="rooming-summary-value">' +
    (plan && plan.published_at
      ? "已发布 " + infoEscape(String(plan.published_at).slice(0, 16))
      : "未发布") +
    "</span></div>" +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">待办理</span><span class="rooming-summary-value' +
    (pending > 0 ? " rooming-gap" : "") +
    '">' +
    pending +
    " / " +
    queue.length +
    "</span></div>" +
    "</div>" +
    renderRoomingQueueTable(eventId, queue, canProcess) +
    "</div>";

  infoPageShell(toolbar, bodyHtml);
}

async function handlePublishRoomingPlan(source, eventId) {
  return safeWithActionPending(source, "保存中…", async function () {
    if (
      typeof hasPermission === "function" &&
      !hasPermission("settings.write")
    ) {
      await uiAlert("权限不足");
      return;
    }
    if (
      !(await uiConfirm(
        "将生成「待入住清单」供知客师逐条办理，不会自动写入床位。预计占位人员不会进入清单。继续发布？",
      ))
    ) {
      return;
    }
    try {
      if (useOnlineDataPath()) {
        var publishResult = await apiRoomingPlanAction("publish", {
          event_id: eventId,
        });
        await roomingRefreshAfterWrite(eventId, publishResult);
      } else {
        await publishLocalRoomingPlan(eventId);
      }
      showToast("已发布待入住清单");
      await renderRoomingCheckinQueue(eventId);
    } catch (err) {
      await uiAlert("发布失败：" + (err.message || err));
    }
  });
}

async function handleRepublishRoomingPlan(source, eventId) {
  return safeWithActionPending(source, "保存中…", async function () {
    if (
      typeof hasPermission === "function" &&
      !hasPermission("settings.write")
    ) {
      await uiAlert("权限不足");
      return;
    }
    if (
      !(await uiConfirm(
        "重新发布会按当前草稿重建所有「待办理」条目；已办理/已跳过记录保留。继续？",
      ))
    ) {
      return;
    }
    try {
      if (useOnlineDataPath()) {
        var republishResult = await apiRoomingPlanAction("republish", {
          event_id: eventId,
          confirm_republish: true,
        });
        await roomingRefreshAfterWrite(eventId, republishResult);
      } else {
        await republishLocalRoomingPlan(eventId);
      }
      showToast("已重新发布待入住清单");
      await renderRoomingCheckinQueue(eventId);
    } catch (err) {
      await uiAlert("重新发布失败：" + (err.message || err));
    }
  });
}

async function completeRoomingQueueCheckin(queueId, eventId, item) {
  await markRoomingQueueItemStatus(queueId, "已办理", eventId);
  showToast("已办理：" + item.member_name);
  await renderRoomingCheckinQueue(eventId);
}

async function handleRoomingQueueCheckin(source, queueId, eventId) {
  return safeWithActionPending(source, "保存中…", async function () {
    if (
      typeof hasPermission === "function" &&
      !hasPermission("lodging.checkin")
    ) {
      await uiAlert("权限不足");
      return;
    }
    var item = await findRoomingQueueItem(queueId, eventId);
    if (!item || item.queue_status !== "待办理") return;
    if (!item.suggested_bed_id) {
      await uiAlert("该条目未指定建议床位，请在住宿办理中手动操作。");
      return;
    }
    if (!item.member_ref_id) {
      await uiAlert("该条目缺少关联人员，无法自动办理。");
      return;
    }
    if (
      !(await uiConfirm(
        "按预分床位为「" +
          String(item.member_name || "") +
          "」办理？仍将走正常入住/分床流程，请确认房态与身份无误。",
      ))
    ) {
      return;
    }
    try {
      if (useOnlineDataPath()) {
        var queueResult = await apiRoomingPlanAction("process_queue", {
          event_id: eventId,
          queue_id: queueId,
        });
        await roomingRefreshAfterWrite(eventId, queueResult);
        showToast("已办理：" + item.member_name);
        await renderRoomingCheckinQueue(eventId);
        return;
      }

      if (roomingQueueAssignAlreadyDone(item)) {
        await completeRoomingQueueCheckin(queueId, eventId, item);
        return;
      }
      var ok =
        item.member_kind === "lodger"
          ? await assignExistingLodgerToBed(
              item.member_ref_id,
              item.suggested_bed_id,
              { quiet: true, awaitRefresh: true },
            )
          : await assignReservationToBed(
              item.member_ref_id,
              item.suggested_bed_id,
              { quiet: true, awaitRefresh: true },
            );
      if (!ok) {
        if (roomingQueueAssignAlreadyDone(item)) {
          await completeRoomingQueueCheckin(queueId, eventId, item);
          return;
        }
        await uiAlert(
          "办理未完成：床位状态与预分不一致，请核对后手动标记「已办理」或「跳过」。",
        );
        return;
      }
      await completeRoomingQueueCheckin(queueId, eventId, item);
    } catch (err) {
      if (roomingQueueAssignAlreadyDone(item)) {
        try {
          await completeRoomingQueueCheckin(queueId, eventId, item);
          return;
        } catch (markErr) {
          await uiAlert("办理失败：" + (markErr.message || markErr));
          return;
        }
      }
      await uiAlert("办理失败：" + (err.message || err));
    }
  });
}

async function handleRoomingQueueSkip(source, queueId, eventId) {
  return safeWithActionPending(source, "保存中…", async function () {
    if (
      typeof hasPermission === "function" &&
      !hasPermission("lodging.checkin")
    ) {
      await uiAlert("权限不足");
      return;
    }
    if (!(await uiConfirm("标记为「已跳过」？表示本条暂不按预分床办理。")))
      return;
    var item = await findRoomingQueueItem(queueId, eventId);
    if (!item || item.queue_status !== "待办理") return;
    try {
      await markRoomingQueueItemStatus(queueId, "已跳过", eventId);
      if (typeof logRoomingQueueSkipAdjustment === "function") {
        try {
          await logRoomingQueueSkipAdjustment(item, eventId);
        } catch (logErr) {
          console.error(logErr);
          showToast("已跳过，但调整记录写入失败");
          await renderRoomingCheckinQueue(eventId);
          return;
        }
      }
      showToast("已跳过");
      await renderRoomingCheckinQueue(eventId);
    } catch (err) {
      await uiAlert("操作失败：" + (err.message || err));
    }
  });
}

async function exportRoomingCheckinListCSV(eventId) {
  if (!roomingUseLocalRead()) await roomingEnsureEvent(eventId, false);
  var evt = roomingGetEvent(eventId);
  if (!evt) return;
  var bundle = await fetchRoomingQueueBundle(eventId);
  var queue = bundle.queue || [];
  if (!queue.length) {
    await uiAlert("暂无待入住清单");
    return;
  }
  var lines = [
    "\uFEFF" +
      [
        "营期",
        "姓名",
        "来源",
        "性别",
        "身份",
        "年龄段",
        "建议房间",
        "建议床位",
        "状态",
      ]
        .map(csvCell)
        .join(","),
  ];
  queue.forEach(function (row) {
    lines.push(
      [
        evt.name,
        row.member_name,
        ROOMING_QUEUE_KIND_LABELS[row.member_kind] || row.member_kind,
        row.member_gender || "",
        row.participant_identity || "",
        row.age_group || "",
        row.room_location
          ? row.room_location + " " + (row.room_name || "")
          : row.room_name || "",
        row.bed_number || "",
        row.queue_status,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "rooming_checkin_" + evt.id + ".csv");
}

async function exportRoomingRoomTableCSV(eventId) {
  if (!roomingUseLocalRead()) await roomingEnsureEvent(eventId, false);
  var evt = roomingGetEvent(eventId);
  if (!evt) return;
  var bundle = await fetchRoomingQueueBundle(eventId);
  var queue = (bundle.queue || []).filter(function (row) {
    return row.suggested_bed_id;
  });
  if (!queue.length) {
    await uiAlert("暂无已指定床位的清单条目");
    return;
  }
  queue.sort(function (a, b) {
    var ra =
      (a.room_location || "") + (a.room_name || "") + (a.bed_number || "");
    var rb =
      (b.room_location || "") + (b.room_name || "") + (b.bed_number || "");
    return ra.localeCompare(rb, "zh");
  });
  var lines = [
    "\uFEFF" +
      ["营期", "房间", "位置", "寮房", "床位", "姓名", "性别", "身份", "状态"]
        .map(csvCell)
        .join(","),
  ];
  queue.forEach(function (row) {
    lines.push(
      [
        evt.name,
        row.room_name || "",
        row.room_location || "",
        row.dorm_type || "",
        row.bed_number || "",
        row.member_name,
        row.member_gender || "",
        row.participant_identity || "",
        row.queue_status,
      ]
        .map(csvCell)
        .join(","),
    );
  });
  var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, "rooming_rooms_" + evt.id + ".csv");
}

function roomingQueueRoomSortKey(row) {
  return (
    (row.room_location || "") +
    (row.room_name || "") +
    String(row.bed_number || "")
  );
}

function sortRoomingQueueByRoom(queue) {
  return queue.slice().sort(function (a, b) {
    return roomingQueueRoomSortKey(a).localeCompare(
      roomingQueueRoomSortKey(b),
      "zh",
    );
  });
}

function groupRoomingQueueByRoom(queue) {
  var groups = [];
  var map = {};
  sortRoomingQueueByRoom(queue).forEach(function (row) {
    if (!row.suggested_bed_id) return;
    var key =
      (row.room_location || "") +
      "|" +
      (row.room_name || "") +
      "|" +
      (row.dorm_type || "");
    if (!map[key]) {
      map[key] = {
        room_name: row.room_name || "",
        room_location: row.room_location || "",
        dorm_type: row.dorm_type || "",
        beds: [],
      };
      groups.push(map[key]);
    }
    map[key].beds.push(row);
  });
  return groups;
}

async function loadRoomingPrintQueue(eventId) {
  if (!roomingUseLocalRead()) await roomingEnsureEvent(eventId, false);
  var evt = roomingGetEvent(eventId);
  if (!evt) {
    await uiAlert("营期不存在");
    return null;
  }
  var bundle = await fetchRoomingQueueBundle(eventId);
  var queue = (bundle.queue || []).filter(function (row) {
    return row.suggested_bed_id;
  });
  if (!queue.length) {
    await uiAlert("暂无已指定床位的清单条目，请先发布预分房");
    return null;
  }
  return { evt: evt, queue: queue, groups: groupRoomingQueueByRoom(queue) };
}

function openRoomingPrintPreview(title, bodyHtml) {
  var modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML =
    '<div class="rooming-print-doc">' +
    bodyHtml +
    '</div><div class="rooming-print-actions">' +
    '<button type="button" class="btn btn-primary" onclick="window.print()">打印</button> ' +
    '<button type="button" class="btn btn-default" onclick="closeModal()">关闭</button>' +
    "</div>";
  modal.classList.add("active");
}

function buildRoomingPrintMeta(evt) {
  var dates = [];
  if (evt.start_date) dates.push(evt.start_date);
  if (evt.end_date && evt.end_date !== evt.start_date) {
    dates.push(evt.end_date);
  }
  return (
    '<div class="rooming-print-meta">' +
    "<h2>" +
    infoEscape(evt.name) +
    "</h2>" +
    (dates.length
      ? '<p class="rooming-print-dates">' +
        infoEscape(dates.join(" ~ ")) +
        "</p>"
      : "") +
    '<p class="rooming-print-ts">打印时间：' +
    infoEscape(roomingQueueProcessedAt()) +
    "</p></div>"
  );
}

function buildRoomingRoomTablePrintHtml(evt, groups) {
  var html = buildRoomingPrintMeta(evt);
  html +=
    '<table class="rooming-print-table"><thead><tr>' +
    "<th>位置</th><th>房间</th><th>寮房</th><th>床位</th><th>姓名</th><th>性别</th><th>身份</th><th>状态</th>" +
    "</tr></thead><tbody>";
  groups.forEach(function (group) {
    group.beds.forEach(function (row) {
      html +=
        "<tr><td>" +
        infoEscape(group.room_location) +
        "</td><td>" +
        infoEscape(group.room_name) +
        "</td><td>" +
        infoEscape(group.dorm_type) +
        "</td><td>" +
        infoEscape(row.bed_number || "") +
        "</td><td>" +
        infoEscape(row.member_name) +
        "</td><td>" +
        infoEscape(row.member_gender || "") +
        "</td><td>" +
        infoEscape(row.participant_identity || "") +
        "</td><td>" +
        infoEscape(row.queue_status) +
        "</td></tr>";
    });
  });
  html += "</tbody></table>";
  return html;
}

function buildRoomingDoorLabelsPrintHtml(evt, groups) {
  var html = buildRoomingPrintMeta(evt);
  html += '<div class="rooming-door-grid">';
  groups.forEach(function (group) {
    html +=
      '<section class="rooming-door-card">' +
      '<div class="rooming-door-head">' +
      "<h3>" +
      infoEscape(group.room_name) +
      "</h3>" +
      (group.room_location
        ? '<p class="rooming-door-loc">' +
          infoEscape(group.room_location) +
          "</p>"
        : "") +
      (group.dorm_type
        ? '<p class="rooming-door-type">' + infoEscape(group.dorm_type) + "</p>"
        : "") +
      '</div><ul class="rooming-door-beds">';
    group.beds.forEach(function (row) {
      html +=
        '<li><span class="rooming-door-bed">' +
        infoEscape(row.bed_number || "床位") +
        "</span> " +
        infoEscape(row.member_name) +
        (row.member_gender ? "（" + infoEscape(row.member_gender) + "）" : "") +
        "</li>";
    });
    html += "</ul></section>";
  });
  html += "</div>";
  return html;
}

function buildRoomingBedLabelsPrintHtml(evt, queue) {
  var html = buildRoomingPrintMeta(evt);
  html += '<div class="rooming-bed-label-grid">';
  sortRoomingQueueByRoom(queue).forEach(function (row) {
    var roomLabel = row.room_location
      ? row.room_location + " " + (row.room_name || "")
      : row.room_name || "";
    html +=
      '<div class="rooming-bed-label">' +
      '<div class="rooming-bed-label-name">' +
      infoEscape(row.member_name) +
      "</div>" +
      '<div class="rooming-bed-label-room">' +
      infoEscape(roomLabel) +
      "</div>" +
      '<div class="rooming-bed-label-bed">' +
      infoEscape(row.bed_number || "") +
      "</div>" +
      (row.participant_identity
        ? '<div class="rooming-bed-label-role">' +
          infoEscape(row.participant_identity) +
          "</div>"
        : "") +
      "</div>";
  });
  html += "</div>";
  return html;
}

async function printRoomingRoomTable(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("lodging.read")) {
    await uiAlert("权限不足");
    return;
  }
  var data = await loadRoomingPrintQueue(eventId);
  if (!data) return;
  openRoomingPrintPreview(
    "打印房间表 · " + data.evt.name,
    buildRoomingRoomTablePrintHtml(data.evt, data.groups),
  );
}

async function printRoomingDoorLabels(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("lodging.read")) {
    await uiAlert("权限不足");
    return;
  }
  var data = await loadRoomingPrintQueue(eventId);
  if (!data) return;
  openRoomingPrintPreview(
    "打印门贴 · " + data.evt.name,
    buildRoomingDoorLabelsPrintHtml(data.evt, data.groups),
  );
}

async function printRoomingBedLabels(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("lodging.read")) {
    await uiAlert("权限不足");
    return;
  }
  var data = await loadRoomingPrintQueue(eventId);
  if (!data) return;
  openRoomingPrintPreview(
    "打印床位名牌 · " + data.evt.name,
    buildRoomingBedLabelsPrintHtml(data.evt, data.queue),
  );
}
