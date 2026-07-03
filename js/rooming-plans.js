/* Phase 9.3 预分房草稿（按床位）| Rooming plan draft UI */

var ROOMING_PLAN_STATUSES = ["未确认", "待调整", "已确认"];
var ROOMING_ITEM_STATUSES = ["未确认", "待调整", "已确认"];
var ROOMING_KIND_LABELS = {
  lodger: "在住",
  reservation: "预约",
  forecast: "预计",
};

function roomingKindOrder(kind) {
  if (kind === "lodger") return 0;
  if (kind === "reservation") return 1;
  if (kind === "forecast") return 2;
  return 9;
}

function roomingDormMatchesGender(dormType, gender) {
  if (!gender) return dormType === "不限";
  return (
    dormType === "不限" ||
    (dormType === "男寮" && gender === "男") ||
    (dormType === "女寮" && gender === "女")
  );
}

function listLocalEventMembersForPlan(eventId) {
  var lodgers = query(
    "SELECT id, name, gender, participant_identity, age_group, special_needs FROM lodgers WHERE event_id = ? AND status = '在住' ORDER BY name",
    [eventId],
  );
  var reservations = query(
    "SELECT id, name, gender, participant_identity, age_group, special_needs FROM reservations WHERE event_id = ? AND status IN ('预约', '已确认') ORDER BY name",
    [eventId],
  );
  var members = [];
  lodgers.forEach(function (row) {
    members.push({
      member_kind: "lodger",
      member_ref_id: row.id,
      member_name: row.name,
      member_gender: row.gender,
      participant_identity: row.participant_identity,
      age_group: row.age_group,
      special_needs: row.special_needs,
    });
  });
  reservations.forEach(function (row) {
    members.push({
      member_kind: "reservation",
      member_ref_id: row.id,
      member_name: row.name,
      member_gender: row.gender,
      participant_identity: row.participant_identity,
      age_group: row.age_group,
      special_needs: row.special_needs,
    });
  });
  var evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) return members;
  var registeredMale = members.filter(function (m) {
    return m.member_gender === "男";
  }).length;
  var registeredFemale = members.filter(function (m) {
    return m.member_gender === "女";
  }).length;
  members = members.concat(
    buildLocalForecastMembers(
      evt,
      members.length,
      registeredMale,
      registeredFemale,
    ),
  );
  return members;
}

function buildLocalForecastMembers(
  event,
  registeredCount,
  registeredMale,
  registeredFemale,
) {
  var members = [];
  var expected = event.expected_count || 0;
  if (expected <= registeredCount) return members;
  var needMale = 0;
  var needFemale = 0;
  var remaining = expected - registeredCount;
  if (event.gender_type === "男众") {
    needMale = Math.max(0, expected - registeredMale);
  } else if (event.gender_type === "女众") {
    needFemale = Math.max(0, expected - registeredFemale);
  } else {
    var maleRatio =
      registeredCount > 0 ? registeredMale / registeredCount : 0.5;
    needMale = Math.round(remaining * maleRatio);
    needFemale = remaining - needMale;
  }
  var idx = 1;
  var i;
  for (i = 0; i < needMale; i++) {
    members.push({
      member_kind: "forecast",
      member_ref_id: null,
      member_name: "预计男众" + idx++,
      member_gender: "男",
      participant_identity: null,
      age_group: null,
      special_needs: null,
    });
  }
  idx = 1;
  for (i = 0; i < needFemale; i++) {
    members.push({
      member_kind: "forecast",
      member_ref_id: null,
      member_name: "预计女众" + idx++,
      member_gender: "女",
      participant_identity: null,
      age_group: null,
      special_needs: null,
    });
  }
  return members;
}

function roomingDatesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return true;
  return startA <= endB && startB <= endA;
}

function listLocalDraftReservedBedIds(eventId, planId, event) {
  var range = {
    start: event.arrival_date || event.start_date,
    end: event.departure_date || event.end_date,
  };
  var rows = query(
    "SELECT ra.bed_id, e.arrival_date, e.departure_date, e.start_date, e.end_date " +
      "FROM rooming_assignments ra " +
      "JOIN rooming_plans rp ON rp.id = ra.plan_id " +
      "JOIN events e ON e.id = rp.event_id " +
      "WHERE ra.bed_id IS NOT NULL AND rp.event_id != ? AND (? = 0 OR rp.id != ?)",
    [eventId, planId || 0, planId || 0],
  );
  var ids = {};
  rows.forEach(function (row) {
    var otherStart = row.arrival_date || row.start_date;
    var otherEnd = row.departure_date || row.end_date;
    if (roomingDatesOverlap(range.start, range.end, otherStart, otherEnd)) {
      ids[row.bed_id] = true;
    }
  });
  return Object.keys(ids).map(function (id) {
    return parseInt(id, 10);
  });
}

function listLocalAssignableBeds(event, excludeBedIds) {
  var exclude = {};
  (excludeBedIds || []).forEach(function (id) {
    if (id) exclude[id] = true;
  });
  var requireInspect =
    typeof housekeepingRequiresInspect === "function" &&
    housekeepingRequiresInspect();
  var hkStatuses = requireInspect ? "('可用')" : "('净房','可用')";
  var includeSpare = !!event.include_spare_beds;
  var spareSql = spareRoomExcludeClause("r", includeSpare);
  var rows = query(
    "SELECT b.id AS bed_id, b.bed_number, r.id AS room_id, r.name AS room_name, r.location, r.dorm_type " +
      "FROM beds b JOIN rooms r ON r.id = b.room_id " +
      "LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住' " +
      "WHERE b.status NOT IN ('维修', '备用') AND l.id IS NULL " +
      "AND " +
      spareSql +
      " AND COALESCE((SELECT status FROM housekeeping WHERE bed_id = b.id ORDER BY changed_at DESC LIMIT 1), '净房') IN " +
      hkStatuses +
      " ORDER BY CASE r.dorm_type WHEN '男寮' THEN 1 WHEN '女寮' THEN 2 ELSE 3 END, r.location, r.name, b.bed_number",
  );
  return rows.filter(function (row) {
    return !exclude[row.bed_id];
  });
}

function buildLocalAutoBedAssignments(members, beds) {
  var sorted = members.slice().sort(function (a, b) {
    var ka = roomingKindOrder(a.member_kind);
    var kb = roomingKindOrder(b.member_kind);
    if (ka !== kb) return ka - kb;
    return String(a.member_name || "").localeCompare(
      String(b.member_name || ""),
      "zh",
    );
  });
  var maleBeds = beds.filter(function (b) {
    return roomingDormMatchesGender(b.dorm_type, "男");
  });
  var femaleBeds = beds.filter(function (b) {
    return roomingDormMatchesGender(b.dorm_type, "女");
  });
  var flexBeds = beds.filter(function (b) {
    return b.dorm_type === "不限";
  });
  var queues = {
    男: maleBeds.concat(flexBeds),
    女: femaleBeds.concat(flexBeds),
    "": beds.slice(),
  };
  var used = {};
  var assignments = [];
  sorted.forEach(function (member, index) {
    var gender = member.member_gender || "";
    var pool =
      gender === "男"
        ? queues["男"]
        : gender === "女"
          ? queues["女"]
          : queues[""];
    var bed = null;
    for (var i = 0; i < pool.length; i++) {
      if (!used[pool[i].bed_id]) {
        bed = pool[i];
        used[bed.bed_id] = true;
        break;
      }
    }
    assignments.push({
      member_kind: member.member_kind,
      member_ref_id: member.member_ref_id,
      member_name: member.member_name,
      member_gender: member.member_gender,
      participant_identity: member.participant_identity,
      age_group: member.age_group,
      special_needs: member.special_needs,
      bed_id: bed ? bed.bed_id : null,
      item_status: "未确认",
      notes: null,
      sort_order: index,
    });
  });
  return assignments;
}

function getLocalRoomingPlanBundle(eventId) {
  var plan = query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
  if (!plan) return { plan: null, assignments: [] };
  var assignments = query(
    "SELECT ra.*, r.name AS room_name, r.location AS room_location, r.dorm_type, b.bed_number " +
      "FROM rooming_assignments ra " +
      "LEFT JOIN beds b ON b.id = ra.bed_id " +
      "LEFT JOIN rooms r ON r.id = b.room_id " +
      "WHERE ra.plan_id = ? ORDER BY ra.sort_order, ra.id",
    [plan.id],
  );
  return { plan: plan, assignments: assignments };
}

function ensureLocalRoomingPlan(eventId) {
  var evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) throw new Error("营期不存在");
  var existing = query(
    "SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1",
    [eventId],
  )[0];
  if (existing) return existing;
  run(
    "INSERT INTO rooming_plans (event_id, name, status, notes, updated_at) VALUES (?, ?, '未确认', '', CURRENT_TIMESTAMP)",
    [eventId, evt.name + " 预分房"],
  );
  return query("SELECT * FROM rooming_plans WHERE event_id = ? LIMIT 1", [
    eventId,
  ])[0];
}

function generateLocalRoomingPlan(eventId) {
  var evt = query("SELECT * FROM events WHERE id = ?", [eventId])[0];
  if (!evt) throw new Error("营期不存在");
  var plan = ensureLocalRoomingPlan(eventId);
  var members = listLocalEventMembersForPlan(eventId);
  var reservedBedIds = listLocalDraftReservedBedIds(eventId, plan.id, evt);
  var beds = listLocalAssignableBeds(evt, reservedBedIds);
  var draft = buildLocalAutoBedAssignments(members, beds);
  run("DELETE FROM rooming_assignments WHERE plan_id = ?", [plan.id]);
  draft.forEach(function (item) {
    run(
      "INSERT INTO rooming_assignments (plan_id, member_kind, member_ref_id, member_name, member_gender, participant_identity, age_group, special_needs, bed_id, item_status, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        plan.id,
        item.member_kind,
        item.member_ref_id,
        item.member_name,
        item.member_gender,
        item.participant_identity,
        item.age_group,
        item.special_needs,
        item.bed_id,
        item.item_status,
        item.notes,
        item.sort_order,
      ],
    );
  });
  run(
    "UPDATE rooming_plans SET status = '未确认', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [plan.id],
  );
  return getLocalRoomingPlanBundle(eventId);
}

function listAllAssignableBedOptions(event) {
  return roomingListAssignableBeds(event, []);
}

function roomingBedLabel(row) {
  if (!row || !row.bed_id) return "";
  var loc = row.room_location ? row.room_location + " " : "";
  return loc + (row.room_name || "") + " " + (row.bed_number || "");
}

function roomingBedOptionLabel(bed) {
  var loc = bed.location ? bed.location + " " : "";
  return (
    loc + bed.room_name + " " + bed.bed_number + "（" + bed.dorm_type + "）"
  );
}

function buildRoomingBedSelectOptions(event, selectedBedId, memberGender) {
  var beds = listAllAssignableBedOptions(event);
  var html = '<option value="">未分配</option>';
  beds.forEach(function (bed) {
    if (
      memberGender &&
      !roomingDormMatchesGender(bed.dorm_type, memberGender)
    ) {
      return;
    }
    var selected = bed.bed_id === selectedBedId ? " selected" : "";
    html +=
      '<option value="' +
      bed.bed_id +
      '"' +
      selected +
      ">" +
      infoEscape(roomingBedOptionLabel(bed)) +
      "</option>";
  });
  return html;
}

function roomingPlanSummaryStats(assignments) {
  var assigned = assignments.filter(function (a) {
    return a.bed_id;
  }).length;
  var unassigned = assignments.length - assigned;
  var male = assignments.filter(function (a) {
    return a.member_gender === "男";
  }).length;
  var female = assignments.filter(function (a) {
    return a.member_gender === "女";
  }).length;
  return {
    assigned: assigned,
    unassigned: unassigned,
    male: male,
    female: female,
  };
}

function renderRoomingDraftTable(event, assignments, canEdit) {
  if (!assignments.length) {
    return '<p class="empty-tip">尚无预分房条目。点击「自动生成」按床位生成草稿。</p>';
  }
  var html =
    '<div class="table-wrap rooming-plan-table-wrap"><table><thead><tr>' +
    "<th>姓名</th><th>来源</th><th>性别</th><th>身份/年龄段</th><th>床位</th><th>条目状态</th>" +
    "</tr></thead><tbody>";
  assignments.forEach(function (row) {
    var tag =
      (row.participant_identity || "") +
      (row.age_group ? " / " + row.age_group : "");
    var bedCell;
    if (canEdit) {
      bedCell =
        '<select class="rooming-bed-select" data-assignment-id="' +
        row.id +
        '">' +
        buildRoomingBedSelectOptions(event, row.bed_id, row.member_gender) +
        "</select>";
    } else {
      bedCell = row.bed_id
        ? infoEscape(roomingBedLabel(row))
        : '<span class="rooming-gap">未分配</span>';
    }
    var statusCell;
    if (canEdit) {
      statusCell =
        '<select class="rooming-item-status-select" data-assignment-id="' +
        row.id +
        '">';
      ROOMING_ITEM_STATUSES.forEach(function (st) {
        statusCell +=
          '<option value="' +
          st +
          '"' +
          (row.item_status === st ? " selected" : "") +
          ">" +
          st +
          "</option>";
      });
      statusCell += "</select>";
    } else {
      statusCell = infoEscape(row.item_status || "未确认");
    }
    html +=
      "<tr>" +
      "<td>" +
      infoEscape(row.member_name) +
      (row.special_needs ? ' <span class="rooming-tag">特殊</span>' : "") +
      "</td>" +
      "<td>" +
      infoEscape(ROOMING_KIND_LABELS[row.member_kind] || row.member_kind) +
      "</td>" +
      "<td>" +
      infoEscape(row.member_gender || "-") +
      "</td>" +
      "<td>" +
      infoEscape(tag || "-") +
      "</td>" +
      "<td>" +
      bedCell +
      "</td>" +
      "<td>" +
      statusCell +
      "</td>" +
      "</tr>";
  });
  html += "</tbody></table></div>";
  return html;
}

async function fetchRoomingPlanBundle(eventId) {
  if (!isLocalForceDb()) {
    return apiRoomingPlanAction("get", { event_id: eventId });
  }
  return getLocalRoomingPlanBundle(eventId);
}

async function generateRoomingPlanDraft(eventId) {
  if (!isLocalForceDb()) {
    var genResult = await apiRoomingPlanAction("generate", { event_id: eventId });
    await roomingRefreshAfterWrite(eventId, genResult);
    return genResult;
  }
  var bundle = generateLocalRoomingPlan(eventId);
  await saveDB();
  return bundle;
}

async function saveRoomingPlanDraft(eventId, plan, assignments, managerAck) {
  var noteParts = stripManagerAckFromNotes(plan.notes || "");
  var mergedNotes = mergePlanNotesWithManagerAck(noteParts.adjust, managerAck);
  var payload = {
    action: "save",
    plan_id: plan.id,
    status: plan.status,
    notes: mergedNotes,
    assignments: assignments.map(function (row) {
      return {
        id: row.id,
        bed_id: row.bed_id || null,
        item_status: row.item_status,
        notes: row.notes,
      };
    }),
  };
  if (!isLocalForceDb()) {
    var saveResult = await apiRoomingPlanAction("save", payload);
    await roomingRefreshAfterWrite(eventId, saveResult);
    return saveResult;
  }
  run(
    "UPDATE rooming_plans SET status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [plan.status, mergedNotes, plan.id],
  );
  assignments.forEach(function (row) {
    run(
      "UPDATE rooming_assignments SET bed_id = ?, item_status = ? WHERE id = ? AND plan_id = ?",
      [row.bed_id || null, row.item_status || "未确认", row.id, plan.id],
    );
  });
  await saveDB();
  return getLocalRoomingPlanBundle(eventId);
}

function collectRoomingPlanFormState(plan, assignments) {
  var statusEl = document.getElementById("rooming-plan-status");
  var notesEl = document.getElementById("rooming-plan-notes");
  var managerAckEl = document.getElementById("rooming-manager-ack");
  var nextPlan = {
    id: plan.id,
    status: statusEl ? statusEl.value : plan.status,
    notes: notesEl ? notesEl.value : plan.notes,
  };
  var nextAssignments = assignments.map(function (row) {
    var bedSelect = document.querySelector(
      '.rooming-bed-select[data-assignment-id="' + row.id + '"]',
    );
    var statusSelect = document.querySelector(
      '.rooming-item-status-select[data-assignment-id="' + row.id + '"]',
    );
    return {
      id: row.id,
      bed_id:
        bedSelect && bedSelect.value ? parseInt(bedSelect.value, 10) : null,
      item_status: statusSelect ? statusSelect.value : row.item_status,
      notes: row.notes,
      member_name: row.member_name,
      member_gender: row.member_gender,
      member_kind: row.member_kind,
      participant_identity: row.participant_identity,
      age_group: row.age_group,
      special_needs: row.special_needs,
    };
  });
  return {
    plan: nextPlan,
    assignments: nextAssignments,
    managerAck: managerAckEl ? managerAckEl.value : "",
  };
}

function assignmentsForConflictCheck(savedAssignments, formAssignments) {
  if (!formAssignments || !formAssignments.length) return savedAssignments;
  return savedAssignments.map(function (row) {
    var edited = formAssignments.find(function (item) {
      return item.id === row.id;
    });
    if (!edited) return row;
    return Object.assign({}, row, {
      bed_id: edited.bed_id,
      item_status: edited.item_status,
    });
  });
}

async function renderRoomingPlan(eventId, options) {
  if (typeof hasPermission === "function" && !hasPermission("settings.read")) {
    alert("权限不足");
    return;
  }
  if (!roomingUseLocalRead()) {
    await roomingEnsureEvent(eventId, false);
  }
  var evt = roomingGetEvent(eventId);
  if (!evt) {
    alert("营期不存在");
    return;
  }
  var canEdit =
    typeof hasPermission === "function" && hasPermission("settings.write");
  var bundle = await fetchRoomingPlanBundle(eventId);
  if (!bundle.plan && canEdit) {
    if (!isLocalForceDb()) {
      var ensureResult = await apiRoomingPlanAction("ensure", {
        event_id: eventId,
      });
      await roomingRefreshAfterWrite(eventId, ensureResult);
    } else {
      ensureLocalRoomingPlan(eventId);
      await saveDB();
    }
    bundle = await fetchRoomingPlanBundle(eventId);
  }
  var plan = bundle.plan;
  var assignments = bundle.assignments || [];
  var stats = roomingPlanSummaryStats(assignments);
  var noteParts = stripManagerAckFromNotes((plan && plan.notes) || "");
  var formState = options && options.formState ? options.formState : null;
  var checkAssignments = assignmentsForConflictCheck(
    assignments,
    formState ? formState.assignments : null,
  );
  var conflictReport = await fetchRoomingConflictReport(
    eventId,
    plan ? plan.id : 0,
    checkAssignments,
  );
  var isPublished = !!(plan && plan.published_at);
  var canPublish =
    canEdit &&
    plan &&
    plan.status === "已确认" &&
    !isPublished &&
    conflictReport.error_count === 0;

  var canRepublish =
    canEdit &&
    isPublished &&
    plan &&
    plan.status === "已确认" &&
    conflictReport.error_count === 0;

  var toolbar =
    '<button class="btn btn-default" onclick="renderInfo(\'events\')">← 返回营期</button>' +
    (canEdit && !isPublished
      ? ' <button class="btn btn-primary" onclick="handleGenerateRoomingPlan(' +
        eventId +
        ')">自动生成</button>' +
        ' <button class="btn btn-default" onclick="handleRefreshRoomingConflicts(' +
        eventId +
        ')">刷新冲突检查</button>' +
        ' <button class="btn btn-success" onclick="handleSaveRoomingPlan(' +
        eventId +
        ')">保存草稿</button>'
      : "") +
    (canPublish
      ? ' <button class="btn btn-warning" onclick="handlePublishRoomingPlan(' +
        eventId +
        ')">发布待入住清单</button>'
      : "") +
    (canRepublish
      ? ' <button class="btn btn-warning" onclick="handleRepublishRoomingPlan(' +
        eventId +
        ')">重新发布清单</button>'
      : "") +
    (isPublished
      ? ' <button class="btn btn-primary" onclick="renderRoomingCheckinQueue(' +
        eventId +
        ')">待入住清单</button>' +
        ' <button class="btn btn-default" onclick="exportRoomingCheckinListCSV(' +
        eventId +
        ')">签到表 CSV</button>' +
        ' <button class="btn btn-default" onclick="exportRoomingRoomTableCSV(' +
        eventId +
        ')">房间表 CSV</button>' +
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
        ')">活动复盘</button>'
      : "");

  var statusSelect = "";
  if (canEdit && !isPublished) {
    statusSelect =
      '<select id="rooming-plan-status" class="rooming-plan-status-select">';
    ROOMING_PLAN_STATUSES.forEach(function (st) {
      statusSelect +=
        '<option value="' +
        st +
        '"' +
        (plan && plan.status === st ? " selected" : "") +
        ">" +
        st +
        "</option>";
    });
    statusSelect += "</select>";
  } else {
    statusSelect = infoEscape((plan && plan.status) || "未确认");
    if (isPublished) {
      statusSelect += ' <span class="rooming-published-badge">已发布</span>';
    }
  }

  var bodyHtml =
    '<div class="rooming-plan-shell">' +
    '<h3 class="rooming-plan-title">' +
    infoEscape(evt.name) +
    " · 预分房草稿</h3>" +
    '<p class="rooming-plan-hint">草稿仅用于排房规划，不会改动真实挂单或床位占用；确认后可发布待入住清单供知客师逐条办理。</p>' +
    '<div class="rooming-summary">' +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">方案状态</span><span class="rooming-summary-value">' +
    statusSelect +
    "</span></div>" +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">已分配床位</span><span class="rooming-summary-value">' +
    stats.assigned +
    " / " +
    assignments.length +
    "</span></div>" +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">未分配</span><span class="rooming-summary-value' +
    (stats.unassigned > 0 ? " rooming-gap" : "") +
    '">' +
    stats.unassigned +
    "</span></div>" +
    '<div class="rooming-summary-item"><span class="rooming-summary-label">男 / 女</span><span class="rooming-summary-value">' +
    stats.male +
    " / " +
    stats.female +
    "</span></div>" +
    "</div>" +
    renderRoomingConflictsPanel(conflictReport) +
    (canEdit && !isPublished
      ? '<div class="form-group"><label>调整说明</label><textarea id="rooming-plan-notes" rows="2" placeholder="排房调整说明、待办…">' +
        infoEscape(noteParts.adjust) +
        "</textarea></div>" +
        '<div class="form-group"><label>负责人确认记录</label><textarea id="rooming-manager-ack" rows="2" placeholder="客堂负责人或主管确认意见…">' +
        infoEscape(
          formState && formState.managerAck != null
            ? formState.managerAck
            : noteParts.managerAck,
        ) +
        "</textarea></div>"
      : plan && plan.notes
        ? '<p class="rooming-plan-notes">备注：' +
          infoEscape(plan.notes) +
          "</p>"
        : "") +
    renderRoomingDraftTable(evt, assignments, canEdit && !isPublished) +
    "</div>";

  infoPageShell(toolbar, bodyHtml);
}

async function handleGenerateRoomingPlan(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("settings.write")) {
    alert("权限不足");
    return;
  }
  if (
    !confirm(
      "将按当前报名与预计人数重新生成床位预分房，现有草稿条目会被覆盖。继续？",
    )
  ) {
    return;
  }
  try {
    await generateRoomingPlanDraft(eventId);
    showToast("已自动生成预分房草稿");
    await renderRoomingPlan(eventId);
  } catch (err) {
    alert("生成失败：" + (err.message || err));
  }
}

async function handleRefreshRoomingConflicts(eventId) {
  var bundle = await fetchRoomingPlanBundle(eventId);
  if (!bundle.plan) {
    alert("请先生成预分房草稿");
    return;
  }
  var state = collectRoomingPlanFormState(bundle.plan, bundle.assignments);
  await renderRoomingPlan(eventId, { formState: state });
}

async function handleSaveRoomingPlan(eventId) {
  if (typeof hasPermission === "function" && !hasPermission("settings.write")) {
    alert("权限不足");
    return;
  }
  var bundle = await fetchRoomingPlanBundle(eventId);
  if (!bundle.plan) {
    alert("请先自动生成预分房");
    return;
  }
  var state = collectRoomingPlanFormState(bundle.plan, bundle.assignments);
  var checkAssignments = assignmentsForConflictCheck(
    bundle.assignments,
    state.assignments,
  );
  var conflictReport = await fetchRoomingConflictReport(
    eventId,
    bundle.plan.id,
    checkAssignments,
  );
  if (state.plan.status === "已确认" && conflictReport.error_count > 0) {
    alert(
      "存在 " +
        conflictReport.error_count +
        " 项硬性冲突，请先处理后再标记为「已确认」。可点击「刷新冲突检查」查看详情。",
    );
    await renderRoomingPlan(eventId, { formState: state });
    return;
  }
  if (
    state.plan.status === "已确认" &&
    conflictReport.warning_count > 0 &&
    !confirm(
      "仍有 " +
        conflictReport.warning_count +
        " 项待人工确认的问题。确定在负责人已知情的情况下标记为「已确认」？",
    )
  ) {
    await renderRoomingPlan(eventId, { formState: state });
    return;
  }
  try {
    await saveRoomingPlanDraft(
      eventId,
      state.plan,
      state.assignments,
      state.managerAck,
    );
    showToast("预分房草稿已保存");
    await renderRoomingPlan(eventId);
  } catch (err) {
    alert("保存失败：" + (err.message || err));
  }
}
