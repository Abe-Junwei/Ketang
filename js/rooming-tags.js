/* Phase 9.1 夏季排房标签 | Summer rooming tag helpers (browser) */

var ACTIVITY_TARGET_OPTIONS = [
  "成人",
  "儿童",
  "亲子",
  "僧众",
  "义工",
  "师资",
  "外来客人",
  "混合",
];

var ROOM_TYPE_OPTIONS = [
  "学员房",
  "师资房",
  "客房",
  "义工房",
  "僧寮",
  "机动房",
];

var PARTICIPANT_IDENTITY_OPTIONS = [
  "学员",
  "师资",
  "客人",
  "义工",
  "僧人",
  "长住",
  "机动",
  "其他",
];

var AGE_GROUP_OPTIONS = ["成年", "老年", "儿童", "青少年"];

var BED_TYPE_OPTIONS = ["上铺", "下铺", "单床", "地铺", "折叠床", "机动床"];

function roomingIntOrZero(value) {
  var n = parseInt(value, 10);
  return isFinite(n) && n >= 0 ? n : 0;
}

function roomingOptionalInSet(value, options, label) {
  var v = value == null ? "" : String(value).trim();
  if (!v) return null;
  if (options.indexOf(v) === -1) throw new Error(label + "无效");
  return v;
}

function roomingFlag01(el) {
  return el && el.checked ? 1 : 0;
}

function roomingSelectHtml(id, options, selected, emptyLabel) {
  var html = '<select id="' + id + '">';
  if (emptyLabel !== false) {
    html +=
      '<option value="">' +
      escapeHtml(emptyLabel || "请选择") +
      "</option>";
  }
  options.forEach(function (opt) {
    html +=
      '<option value="' +
      escapeHtml(opt) +
      '"' +
      (opt === selected ? " selected" : "") +
      ">" +
      escapeHtml(opt) +
      "</option>";
  });
  html += "</select>";
  return html;
}

function roomingCheckboxField(id, label, checked) {
  return (
    '<label class="role-perm-item"><input type="checkbox" id="' +
    id +
    '"' +
    (checked ? " checked" : "") +
    "> " +
    escapeHtml(label) +
    "</label>"
  );
}

function readEventRoomingFromForm() {
  return {
    activity_target: roomingOptionalInSet(
      document.getElementById("event-activity-target")?.value,
      ACTIVITY_TARGET_OPTIONS,
      "活动对象",
    ),
    arrival_date: document.getElementById("event-arrival-date")?.value || null,
    departure_date: document.getElementById("event-departure-date")?.value || null,
    confirmed_count: roomingIntOrZero(
      document.getElementById("event-confirmed-count")?.value,
    ),
    actual_arrival_count: roomingIntOrZero(
      document.getElementById("event-actual-arrival-count")?.value,
    ),
    expected_absent_count: roomingIntOrZero(
      document.getElementById("event-expected-absent-count")?.value,
    ),
    male_count: roomingIntOrZero(document.getElementById("event-male-count")?.value),
    female_count: roomingIntOrZero(
      document.getElementById("event-female-count")?.value,
    ),
    child_count: roomingIntOrZero(
      document.getElementById("event-child-count")?.value,
    ),
    elder_count: roomingIntOrZero(
      document.getElementById("event-elder-count")?.value,
    ),
    teacher_count: roomingIntOrZero(
      document.getElementById("event-teacher-count")?.value,
    ),
    volunteer_count: roomingIntOrZero(
      document.getElementById("event-volunteer-count")?.value,
    ),
    special_needs_count: roomingIntOrZero(
      document.getElementById("event-special-needs-count")?.value,
    ),
    manager_name:
      document.getElementById("event-manager-name")?.value.trim() || null,
    manager_phone:
      document.getElementById("event-manager-phone")?.value.trim() || null,
    backup_manager_name:
      document.getElementById("event-backup-manager-name")?.value.trim() || null,
    needs_central_lodging: roomingFlag01(
      document.getElementById("event-needs-central-lodging"),
    ),
    needs_quiet_zone: roomingFlag01(
      document.getElementById("event-needs-quiet-zone"),
    ),
    needs_near_zen_hall: roomingFlag01(
      document.getElementById("event-needs-near-zen-hall"),
    ),
    needs_teacher_room: roomingFlag01(
      document.getElementById("event-needs-teacher-room"),
    ),
  };
}

function eventRoomingFormFieldsHtml(e) {
  var row = e || {};
  return (
    '<div class="rooming-section-title">夏季排房信息</div>' +
    '<div class="form-grid">' +
    infoField(
      "活动对象",
      roomingSelectHtml(
        "event-activity-target",
        ACTIVITY_TARGET_OPTIONS,
        row.activity_target || "",
      ),
      "event-activity-target",
    ) +
    infoField(
      "报到日期",
      '<input type="date" id="event-arrival-date" value="' +
        infoEscape(row.arrival_date || "") +
        '">',
      "event-arrival-date",
    ) +
    infoField(
      "离寺日期",
      '<input type="date" id="event-departure-date" value="' +
        infoEscape(row.departure_date || "") +
        '">',
      "event-departure-date",
    ) +
    infoField(
      "确认人数",
      '<input type="number" id="event-confirmed-count" min="0" value="' +
        (row.confirmed_count || 0) +
        '">',
      "event-confirmed-count",
    ) +
    infoField(
      "实到人数",
      '<input type="number" id="event-actual-arrival-count" min="0" value="' +
        (row.actual_arrival_count || 0) +
        '">',
      "event-actual-arrival-count",
    ) +
    infoField(
      "预计缺席",
      '<input type="number" id="event-expected-absent-count" min="0" value="' +
        (row.expected_absent_count || 0) +
        '">',
      "event-expected-absent-count",
    ) +
    infoField(
      "男众人数",
      '<input type="number" id="event-male-count" min="0" value="' +
        (row.male_count || 0) +
        '">',
      "event-male-count",
    ) +
    infoField(
      "女众人数",
      '<input type="number" id="event-female-count" min="0" value="' +
        (row.female_count || 0) +
        '">',
      "event-female-count",
    ) +
    infoField(
      "儿童人数",
      '<input type="number" id="event-child-count" min="0" value="' +
        (row.child_count || 0) +
        '">',
      "event-child-count",
    ) +
    infoField(
      "老人人数",
      '<input type="number" id="event-elder-count" min="0" value="' +
        (row.elder_count || 0) +
        '">',
      "event-elder-count",
    ) +
    infoField(
      "师资人数",
      '<input type="number" id="event-teacher-count" min="0" value="' +
        (row.teacher_count || 0) +
        '">',
      "event-teacher-count",
    ) +
    infoField(
      "义工人数",
      '<input type="number" id="event-volunteer-count" min="0" value="' +
        (row.volunteer_count || 0) +
        '">',
      "event-volunteer-count",
    ) +
    infoField(
      "特殊需求人数",
      '<input type="number" id="event-special-needs-count" min="0" value="' +
        (row.special_needs_count || 0) +
        '">',
      "event-special-needs-count",
    ) +
    infoField(
      "活动负责人",
      '<input type="text" id="event-manager-name" value="' +
        infoEscape(row.manager_name || "") +
        '">',
      "event-manager-name",
    ) +
    infoField(
      "负责人电话",
      '<input type="tel" id="event-manager-phone" value="' +
        infoEscape(row.manager_phone || "") +
        '">',
      "event-manager-phone",
    ) +
    infoField(
      "备用负责人",
      '<input type="text" id="event-backup-manager-name" value="' +
        infoEscape(row.backup_manager_name || "") +
        '">',
      "event-backup-manager-name",
    ) +
    '<div class="field field-span-all">' +
    '<label>住宿需求</label>' +
    '<div class="role-perm-grid">' +
    roomingCheckboxField(
      "event-needs-central-lodging",
      "需要集中住宿",
      !!row.needs_central_lodging,
    ) +
    roomingCheckboxField(
      "event-needs-quiet-zone",
      "需要静修区",
      !!row.needs_quiet_zone,
    ) +
    roomingCheckboxField(
      "event-needs-near-zen-hall",
      "需要靠近禅堂",
      !!row.needs_near_zen_hall,
    ) +
    roomingCheckboxField(
      "event-needs-teacher-room",
      "需要师资独立房",
      !!row.needs_teacher_room,
    ) +
    "</div></div></div>"
  );
}

function readParticipantTagsFromForm(prefix) {
  return {
    participant_identity: roomingOptionalInSet(
      document.getElementById(prefix + "-participant-identity")?.value,
      PARTICIPANT_IDENTITY_OPTIONS,
      "排房身份",
    ),
    age_group: roomingOptionalInSet(
      document.getElementById(prefix + "-age-group")?.value,
      AGE_GROUP_OPTIONS,
      "年龄段",
    ),
    special_needs:
      document.getElementById(prefix + "-special-needs")?.value.trim() || null,
  };
}

function participantTagFieldsHtml(prefix, row) {
  var data = row || {};
  return (
    infoField(
      "排房身份",
      roomingSelectHtml(
        prefix + "-participant-identity",
        PARTICIPANT_IDENTITY_OPTIONS,
        data.participant_identity || "",
      ),
      prefix + "-participant-identity",
    ) +
    infoField(
      "年龄段",
      roomingSelectHtml(
        prefix + "-age-group",
        AGE_GROUP_OPTIONS,
        data.age_group || "",
      ),
      prefix + "-age-group",
    ) +
    '<div class="field field-span-all">' +
    '<label>特殊需求（排房）</label>' +
    '<textarea id="' +
    prefix +
    '-special-needs" rows="2" placeholder="如：下铺、安静、行动不便">' +
    escapeHtml(data.special_needs || "") +
    "</textarea></div>"
  );
}

function roomTagFieldsHtml(r) {
  var row = r || {};
  return (
    infoField(
      "房间类型",
      roomingSelectHtml("info-room-type", ROOM_TYPE_OPTIONS, row.room_type || "学员房", false),
      "info-room-type",
    ) +
    '<div class="field field-span-all"><label>排房标签</label><div class="role-perm-grid">' +
    roomingCheckboxField("info-room-suitable-elder", "适合老人", !!row.suitable_elder) +
    roomingCheckboxField("info-room-suitable-child", "适合儿童", !!row.suitable_child) +
    roomingCheckboxField("info-room-near-zen", "靠近禅堂", !!row.near_zen_hall) +
    roomingCheckboxField("info-room-flexible", "机动/可转换", !!row.flexible_use) +
    "</div></div>"
  );
}

function bedTagFieldsHtml(b) {
  var row = b || {};
  return (
    infoField(
      "床位类型",
      roomingSelectHtml("info-bed-type", BED_TYPE_OPTIONS, row.bed_type || "单床", false),
      "info-bed-type",
    ) +
    '<div class="field field-span-all"><label>排房标签</label><div class="role-perm-grid">' +
    roomingCheckboxField("info-bed-suitable-elder", "适合老人", !!row.suitable_elder) +
    roomingCheckboxField("info-bed-flexible", "机动床", !!row.is_flexible) +
    "</div></div>"
  );
}

function readRoomTagFieldsFromForm() {
  return {
    room_type:
      roomingOptionalInSet(
        document.getElementById("info-room-type")?.value,
        ROOM_TYPE_OPTIONS,
        "房间类型",
      ) || "学员房",
    suitable_elder: roomingFlag01(document.getElementById("info-room-suitable-elder")),
    suitable_child: roomingFlag01(document.getElementById("info-room-suitable-child")),
    near_zen_hall: roomingFlag01(document.getElementById("info-room-near-zen")),
    flexible_use: roomingFlag01(document.getElementById("info-room-flexible")),
  };
}

function readBedTagFieldsFromForm() {
  return {
    bed_type:
      roomingOptionalInSet(
        document.getElementById("info-bed-type")?.value,
        BED_TYPE_OPTIONS,
        "床位类型",
      ) || "单床",
    suitable_elder: roomingFlag01(document.getElementById("info-bed-suitable-elder")),
    is_flexible: roomingFlag01(document.getElementById("info-bed-flexible")),
  };
}

function mountParticipantTagSelects() {
  populateParticipantTagSelects("ci");
  populateParticipantTagSelects("resv");
  ["ci-participant-identity", "ci-age-group", "resv-participant-identity", "resv-age-group"].forEach(
    function (id) {
      var el = document.getElementById(id);
      if (el && typeof rebuildSelectPicker === "function") rebuildSelectPicker(el);
    },
  );
}

function populateParticipantTagSelects(prefix, row) {
  row = row || {};
  fillRoomingSelect(
    document.getElementById(prefix + "-participant-identity"),
    PARTICIPANT_IDENTITY_OPTIONS,
    row.participant_identity || "",
  );
  fillRoomingSelect(
    document.getElementById(prefix + "-age-group"),
    AGE_GROUP_OPTIONS,
    row.age_group || "",
  );
  var needs = document.getElementById(prefix + "-special-needs");
  if (needs) needs.value = row.special_needs || "";
  [prefix + "-participant-identity", prefix + "-age-group"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && typeof refreshSelectPicker === "function") refreshSelectPicker(el);
  });
}

function fillRoomingSelect(el, options, selected) {
  if (!el) return;
  var html = '<option value="">请选择</option>';
  options.forEach(function (opt) {
    html +=
      '<option value="' +
      escapeHtml(opt) +
      '"' +
      (opt === selected ? " selected" : "") +
      ">" +
      escapeHtml(opt) +
      "</option>";
  });
  el.innerHTML = html;
  if (typeof rebuildSelectPicker === "function") rebuildSelectPicker(el);
}

var EVENT_ROOMING_DB_COLUMNS =
  "activity_target, arrival_date, departure_date, confirmed_count, actual_arrival_count, expected_absent_count, male_count, female_count, child_count, elder_count, teacher_count, volunteer_count, special_needs_count, manager_name, manager_phone, backup_manager_name, needs_central_lodging, needs_quiet_zone, needs_near_zen_hall, needs_teacher_room";

function eventRoomingDbValues(data) {
  var row = data || {};
  return [
    row.activity_target || null,
    row.arrival_date || null,
    row.departure_date || null,
    roomingIntOrZero(row.confirmed_count),
    roomingIntOrZero(row.actual_arrival_count),
    roomingIntOrZero(row.expected_absent_count),
    roomingIntOrZero(row.male_count),
    roomingIntOrZero(row.female_count),
    roomingIntOrZero(row.child_count),
    roomingIntOrZero(row.elder_count),
    roomingIntOrZero(row.teacher_count),
    roomingIntOrZero(row.volunteer_count),
    roomingIntOrZero(row.special_needs_count),
    row.manager_name || null,
    row.manager_phone || null,
    row.backup_manager_name || null,
    row.needs_central_lodging ? 1 : 0,
    row.needs_quiet_zone ? 1 : 0,
    row.needs_near_zen_hall ? 1 : 0,
    row.needs_teacher_room ? 1 : 0,
  ];
}
