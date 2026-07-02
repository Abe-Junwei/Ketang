/** Phase 9.1 夏季排房标签常量与解析 | Summer rooming tag constants */

export const ACTIVITY_TARGET_OPTIONS = [
  "成人",
  "儿童",
  "亲子",
  "僧众",
  "义工",
  "师资",
  "外来客人",
  "混合",
];

export const ROOM_TYPE_OPTIONS = [
  "学员房",
  "师资房",
  "客房",
  "义工房",
  "僧寮",
  "机动房",
];

export const PARTICIPANT_IDENTITY_OPTIONS = [
  "学员",
  "师资",
  "客人",
  "义工",
  "僧人",
  "长住",
  "机动",
  "其他",
];

export const AGE_GROUP_OPTIONS = ["成年", "老年", "儿童", "青少年"];

export const BED_TYPE_OPTIONS = [
  "上铺",
  "下铺",
  "单床",
  "地铺",
  "折叠床",
  "机动床",
];

export function text(value) {
  const v = value == null ? "" : String(value).trim();
  return v || null;
}

export function intOrZero(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** 招生阶段人数可留空 | Optional headcount (null = unknown) */
export function intOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("人数须为非负整数，或留空表示暂未确定");
  }
  return n;
}

export function flag01(value) {
  return value === true || value === 1 || value === "1" ? 1 : 0;
}

export function assertOptionalInSet(value, options, label) {
  const v = text(value);
  if (!v) return null;
  if (!options.includes(v)) throw new Error(`${label}无效`);
  return v;
}

export function parseEventRoomingFields(body) {
  return {
    activity_target: assertOptionalInSet(
      body.activity_target,
      ACTIVITY_TARGET_OPTIONS,
      "活动对象",
    ),
    arrival_date: text(body.arrival_date),
    departure_date: text(body.departure_date),
    confirmed_count: intOrNull(body.confirmed_count),
    actual_arrival_count: intOrNull(body.actual_arrival_count),
    expected_absent_count: intOrNull(body.expected_absent_count),
    male_count: intOrNull(body.male_count),
    female_count: intOrNull(body.female_count),
    child_count: intOrNull(body.child_count),
    elder_count: intOrNull(body.elder_count),
    teacher_count: intOrNull(body.teacher_count),
    volunteer_count: intOrNull(body.volunteer_count),
    special_needs_count: intOrNull(body.special_needs_count),
    manager_name: text(body.manager_name),
    manager_phone: text(body.manager_phone),
    backup_manager_name: text(body.backup_manager_name),
    needs_central_lodging: flag01(body.needs_central_lodging),
    needs_quiet_zone: flag01(body.needs_quiet_zone),
    needs_near_zen_hall: flag01(body.needs_near_zen_hall),
    needs_teacher_room: flag01(body.needs_teacher_room),
  };
}

export function parseRoomTagFields(body) {
  return {
    room_type:
      assertOptionalInSet(body.room_type, ROOM_TYPE_OPTIONS, "房间类型") ||
      "学员房",
    suitable_elder: flag01(body.suitable_elder),
    suitable_child: flag01(body.suitable_child),
    near_zen_hall: flag01(body.near_zen_hall),
    flexible_use: flag01(body.flexible_use),
  };
}

export function parseBedTagFields(body) {
  return {
    bed_type:
      assertOptionalInSet(body.bed_type, BED_TYPE_OPTIONS, "床位类型") ||
      "单床",
    suitable_elder: flag01(body.suitable_elder),
    is_flexible: flag01(body.is_flexible),
  };
}

export function parseParticipantTagFields(body) {
  return {
    participant_identity: assertOptionalInSet(
      body.participant_identity,
      PARTICIPANT_IDENTITY_OPTIONS,
      "排房身份",
    ),
    age_group: assertOptionalInSet(body.age_group, AGE_GROUP_OPTIONS, "年龄段"),
    special_needs: text(body.special_needs),
  };
}

export const EVENT_ROOMING_COLUMN_NAMES = [
  "activity_target",
  "arrival_date",
  "departure_date",
  "confirmed_count",
  "actual_arrival_count",
  "expected_absent_count",
  "male_count",
  "female_count",
  "child_count",
  "elder_count",
  "teacher_count",
  "volunteer_count",
  "special_needs_count",
  "manager_name",
  "manager_phone",
  "backup_manager_name",
  "needs_central_lodging",
  "needs_quiet_zone",
  "needs_near_zen_hall",
  "needs_teacher_room",
];

export const EVENT_ROOMING_COLUMN_SQL = EVENT_ROOMING_COLUMN_NAMES.join(", ");

export const EVENT_ROOMING_SET_SQL = EVENT_ROOMING_COLUMN_NAMES.map(
  function (col) {
    return col + "=?";
  },
).join(", ");

export function eventRoomingValues(rooming) {
  return [
    rooming.activity_target,
    rooming.arrival_date,
    rooming.departure_date,
    rooming.confirmed_count,
    rooming.actual_arrival_count,
    rooming.expected_absent_count,
    rooming.male_count,
    rooming.female_count,
    rooming.child_count,
    rooming.elder_count,
    rooming.teacher_count,
    rooming.volunteer_count,
    rooming.special_needs_count,
    rooming.manager_name,
    rooming.manager_phone,
    rooming.backup_manager_name,
    rooming.needs_central_lodging,
    rooming.needs_quiet_zone,
    rooming.needs_near_zen_hall,
    rooming.needs_teacher_room,
  ];
}
