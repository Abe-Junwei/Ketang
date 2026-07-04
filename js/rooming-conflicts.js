/* Phase 9.4 预分房冲突检查（浏览器）| Rooming conflict checks (browser) */

var ROOMING_MANAGER_ACK_PREFIX = "【负责人确认】";

function stripManagerAckFromNotes(notes) {
  var text = String(notes || "");
  var idx = text.indexOf(ROOMING_MANAGER_ACK_PREFIX);
  if (idx === -1) return { adjust: text.trim(), managerAck: "" };
  return {
    adjust: text.slice(0, idx).trim(),
    managerAck: text.slice(idx + ROOMING_MANAGER_ACK_PREFIX.length).trim(),
  };
}

function mergePlanNotesWithManagerAck(adjustNotes, managerAck) {
  var parts = stripManagerAckFromNotes(adjustNotes);
  var base = parts.adjust;
  var ack = managerAck != null ? String(managerAck).trim() : parts.managerAck;
  if (!ack) return base;
  return (base ? base + "\n\n" : "") + ROOMING_MANAGER_ACK_PREFIX + "\n" + ack;
}

function enrichAssignmentsForConflictCheck(assignments) {
  return (assignments || []).map(function (row) {
    if (typeof roomingEnrichAssignmentRow === "function") {
      return roomingEnrichAssignmentRow(row);
    }
    if (!row.bed_id) return Object.assign({}, row);
    var meta = query(
      "SELECT b.id AS bed_id, b.bed_number, b.status AS bed_status, b.suitable_elder AS bed_suitable_elder, " +
        "r.name AS room_name, r.location AS room_location, r.dorm_type, r.room_type, r.suitable_elder AS room_suitable_elder " +
        "FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?",
      [row.bed_id],
    )[0];
    return Object.assign({}, row, meta || {});
  });
}

function listLocalOccupiedBedsForConflict(bedIds, eventId) {
  if (!bedIds.length) return [];
  var placeholders = bedIds
    .map(function () {
      return "?";
    })
    .join(",");
  return query(
    "SELECT l.id AS lodger_id, l.name AS lodger_name, l.event_id, l.bed_id, l.check_in_date, " +
      "COALESCE(l.actual_check_out, l.expected_check_out) AS check_out_date, " +
      "e.name AS event_name, r.name AS room_name, r.location AS room_location, b.bed_number " +
      "FROM lodgers l " +
      "JOIN beds b ON b.id = l.bed_id " +
      "JOIN rooms r ON r.id = b.room_id " +
      "LEFT JOIN events e ON e.id = l.event_id " +
      "WHERE l.status = '在住' AND l.bed_id IN (" +
      placeholders +
      ")",
    bedIds,
  ).map(function (row) {
    return {
      lodger_id: row.lodger_id,
      lodger_name: row.lodger_name,
      event_id: row.event_id,
      event_name: row.event_name,
      bed_id: row.bed_id,
      check_in_date: row.check_in_date,
      check_out_date: row.check_out_date,
      room_name: row.room_name,
      room_location: row.room_location,
      bed_number: row.bed_number,
    };
  });
}

function listLocalOtherPlanBedUsage(bedIds, eventId, planId) {
  if (!bedIds.length) return [];
  var placeholders = bedIds
    .map(function () {
      return "?";
    })
    .join(",");
  var params = bedIds.concat([eventId, planId || 0]);
  return query(
    "SELECT ra.bed_id, ra.member_name, rp.id AS plan_id, rp.event_id, e.name AS event_name, " +
      "e.arrival_date, e.departure_date, e.start_date, e.end_date, " +
      "r.name AS room_name, r.location AS room_location, b.bed_number " +
      "FROM rooming_assignments ra " +
      "JOIN rooming_plans rp ON rp.id = ra.plan_id " +
      "JOIN events e ON e.id = rp.event_id " +
      "LEFT JOIN beds b ON b.id = ra.bed_id " +
      "LEFT JOIN rooms r ON r.id = b.room_id " +
      "WHERE ra.bed_id IN (" +
      placeholders +
      ") AND rp.event_id != ? AND rp.id != ? AND ra.bed_id IS NOT NULL",
    params,
  ).map(function (row) {
    return {
      bed_id: row.bed_id,
      member_name: row.member_name,
      event_id: row.event_id,
      event_name: row.event_name,
      start: row.arrival_date || row.start_date,
      end: row.departure_date || row.end_date,
      room_name: row.room_name,
      room_location: row.room_location,
      bed_number: row.bed_number,
    };
  });
}

function buildLocalHkByBed(bedIds) {
  var map = {};
  if (!bedIds.length) return map;
  var placeholders = bedIds
    .map(function () {
      return "?";
    })
    .join(",");
  query(
    "SELECT bed_id, status FROM housekeeping WHERE bed_id IN (" +
      placeholders +
      ") ORDER BY changed_at DESC",
    bedIds,
  ).forEach(function (row) {
    if (!map[row.bed_id]) map[row.bed_id] = row.status;
  });
  return map;
}

function evaluateLocalRoomingConflicts(eventId, planId, assignments) {
  var evt = roomingGetEvent(eventId);
  if (!evt) return { conflicts: [], error_count: 0, warning_count: 0 };
  var enriched = enrichAssignmentsForConflictCheck(assignments);
  var bedIds = enriched
    .filter(function (row) {
      return row.bed_id;
    })
    .map(function (row) {
      return row.bed_id;
    });
  var uniqueBedIds = bedIds.filter(function (id, index) {
    return bedIds.indexOf(id) === index;
  });
  var requireInspect =
    typeof housekeepingRequiresInspect === "function" &&
    housekeepingRequiresInspect();
  return evaluateRoomingConflictsBrowser({
    event: evt,
    assignments: enriched,
    occupiedBeds: listLocalOccupiedBedsForConflict(uniqueBedIds, eventId),
    otherPlanBeds: listLocalOtherPlanBedUsage(uniqueBedIds, eventId, planId),
    hkByBed: buildLocalHkByBed(uniqueBedIds),
    requireInspect: requireInspect,
  });
}

function conflictCodeLabel(code) {
  var labels = {
    bed_duplicate: "床位重复",
    bed_occupied: "床位占用",
    bed_unavailable: "床位不可用",
    bed_housekeeping: "房务未就绪",
    gender_mismatch: "性别不符",
    event_gender: "营期性别",
    identity_room: "身份与房型",
    elder_bed: "老人床位",
    special_needs: "特殊需求",
    unassigned: "未分配",
    event_overlap: "活动重叠",
  };
  return labels[code] || code;
}

function renderRoomingConflictsPanel(conflictResult) {
  var conflicts = (conflictResult && conflictResult.conflicts) || [];
  if (!conflicts.length) {
    return (
      '<div class="rooming-conflicts rooming-conflicts-ok">' +
      '<h4 class="rooming-section-title">冲突检查</h4>' +
      '<p class="rooming-conflict-ok-tip">未发现硬性冲突。若有特殊安排，请在负责人确认栏记录。</p>' +
      "</div>"
    );
  }
  var errors = conflicts.filter(function (c) {
    return c.severity === "error";
  });
  var warnings = conflicts.filter(function (c) {
    return c.severity === "warning";
  });
  var html =
    '<div class="rooming-conflicts">' +
    '<h4 class="rooming-section-title">冲突检查</h4>' +
    '<div class="rooming-conflict-stats">' +
    '<span class="rooming-conflict-stat rooming-conflict-stat-error">硬性冲突 ' +
    errors.length +
    "</span>" +
    '<span class="rooming-conflict-stat rooming-conflict-stat-warning">待确认 ' +
    warnings.length +
    "</span>" +
    "</div>";
  if (errors.length) {
    html +=
      '<div class="rooming-conflict-group"><div class="rooming-conflict-group-title">必须处理</div><ul class="rooming-conflict-list">';
    errors.forEach(function (item) {
      html +=
        '<li class="rooming-conflict-item rooming-conflict-error">' +
        '<span class="rooming-conflict-tag">' +
        infoEscape(conflictCodeLabel(item.code)) +
        "</span> " +
        infoEscape(item.message) +
        "</li>";
    });
    html += "</ul></div>";
  }
  if (warnings.length) {
    html +=
      '<div class="rooming-conflict-group"><div class="rooming-conflict-group-title">需人工确认 / 请示</div><ul class="rooming-conflict-list">';
    warnings.forEach(function (item) {
      html +=
        '<li class="rooming-conflict-item rooming-conflict-warning">' +
        '<span class="rooming-conflict-tag">' +
        infoEscape(conflictCodeLabel(item.code)) +
        "</span> " +
        infoEscape(item.message) +
        "</li>";
    });
    html += "</ul></div>";
  }
  html += "</div>";
  return html;
}

async function fetchRoomingConflictReport(eventId, planId, assignments) {
  if (useOnlineDataPath()) {
    // Draft assignments still need POST body; saved plan uses GET read
    if (assignments && assignments.length) {
      return apiRoomingPlanAction("check", {
        event_id: eventId,
        plan_id: planId,
        assignments: assignments,
      });
    }
    if (typeof apiReadEventConflicts === "function") {
      return apiReadEventConflicts(eventId, planId);
    }
    return apiRoomingPlanAction("check", {
      event_id: eventId,
      plan_id: planId,
    });
  }
  return evaluateLocalRoomingConflicts(eventId, planId, assignments);
}

function evaluateRoomingConflictsBrowser(input) {
  var event = input.event || {};
  var assignments = input.assignments || [];
  var occupiedBeds = input.occupiedBeds || [];
  var otherPlanBeds = input.otherPlanBeds || [];
  var hkByBed = input.hkByBed || {};
  var requireInspect = !!input.requireInspect;
  var conflicts = [];
  var eventStart = event.arrival_date || event.start_date || null;
  var eventEnd = event.departure_date || event.end_date || null;

  function dormMatch(dormType, gender) {
    return roomingDormMatchesGender(dormType, gender);
  }
  function overlap(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !aEnd || !bStart || !bEnd) return false;
    return aStart <= bEnd && bStart <= aEnd;
  }
  function bedLabelRow(row) {
    var loc = row.room_location ? row.room_location + " " : "";
    return loc + (row.room_name || "") + " " + (row.bed_number || "");
  }

  var byBed = {};
  assignments.forEach(function (row) {
    if (!row.bed_id) return;
    if (!byBed[row.bed_id]) byBed[row.bed_id] = [];
    byBed[row.bed_id].push(row);
  });
  Object.keys(byBed).forEach(function (bedIdKey) {
    var rows = byBed[bedIdKey];
    if (rows.length <= 1) return;
    conflicts.push({
      severity: "error",
      code: "bed_duplicate",
      message:
        "同一床位分配给多人：" +
        rows
          .map(function (r) {
            return r.member_name;
          })
          .join("、") +
        " → " +
        bedLabelRow(rows[0]),
      assignment_ids: rows.map(function (r) {
        return r.id;
      }),
      bed_id: parseInt(bedIdKey, 10),
    });
  });

  assignments.forEach(function (row) {
    if (!row.bed_id) {
      conflicts.push({
        severity: "warning",
        code: "unassigned",
        message: "尚未分配床位：" + row.member_name,
        assignment_ids: [row.id],
        member_name: row.member_name,
      });
      return;
    }
    if (row.bed_status === "维修" || row.bed_status === "备用") {
      conflicts.push({
        severity: "error",
        code: "bed_unavailable",
        message:
          row.member_name +
          " 分配到不可用床位（" +
          row.bed_status +
          "）：" +
          bedLabelRow(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    var hk = hkByBed[row.bed_id];
    var hkOk = requireInspect ? hk === "可用" : hk === "净房" || hk === "可用";
    if (hk && !hkOk) {
      conflicts.push({
        severity: "error",
        code: "bed_housekeeping",
        message:
          row.member_name +
          " 分配到房务未就绪床位（当前：" +
          hk +
          "）：" +
          bedLabelRow(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (
      row.member_gender &&
      row.dorm_type &&
      !dormMatch(row.dorm_type, row.member_gender)
    ) {
      conflicts.push({
        severity: "error",
        code: "gender_mismatch",
        message:
          row.member_name +
          "（" +
          row.member_gender +
          "）与寮房类型不符（" +
          row.dorm_type +
          "）：" +
          bedLabelRow(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (event.gender_type === "男众" && row.member_gender === "女") {
      conflicts.push({
        severity: "error",
        code: "event_gender",
        message: row.member_name + " 为女众，但本营期为男众活动",
        assignment_ids: [row.id],
      });
    }
    if (event.gender_type === "女众" && row.member_gender === "男") {
      conflicts.push({
        severity: "error",
        code: "event_gender",
        message: row.member_name + " 为男众，但本营期为女众活动",
        assignment_ids: [row.id],
      });
    }
    var identity = row.participant_identity;
    var roomType = row.room_type || "学员房";
    if (identity === "僧人" && roomType !== "僧寮") {
      conflicts.push({
        severity: "error",
        code: "identity_room",
        message:
          row.member_name +
          "（僧人）不应安排在 " +
          roomType +
          "：" +
          bedLabelRow(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (identity === "师资" && roomType !== "师资房" && roomType !== "客房") {
      conflicts.push({
        severity: "warning",
        code: "identity_room",
        message:
          row.member_name + "（师资）建议安排在师资房/客房，当前为 " + roomType,
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (identity === "义工" && roomType !== "义工房" && roomType !== "机动房") {
      conflicts.push({
        severity: "warning",
        code: "identity_room",
        message:
          row.member_name +
          "（义工）建议安排在义工房/机动房，当前为 " +
          roomType,
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (
      row.age_group === "老年" &&
      !row.room_suitable_elder &&
      !row.bed_suitable_elder
    ) {
      conflicts.push({
        severity: "warning",
        code: "elder_bed",
        message: row.member_name + "（老年）所在房间/床位未标记适合老人",
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (row.special_needs && String(row.special_needs).trim()) {
      conflicts.push({
        severity: "warning",
        code: "special_needs",
        message:
          row.member_name +
          " 有特殊需求，请人工确认床位是否合适：" +
          String(row.special_needs).trim(),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
  });

  occupiedBeds.forEach(function (occ) {
    if (occ.event_id === event.id) {
      var match = assignments.find(function (row) {
        return (
          row.bed_id === occ.bed_id &&
          row.member_kind === "lodger" &&
          row.member_ref_id === occ.lodger_id
        );
      });
      if (match) return;
    }
    if (
      eventStart &&
      eventEnd &&
      !overlap(eventStart, eventEnd, occ.check_in_date, occ.check_out_date)
    ) {
      return;
    }
    conflicts.push({
      severity: "error",
      code: "bed_occupied",
      message:
        "床位已被在住占用：" +
        bedLabelRow(occ) +
        "（" +
        occ.lodger_name +
        " · " +
        (occ.event_name || "其他营期") +
        "）",
      assignment_ids: assignments
        .filter(function (row) {
          return row.bed_id === occ.bed_id;
        })
        .map(function (row) {
          return row.id;
        }),
      bed_id: occ.bed_id,
    });
  });

  otherPlanBeds.forEach(function (other) {
    if (
      eventStart &&
      eventEnd &&
      !overlap(eventStart, eventEnd, other.start, other.end)
    ) {
      return;
    }
    conflicts.push({
      severity: "warning",
      code: "event_overlap",
      message:
        "与其他营期预分房重叠：" +
        bedLabelRow(other) +
        "（" +
        other.member_name +
        " · " +
        (other.event_name || "其他营期") +
        "）",
      assignment_ids: assignments
        .filter(function (row) {
          return row.bed_id === other.bed_id;
        })
        .map(function (row) {
          return row.id;
        }),
      bed_id: other.bed_id,
    });
  });

  return {
    conflicts: conflicts,
    error_count: conflicts.filter(function (c) {
      return c.severity === "error";
    }).length,
    warning_count: conflicts.filter(function (c) {
      return c.severity === "warning";
    }).length,
  };
}
