/** Phase 9.4 预分房冲突检查（纯逻辑，本地/云端共用）| Rooming conflict evaluation */

export const CONFLICT_SEVERITY = {
  ERROR: "error",
  WARNING: "warning",
};

const MONK_IDENTITIES = new Set(["僧人"]);
const TEACHER_IDENTITIES = new Set(["师资"]);
const VOLUNTEER_IDENTITIES = new Set(["义工"]);

const ROOM_TYPE_FOR_IDENTITY = {
  僧人: new Set(["僧寮"]),
  师资: new Set(["师资房", "客房"]),
  义工: new Set(["义工房", "机动房"]),
};

function eventLodgingRange(event) {
  const start = event.arrival_date || event.start_date || null;
  const end = event.departure_date || event.end_date || null;
  return { start, end };
}

/** YYYY-MM-DD inclusive overlap | Inclusive date-range overlap */
export function dateRangesOverlap(startA, endA, startB, endB) {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

function pushConflict(list, item) {
  list.push(item);
}

function bedLabel(row) {
  const loc = row.room_location ? row.room_location + " " : "";
  return loc + (row.room_name || "") + " " + (row.bed_number || "");
}

/**
 * @param {object} input
 * @param {object} input.event
 * @param {object[]} input.assignments
 * @param {object[]} [input.occupiedBeds] - active lodgers on beds
 * @param {object[]} [input.otherPlanBeds] - other events' draft assignments
 * @param {object} [input.hkByBed] - bed_id -> hk status
 * @param {boolean} [input.requireInspect]
 */
export function evaluateRoomingConflicts(input) {
  const event = input.event || {};
  const assignments = input.assignments || [];
  const occupiedBeds = input.occupiedBeds || [];
  const otherPlanBeds = input.otherPlanBeds || [];
  const hkByBed = input.hkByBed || {};
  const requireInspect = !!input.requireInspect;
  const conflicts = [];
  const { start: eventStart, end: eventEnd } = eventLodgingRange(event);

  const byBed = {};
  assignments.forEach(function (row) {
    if (!row.bed_id) return;
    if (!byBed[row.bed_id]) byBed[row.bed_id] = [];
    byBed[row.bed_id].push(row);
  });

  Object.keys(byBed).forEach(function (bedIdKey) {
    const rows = byBed[bedIdKey];
    if (rows.length <= 1) return;
    pushConflict(conflicts, {
      severity: CONFLICT_SEVERITY.ERROR,
      code: "bed_duplicate",
      message:
        "同一床位分配给多人：" +
        rows
          .map(function (r) {
            return r.member_name;
          })
          .join("、") +
        " → " +
        bedLabel(rows[0]),
      assignment_ids: rows.map(function (r) {
        return r.id;
      }),
      bed_id: parseInt(bedIdKey, 10),
    });
  });

  assignments.forEach(function (row) {
    if (!row.bed_id) {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.WARNING,
        code: "unassigned",
        message: "尚未分配床位：" + row.member_name,
        assignment_ids: [row.id],
        member_name: row.member_name,
      });
      return;
    }

    if (row.bed_status === "维修" || row.bed_status === "备用") {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "bed_unavailable",
        message:
          row.member_name +
          " 分配到不可用床位（" +
          row.bed_status +
          "）：" +
          bedLabel(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }

    const hk = hkByBed[row.bed_id];
    const hkOk = requireInspect
      ? hk === "可用"
      : hk === "净房" || hk === "可用";
    if (hk && !hkOk) {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "bed_housekeeping",
        message:
          row.member_name +
          " 分配到房务未就绪床位（当前：" +
          hk +
          "）：" +
          bedLabel(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }

    if (
      row.member_gender &&
      row.dorm_type &&
      !dormMatchesGender(row.dorm_type, row.member_gender)
    ) {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "gender_mismatch",
        message:
          row.member_name +
          "（" +
          row.member_gender +
          "）与寮房类型不符（" +
          row.dorm_type +
          "）：" +
          bedLabel(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }

    if (event.gender_type === "男众" && row.member_gender === "女") {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "event_gender",
        message: row.member_name + " 为女众，但本营期为男众活动",
        assignment_ids: [row.id],
      });
    }
    if (event.gender_type === "女众" && row.member_gender === "男") {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "event_gender",
        message: row.member_name + " 为男众，但本营期为女众活动",
        assignment_ids: [row.id],
      });
    }

    const identity = row.participant_identity;
    const roomType = row.room_type || "学员房";
    if (identity && MONK_IDENTITIES.has(identity) && roomType !== "僧寮") {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.ERROR,
        code: "identity_room",
        message:
          row.member_name +
          "（僧人）不应安排在 " +
          roomType +
          "：" +
          bedLabel(row),
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }
    if (identity && TEACHER_IDENTITIES.has(identity)) {
      const allowed = ROOM_TYPE_FOR_IDENTITY["师资"];
      if (!allowed.has(roomType)) {
        pushConflict(conflicts, {
          severity: CONFLICT_SEVERITY.WARNING,
          code: "identity_room",
          message:
            row.member_name +
            "（师资）建议安排在师资房/客房，当前为 " +
            roomType,
          assignment_ids: [row.id],
          bed_id: row.bed_id,
        });
      }
    }
    if (identity && VOLUNTEER_IDENTITIES.has(identity)) {
      const allowed = ROOM_TYPE_FOR_IDENTITY["义工"];
      if (!allowed.has(roomType)) {
        pushConflict(conflicts, {
          severity: CONFLICT_SEVERITY.WARNING,
          code: "identity_room",
          message:
            row.member_name +
            "（义工）建议安排在义工房/机动房，当前为 " +
            roomType,
          assignment_ids: [row.id],
          bed_id: row.bed_id,
        });
      }
    }

    if (
      row.age_group === "老年" &&
      !row.room_suitable_elder &&
      !row.bed_suitable_elder
    ) {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.WARNING,
        code: "elder_bed",
        message: row.member_name + "（老年）所在房间/床位未标记适合老人",
        assignment_ids: [row.id],
        bed_id: row.bed_id,
      });
    }

    if (row.special_needs && String(row.special_needs).trim()) {
      pushConflict(conflicts, {
        severity: CONFLICT_SEVERITY.WARNING,
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
      const match = assignments.find(function (row) {
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
      !dateRangesOverlap(
        eventStart,
        eventEnd,
        occ.check_in_date,
        occ.check_out_date,
      )
    ) {
      return;
    }
    pushConflict(conflicts, {
      severity: CONFLICT_SEVERITY.ERROR,
      code: "bed_occupied",
      message:
        "床位已被在住占用：" +
        bedLabel(occ) +
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
      !dateRangesOverlap(eventStart, eventEnd, other.start, other.end)
    ) {
      return;
    }
    pushConflict(conflicts, {
      severity: CONFLICT_SEVERITY.WARNING,
      code: "event_overlap",
      message:
        "与其他营期预分房重叠：" +
        bedLabel(other) +
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
      return c.severity === CONFLICT_SEVERITY.ERROR;
    }).length,
    warning_count: conflicts.filter(function (c) {
      return c.severity === CONFLICT_SEVERITY.WARNING;
    }).length,
  };
}

export function dormMatchesGender(dormType, gender) {
  if (!gender) return dormType === "不限";
  return (
    dormType === "不限" ||
    (dormType === "男寮" && gender === "男") ||
    (dormType === "女寮" && gender === "女")
  );
}

export function summarizeRoomingConflicts(result) {
  const errors = (result.conflicts || []).filter(function (c) {
    return c.severity === CONFLICT_SEVERITY.ERROR;
  });
  const warnings = (result.conflicts || []).filter(function (c) {
    return c.severity === CONFLICT_SEVERITY.WARNING;
  });
  return {
    errors: errors,
    warnings: warnings,
    error_count: errors.length,
    warning_count: warnings.length,
    has_blocking: errors.length > 0,
  };
}
