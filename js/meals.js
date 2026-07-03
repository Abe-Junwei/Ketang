/* ============================================================
   用斋统计与记录 | Meal tracking & daily stats
   ============================================================ */

const MEAL_TYPES = ["breakfast", "lunch", "dinner"];
const MEAL_LABELS = { breakfast: "早斋", lunch: "午斋", dinner: "药石" };
const MEAL_SHORT = { breakfast: "早", lunch: "午", dinner: "药" };

function compareMealRoles(a, b) {
  return compareLodgerRoles(a, b);
}

function reservationMealFlags(r) {
  if (!r) return { breakfast: 1, lunch: 1, dinner: 1 };
  if (
    r.meal_breakfast == null &&
    r.meal_lunch == null &&
    r.meal_dinner == null
  ) {
    return { breakfast: 1, lunch: 1, dinner: 1 };
  }
  return {
    breakfast: r.meal_breakfast ? 1 : 0,
    lunch: r.meal_lunch ? 1 : 0,
    dinner: r.meal_dinner ? 1 : 0,
  };
}

function formatMealNeedLabel(breakfast, lunch, dinner) {
  if (!breakfast && !lunch && !dinner) return "无";
  const parts = [];
  if (breakfast) parts.push("早斋");
  if (lunch) parts.push("午斋");
  if (dinner) parts.push("药石");
  return parts.join("、");
}

function readMealCheckboxes(bfId, lcId, dnId) {
  return {
    breakfast: document.getElementById(bfId)?.checked ? 1 : 0,
    lunch: document.getElementById(lcId)?.checked ? 1 : 0,
    dinner: document.getElementById(dnId)?.checked ? 1 : 0,
  };
}

function closeAllMealNeedPickers() {
  document.querySelectorAll(".meal-need-picker.open").forEach(function (wrap) {
    wrap.classList.remove("open");
    const trigger = wrap.querySelector(".meal-need-picker-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    const panel = wrap.querySelector(".meal-need-picker-panel");
    if (panel) {
      panel.classList.remove("meal-need-picker-panel-fixed");
      panel.style.top = "";
      panel.style.left = "";
      panel.style.minWidth = "";
      panel.style.maxHeight = "";
    }
  });
}

function positionMealNeedPickerPanel(wrap) {
  const panel = wrap.querySelector(".meal-need-picker-panel");
  const trigger = wrap.querySelector(".meal-need-picker-trigger");
  if (!panel || !trigger) return;
  panel.classList.add("meal-need-picker-panel-fixed");
  panel.style.visibility = "hidden";
  panel.style.maxHeight = "";
  const tr = trigger.getBoundingClientRect();
  const pw = panel.offsetWidth;
  const ph = panel.offsetHeight;
  const gap = 4;
  let top = tr.bottom + gap;
  let left = tr.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;
  const spaceBelow = window.innerHeight - top - 8;
  const spaceAbove = tr.top - gap - 8;
  if (ph > spaceBelow && spaceAbove > spaceBelow) {
    top = Math.max(8, tr.top - Math.min(ph, spaceAbove) - gap);
    panel.style.maxHeight = Math.min(240, spaceAbove) + "px";
  } else {
    panel.style.maxHeight = Math.min(240, spaceBelow) + "px";
  }
  panel.style.top = top + "px";
  panel.style.left = left + "px";
  panel.style.minWidth = tr.width + "px";
  panel.style.visibility = "";
}

function toggleMealNeedPicker(triggerEl) {
  const wrap = triggerEl.closest(".meal-need-picker");
  if (!wrap) return;
  const wasOpen = wrap.classList.contains("open");
  closeAllMealNeedPickers();
  if (typeof closeAllSelectPickers === "function") closeAllSelectPickers();
  if (typeof closeBedActionMenus === "function") closeBedActionMenus();
  if (wasOpen) return;
  wrap.classList.add("open");
  triggerEl.setAttribute("aria-expanded", "true");
  positionMealNeedPickerPanel(wrap);
}

function refreshMealNeedPicker(wrapOrId) {
  const wrap =
    typeof wrapOrId === "string" ? document.getElementById(wrapOrId) : wrapOrId;
  if (!wrap) return;
  const meal = readMealNeedPicker(wrap.id);
  const labelEl = wrap.querySelector(".meal-need-picker-text");
  const trigger = wrap.querySelector(".meal-need-picker-trigger");
  if (labelEl)
    labelEl.textContent = formatMealNeedLabel(
      meal.breakfast,
      meal.lunch,
      meal.dinner,
    );
  if (trigger) {
    trigger.classList.toggle(
      "meal-need-picker-trigger-empty",
      !meal.breakfast && !meal.lunch && !meal.dinner,
    );
  }
  wrap
    .querySelectorAll('input[type="checkbox"][data-meal]')
    .forEach(function (cb) {
      const t = cb.dataset.meal;
      cb.checked = !!meal[t];
    });
}

function readMealNeedPicker(id) {
  const wrap = document.getElementById(id);
  if (!wrap) return { breakfast: 1, lunch: 1, dinner: 1 };
  const out = { breakfast: 0, lunch: 0, dinner: 0 };
  wrap
    .querySelectorAll('input[type="checkbox"][data-meal]')
    .forEach(function (cb) {
      out[cb.dataset.meal] = cb.checked ? 1 : 0;
    });
  return out;
}

function setMealNeedPicker(id, breakfast, lunch, dinner) {
  const wrap = document.getElementById(id);
  if (!wrap) return;
  const map = { breakfast: !!breakfast, lunch: !!lunch, dinner: !!dinner };
  wrap
    .querySelectorAll('input[type="checkbox"][data-meal]')
    .forEach(function (cb) {
      cb.checked = !!map[cb.dataset.meal];
    });
  refreshMealNeedPicker(wrap);
}

function validateMealNeedPicker(id, clearOnly) {
  const wrap = document.getElementById(id);
  const errEl = document.getElementById(id + "-error");
  const trigger = wrap && wrap.querySelector(".meal-need-picker-trigger");
  if (!wrap || wrap.dataset.required !== "1") {
    if (errEl) errEl.textContent = "";
    return true;
  }
  const meal = readMealNeedPicker(id);
  const ok = !!(meal.breakfast || meal.lunch || meal.dinner);
  if (errEl)
    errEl.textContent = ok || clearOnly ? "" : "请选择用斋需求（至少选一餐）";
  if (trigger) trigger.classList.toggle("invalid", !ok && !clearOnly);
  return ok;
}

function initMealNeedPickers(root) {
  root = root || document;
  root
    .querySelectorAll(".meal-need-picker:not([data-meal-picker-init])")
    .forEach(function (wrap) {
      wrap.setAttribute("data-meal-picker-init", "1");
      const trigger = wrap.querySelector(".meal-need-picker-trigger");
      wrap
        .querySelectorAll('input[type="checkbox"][data-meal]')
        .forEach(function (cb) {
          cb.addEventListener("change", function () {
            refreshMealNeedPicker(wrap);
            validateMealNeedPicker(wrap.id, true);
          });
          cb.addEventListener("click", function (e) {
            e.stopPropagation();
          });
        });
      if (trigger) {
        trigger.addEventListener("click", function (e) {
          e.stopPropagation();
          toggleMealNeedPicker(trigger);
        });
      }
      wrap
        .querySelectorAll(".meal-need-picker-option")
        .forEach(function (label) {
          label.addEventListener("click", function (e) {
            e.stopPropagation();
          });
        });
      refreshMealNeedPicker(wrap);
    });
}

function mealNeedPickerHtml(id, required) {
  const req = required ? ' data-required="1"' : "";
  return (
    '<div class="meal-need-picker" id="' +
    id +
    '"' +
    req +
    ">" +
    '<button type="button" class="meal-need-picker-trigger" aria-haspopup="listbox" aria-expanded="false">' +
    '<span class="meal-need-picker-text">早斋、午斋、药石</span>' +
    icon("chevron", "icon-xs meal-need-picker-chevron") +
    "</button>" +
    '<div class="meal-need-picker-panel ui-menu" role="listbox">' +
    '<label class="meal-need-picker-option ui-menu-item"><input type="checkbox" data-meal="breakfast" checked> 早斋</label>' +
    '<label class="meal-need-picker-option ui-menu-item"><input type="checkbox" data-meal="lunch" checked> 午斋</label>' +
    '<label class="meal-need-picker-option ui-menu-item"><input type="checkbox" data-meal="dinner" checked> 药石</label>' +
    "</div>" +
    "</div>"
  );
}

function setMealNeedPreset(bfId, lcId, dnId, preset) {
  const bf = document.getElementById(bfId);
  const lc = document.getElementById(lcId);
  const dn = document.getElementById(dnId);
  if (!bf || !lc || !dn) return;
  if (preset === "none") {
    bf.checked = false;
    lc.checked = false;
    dn.checked = false;
  } else if (preset === "bf") {
    bf.checked = true;
    lc.checked = false;
    dn.checked = false;
  } else if (preset === "lc") {
    bf.checked = false;
    lc.checked = true;
    dn.checked = false;
  } else if (preset === "dn") {
    bf.checked = false;
    lc.checked = false;
    dn.checked = true;
  } else if (preset === "bf_lc") {
    bf.checked = true;
    lc.checked = true;
    dn.checked = false;
  }
}

function getLodgerMealDefaults(lodgerOrId) {
  const l =
    typeof lodgerOrId === "object"
      ? lodgerOrId
      : typeof rcReadReady === "function" && rcReadReady()
        ? rcLodgerById(lodgerOrId)
        : query("SELECT * FROM lodgers WHERE id=?", [lodgerOrId])[0];
  if (!l) return { breakfast: 1, lunch: 1, dinner: 1 };
  if (
    l.meal_default_breakfast == null &&
    l.meal_default_lunch == null &&
    l.meal_default_dinner == null
  ) {
    var row =
      typeof rcReadReady === "function" && rcReadReady()
        ? rcRows("meals", "meals").find(function (m) {
            return m.lodger_id == l.id;
          })
        : query(
            "SELECT breakfast, lunch, dinner FROM meals WHERE lodger_id=? ORDER BY date LIMIT 1",
            [l.id],
          )[0];
    if (row) {
      return {
        breakfast: row.breakfast ? 1 : 0,
        lunch: row.lunch ? 1 : 0,
        dinner: row.dinner ? 1 : 0,
      };
    }
    return { breakfast: 1, lunch: 1, dinner: 1 };
  }
  return {
    breakfast: l.meal_default_breakfast ? 1 : 0,
    lunch: l.meal_default_lunch ? 1 : 0,
    dinner: l.meal_default_dinner ? 1 : 0,
  };
}

function setLodgerMealDefaults(lodgerId, breakfast, lunch, dinner) {
  run(
    "UPDATE lodgers SET meal_default_breakfast=?, meal_default_lunch=?, meal_default_dinner=? WHERE id=?",
    [breakfast ? 1 : 0, lunch ? 1 : 0, dinner ? 1 : 0, lodgerId],
  );
}

function getMealFlagsForDate(lodgerId, date) {
  const defaults = getLodgerMealDefaults(lodgerId);
  var row =
    typeof rcReadReady === "function" && rcReadReady()
      ? rcRows("meals", "meals").find(function (m) {
          return m.lodger_id == lodgerId && m.date === date;
        })
      : query(
          "SELECT breakfast, lunch, dinner FROM meals WHERE lodger_id=? AND date=?",
          [lodgerId, date],
        )[0];
  if (row)
    return { breakfast: row.breakfast, lunch: row.lunch, dinner: row.dinner };
  return {
    breakfast: defaults.breakfast,
    lunch: defaults.lunch,
    dinner: defaults.dinner,
  };
}

function getLodgerStayDates(l) {
  const start = l.check_in_date;
  if (!start) return [];
  const dates = [];
  let cur = new Date(start + "T12:00:00");
  if (isNaN(cur.getTime())) return [];
  let last;
  const checkout = l.actual_check_out || l.expected_check_out;
  if (checkout) {
    last = new Date(checkout + "T12:00:00");
    if (isNaN(last.getTime())) last = new Date(cur);
  } else if (l.status !== "在住") {
    // 非在住且无离院日期，只保留入住当天
    last = new Date(cur);
  } else {
    last = new Date(cur);
    last.setDate(last.getDate() + 6);
  }
  let safety = 0;
  while (cur <= last && safety < 366) {
    dates.push(formatLocalDate(cur));
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
  return dates;
}

function formatLodgerMealsToday(lodgerId) {
  const defaults = getLodgerMealDefaults(lodgerId);
  if (!defaults.breakfast && !defaults.lunch && !defaults.dinner)
    return "不用斋";
  const flags = getMealFlagsForDate(lodgerId, todayStr());
  const eating = [];
  const skipped = [];
  MEAL_TYPES.forEach(function (t) {
    if (!defaults[t]) return;
    if (flags[t]) eating.push(MEAL_SHORT[t]);
    else skipped.push(MEAL_SHORT[t]);
  });
  if (!skipped.length) return eating.join("·") || "默认";
  if (!eating.length) return "今日全跳过";
  return (
    eating.join("·") +
    ' <span class="meal-skip-hint">跳' +
    skipped.join("") +
    "</span>"
  );
}

function isLodgerInHouseOnDate(lodger, date) {
  if (!lodger || lodger.status !== "在住") return false;
  if (!lodger.check_in_date || lodger.check_in_date > date) return false;
  const checkout = lodger.actual_check_out || lodger.expected_check_out;
  if (checkout && checkout < date) return false;
  return true;
}

/** 某日用斋明细：仅统计当日在寺挂单 + 当日待入住预约 | Today-only in-house meal stats */
function getMealDayDetail(date) {
  if (!date) date = todayStr();
  const byRoleMap = {};
  function bumpRole(role, bf, lc, dn, countPerson, noEat) {
    const key = lodgerRoleCanon(role);
    if (!byRoleMap[key])
      byRoleMap[key] = { role: key, bf: 0, lc: 0, dn: 0, people: 0, noEat: 0 };
    byRoleMap[key].bf += bf || 0;
    byRoleMap[key].lc += lc || 0;
    byRoleMap[key].dn += dn || 0;
    if (countPerson) byRoleMap[key].people += 1;
    if (noEat) byRoleMap[key].noEat += 1;
  }

  const inHouse =
    typeof rcReadReady === "function" && rcReadReady()
      ? rcAllLodgersMerged().filter(function (l) {
          return l.status === "在住" && l.check_in_date <= date;
        })
      : query(
          `
    SELECT * FROM lodgers
    WHERE status = '在住' AND check_in_date <= ?
    ORDER BY role, name
  `,
          [date],
        );
  const skipped = [];
  let lodgerBf = 0;
  let lodgerLc = 0;
  let lodgerDn = 0;

  inHouse.forEach(function (l) {
    if (!isLodgerInHouseOnDate(l, date)) return;
    const defaults = getLodgerMealDefaults(l);
    const flags = getMealFlagsForDate(l.id, date);
    const role = l.role || "未分类";
    const eatsAny = !!(flags.breakfast || flags.lunch || flags.dinner);
    const eatsNone = !eatsAny;
    if (flags.breakfast) lodgerBf++;
    if (flags.lunch) lodgerLc++;
    if (flags.dinner) lodgerDn++;
    bumpRole(
      role,
      flags.breakfast,
      flags.lunch,
      flags.dinner,
      eatsAny,
      eatsNone,
    );

    const skippedMeals = [];
    MEAL_TYPES.forEach(function (t) {
      if (defaults[t] && !flags[t]) skippedMeals.push(MEAL_LABELS[t]);
    });
    if (skippedMeals.length) {
      skipped.push({
        id: l.id,
        displayName: personDisplayName(l),
        role: lodgerRoleDisplayName(role),
        skipped: skippedMeals,
      });
    }
  });

  let resvBf = 0;
  let resvLc = 0;
  let resvDn = 0;
  let resvCount = 0;
  var dayReservations =
    typeof rcReadReady === "function" && rcReadReady()
      ? rcRows("reservations", "reservations").filter(function (r) {
          return (
            r.expected_check_in === date &&
            (r.status === "预约" || r.status === "已确认")
          );
        })
      : query(
          `
    SELECT * FROM reservations
    WHERE expected_check_in = ? AND status IN ('预约', '已确认')
    ORDER BY role, name
  `,
          [date],
        );
  dayReservations.forEach(function (r) {
    const mf = reservationMealFlags(r);
    const role = r.role || "未分类";
    const eatsAny = !!(mf.breakfast || mf.lunch || mf.dinner);
    const eatsNone = !eatsAny;
    if (mf.breakfast) resvBf++;
    if (mf.lunch) resvLc++;
    if (mf.dinner) resvDn++;
    if (eatsAny) resvCount++;
    bumpRole(role, mf.breakfast, mf.lunch, mf.dinner, eatsAny, eatsNone);
  });

  skipped.sort(function (a, b) {
    const byRole = compareMealRoles(a, b);
    if (byRole !== 0) return byRole;
    return (a.displayName || "").localeCompare(b.displayName || "", "zh-CN");
  });

  const byRole = Object.values(byRoleMap).sort(compareMealRoles);

  return {
    date: date,
    bf: lodgerBf + resvBf,
    lc: lodgerLc + resvLc,
    dn: lodgerDn + resvDn,
    lodgerBf: lodgerBf,
    lodgerLc: lodgerLc,
    lodgerDn: lodgerDn,
    resvBf: resvBf,
    resvLc: resvLc,
    resvDn: resvDn,
    inHouseCount: inHouse.filter(function (l) {
      return isLodgerInHouseOnDate(l, date);
    }).length,
    resvCount: resvCount,
    byRole: byRole,
    skipped: skipped,
  };
}

/** 某日在寺挂单按房间用斋（不含已退；含当日待入住 → 待入住） */
function getMealDayByRoom(date) {
  if (!date) date = todayStr();
  const byRoomMap = {};
  function bump(roomKey, roomName, bf, lc, dn, countPerson) {
    if (!byRoomMap[roomKey]) {
      byRoomMap[roomKey] = {
        room_name: roomName,
        bf: 0,
        lc: 0,
        dn: 0,
        people: 0,
      };
    }
    byRoomMap[roomKey].bf += bf || 0;
    byRoomMap[roomKey].lc += lc || 0;
    byRoomMap[roomKey].dn += dn || 0;
    if (countPerson) byRoomMap[roomKey].people += 1;
  }

  query(
    `
    SELECT l.*, r.name as room_name, r.id as room_id
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.status = '在住' AND l.check_in_date <= ?
  `,
    [date],
  ).forEach(function (l) {
    if (!isLodgerInHouseOnDate(l, date)) return;
    const flags = getMealFlagsForDate(l.id, date);
    const eatsAny = !!(flags.breakfast || flags.lunch || flags.dinner);
    const roomKey = l.room_id ? "r" + l.room_id : "unassigned";
    bump(
      roomKey,
      l.room_name || "未分床",
      flags.breakfast,
      flags.lunch,
      flags.dinner,
      eatsAny,
    );
  });

  query(
    `
    SELECT * FROM reservations
    WHERE expected_check_in = ? AND status IN ('预约', '已确认')
  `,
    [date],
  ).forEach(function (r) {
    const mf = reservationMealFlags(r);
    const eatsAny = !!(mf.breakfast || mf.lunch || mf.dinner);
    bump("pending", "待入住", mf.breakfast, mf.lunch, mf.dinner, eatsAny);
  });

  return Object.values(byRoomMap).sort(function (a, b) {
    if (a.room_name === "待入住") return 1;
    if (b.room_name === "待入住") return -1;
    return String(a.room_name).localeCompare(String(b.room_name), "zh-CN");
  });
}

/** 月用斋合计：逐日累加 getMealDayDetail（与看板口径一致） */
function getMealMonthStats(month) {
  if (!month) return { bf: 0, lc: 0, dn: 0 };
  const parts = month.split("-");
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (!y || !m) return { bf: 0, lc: 0, dn: 0 };
  const daysInMonth = new Date(y, m, 0).getDate();
  let bf = 0;
  let lc = 0;
  let dn = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = month + "-" + String(d).padStart(2, "0");
    const detail = getMealDayDetail(dateStr);
    bf += detail.bf || 0;
    lc += detail.lc || 0;
    dn += detail.dn || 0;
  }
  return { bf: bf, lc: lc, dn: dn };
}

/** 某日厨房用斋合计（基于当日在寺明细） */
function getMealDayStats(date) {
  const d = getMealDayDetail(date);
  return {
    bf: d.bf,
    lc: d.lc,
    dn: d.dn,
    lodgerBf: d.lodgerBf,
    lodgerLc: d.lodgerLc,
    lodgerDn: d.lodgerDn,
    resvBf: d.resvBf,
    resvLc: d.resvLc,
    resvDn: d.resvDn,
    inHouseCount: d.inHouseCount,
    resvCount: d.resvCount,
    byRole: d.byRole,
    skipped: d.skipped,
  };
}

function mountFormMealNeedPickers() {
  const mounts = [
    ["ci-meal-need-wrap", "ci-meal-need"],
    ["batch-meal-need-wrap", "batch-meal-need"],
    ["resv-meal-need-wrap", "resv-meal-need"],
  ];
  mounts.forEach(function (pair) {
    const el = document.getElementById(pair[0]);
    if (el && !document.getElementById(pair[1]))
      el.innerHTML = mealNeedPickerHtml(pair[1], true);
  });
  initMealNeedPickers(document);
}

function getMealReportByRole(date) {
  return getMealDayDetail(date).byRole.slice();
}

function formatMealDaySubline(detail) {
  const parts = ["在寺 " + (detail.inHouseCount || 0) + " 人"];
  if (detail.resvCount) parts.push("待入住 " + detail.resvCount);
  const total = (detail.bf || 0) + (detail.lc || 0) + (detail.dn || 0);
  if (total) parts.push("合计 " + total + " 人次");
  const noEatTotal = (detail.byRole || []).reduce(function (sum, r) {
    return sum + (r.noEat || 0);
  }, 0);
  if (noEatTotal) parts.push("不用斋 " + noEatTotal + " 人");
  return parts.join(" · ");
}

function renderTodayMealsPanel() {
  const statsEl = document.getElementById("today-meals");
  const descEl = document.getElementById("today-meals-desc");
  if (!statsEl) return null;
  const detail = getMealDayDetail(todayStr());
  if (descEl)
    descEl.textContent =
      formatMealDaySubline(detail) || "统计当日在寺挂单与待入住预约";
  statsEl.innerHTML =
    '<div class="meal-stat meal-stat-bf"><span class="meal-stat-head">' +
    icon("dawn", "icon-xs") +
    '<span class="meal-stat-label">早斋</span></span><span class="meal-stat-num">' +
    (detail.bf || 0) +
    '</span><span class="meal-stat-unit">人次</span></div>' +
    '<div class="meal-stat meal-stat-lc"><span class="meal-stat-head">' +
    icon("sun", "icon-xs") +
    '<span class="meal-stat-label">午斋</span></span><span class="meal-stat-num">' +
    (detail.lc || 0) +
    '</span><span class="meal-stat-unit">人次</span></div>' +
    '<div class="meal-stat meal-stat-dn"><span class="meal-stat-head">' +
    icon("moon", "icon-xs") +
    '<span class="meal-stat-label">药石</span></span><span class="meal-stat-num">' +
    (detail.dn || 0) +
    '</span><span class="meal-stat-unit">人次</span></div>';
  renderMealsPanelDetail(detail);
  return detail;
}

function renderMealsPanelDetail(detail) {
  detail = detail || getMealDayDetail(todayStr());
  renderMealsPanelCharts(detail.byRole);
}

function renderMealPieSidePanel(rows, key, colors) {
  var itemsHtml = rows
    .map(function (r, i) {
      return (
        '<li class="meals-role-stat-item">' +
        '<span class="meals-role-stat-dot" style="background:' +
        escapeHtml(colors[i]) +
        '"></span>' +
        '<span class="meals-role-stat-name">' +
        escapeHtml(r.role) +
        "</span>" +
        '<span class="meals-role-stat-num">' +
        (r[key] || 0) +
        "</span>" +
        "</li>"
      );
    })
    .join("");
  if (!itemsHtml) return '<p class="meals-side-empty">暂无</p>';
  return (
    '<div class="meals-side-panel"><ul class="meals-role-stats">' +
    itemsHtml +
    "</ul></div>"
  );
}

function renderMealsPanelCharts(byRole) {
  if (
    typeof Chart === "undefined" ||
    typeof createKetangPieChart !== "function"
  )
    return;
  destroyKetangChartsByPrefix("meals-panel-");
  var T = getChartTheme();
  var specs = [
    {
      key: "bf",
      canvas: "chart-meals-bf",
      chartKey: "meals-panel-bf",
      statsId: "meals-role-stats-bf",
      title: "早斋",
    },
    {
      key: "lc",
      canvas: "chart-meals-lc",
      chartKey: "meals-panel-lc",
      statsId: "meals-role-stats-lc",
      title: "午斋",
    },
    {
      key: "dn",
      canvas: "chart-meals-dn",
      chartKey: "meals-panel-dn",
      statsId: "meals-role-stats-dn",
      title: "药石",
    },
  ];
  specs.forEach(function (spec) {
    var rows = byRole
      .filter(function (r) {
        return (r[spec.key] || 0) > 0;
      })
      .sort(compareMealRoles);
    var labels = rows.length
      ? rows.map(function (r) {
          return r.role;
        })
      : ["暂无"];
    var data = rows.length
      ? rows.map(function (r) {
          return r[spec.key];
        })
      : [1];
    var colors = rows.length ? getChartColors(labels.length) : [T.muted];
    var statsEl = document.getElementById(spec.statsId);
    if (statsEl)
      statsEl.innerHTML = renderMealPieSidePanel(rows, spec.key, colors);
    createKetangPieChart(spec.chartKey, spec.canvas, {
      type: "pie",
      data: {
        labels: labels,
        datasets: [
          {
            label: spec.title,
            data: data,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: T.card,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: { enabled: rows.length > 0 },
        },
      },
    });
  });
}

function openMealModal(lodgerId) {
  const l = query(
    `
    SELECT l.*, r.name as room_name, b.bed_number
    FROM lodgers l
    LEFT JOIN beds b ON b.id=l.bed_id
    LEFT JOIN rooms r ON r.id=b.room_id
    WHERE l.id=?`,
    [lodgerId],
  )[0];
  if (!l) return;
  const defaults = getLodgerMealDefaults(l);
  const label = escapeHtml(
    (l.room_name || "-") + (l.bed_number ? " / " + l.bed_number : ""),
  );
  const modal = document.getElementById("modal");
  document.getElementById("modal-title").textContent =
    "用斋管理 - " + escapeHtml(personDisplayName(l));
  setModalBody(`
    <div class="modal-form meal-modal">
      <div class="modal-summary">
        <p><span class="modal-summary-label">床位</span>${label}</p>
        <p><span class="modal-summary-label">入住</span>${escapeHtml(l.check_in_date || "-")} 至 ${escapeHtml(l.expected_check_out || "未设")}</p>
      </div>
      <div class="meal-defaults-section">
        <label class="meal-section-label">默认用斋（未跳过时按此用餐）</label>
        <div class="meal-defaults">
          <label><input type="checkbox" id="lm-def-bf" ${defaults.breakfast ? "checked" : ""} onchange="renderMealGrid(${lodgerId})"> 早斋</label>
          <label><input type="checkbox" id="lm-def-lc" ${defaults.lunch ? "checked" : ""} onchange="renderMealGrid(${lodgerId})"> 午斋</label>
          <label><input type="checkbox" id="lm-def-dn" ${defaults.dinner ? "checked" : ""} onchange="renderMealGrid(${lodgerId})"> 药石</label>
        </div>
      </div>
      <p class="meal-modal-hint">下方勾选「跳过」表示该日不用此餐；未勾则按默认用餐。</p>
      <div class="meal-toolbar">
        <button type="button" class="btn btn-sm" onclick="mealGridResetSkips()">全部恢复默认</button>
        <button type="button" class="btn btn-sm" onclick="mealGridSkipToday()">今日全部跳过</button>
      </div>
      <div class="meal-grid-scroll">
        <table class="meal-schedule-table">
          <thead>
            <tr><th>日期</th><th>早斋</th><th>午斋</th><th>药石</th></tr>
          </thead>
          <tbody id="meal-grid-body"></tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" onclick="submitMeals(${lodgerId})">保存用斋</button>
      </div>
    </div>
  `);
  renderMealGrid(lodgerId);
  modal.classList.add("active");
}

function readMealModalDefaults() {
  return {
    breakfast: document.getElementById("lm-def-bf")?.checked ? 1 : 0,
    lunch: document.getElementById("lm-def-lc")?.checked ? 1 : 0,
    dinner: document.getElementById("lm-def-dn")?.checked ? 1 : 0,
  };
}

function renderMealGrid(lodgerId) {
  const tbody = document.getElementById("meal-grid-body");
  if (!tbody) return;
  const l = query("SELECT * FROM lodgers WHERE id=?", [lodgerId])[0];
  if (!l) return;
  const dates = getLodgerStayDates(l);
  if (!dates.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty-tip">未记录入住日期</td></tr>';
    return;
  }
  const defaults = readMealModalDefaults();
  const meals = {};
  query("SELECT * FROM meals WHERE lodger_id=?", [lodgerId]).forEach(
    function (m) {
      meals[m.date] = m;
    },
  );
  const today = todayStr();
  tbody.innerHTML = dates
    .map(function (d) {
      const stored = meals[d];
      const flags = stored
        ? {
            breakfast: stored.breakfast,
            lunch: stored.lunch,
            dinner: stored.dinner,
          }
        : {
            breakfast: defaults.breakfast,
            lunch: defaults.lunch,
            dinner: defaults.dinner,
          };
      const cells = MEAL_TYPES.map(function (t) {
        if (!defaults[t]) return '<td class="meal-na">—</td>';
        const skipped = !flags[t];
        return (
          '<td><label class="meal-skip-label' +
          (skipped ? " is-skipped" : "") +
          '">' +
          '<input type="checkbox" class="meal-skip-cb" data-date="' +
          d +
          '" data-type="' +
          t +
          '"' +
          (skipped ? " checked" : "") +
          " onchange=\"this.parentElement.classList.toggle('is-skipped', this.checked)\"> 跳过" +
          "</label></td>"
        );
      }).join("");
      const isToday = d === today;
      return (
        '<tr class="meal-day-row' +
        (isToday ? " meal-day-today" : "") +
        '" data-date="' +
        d +
        '">' +
        '<td class="meal-date-cell">' +
        (isToday ? '<span class="meal-today-tag">今</span> ' : "") +
        escapeHtml(d.slice(5)) +
        "</td>" +
        cells +
        "</tr>"
      );
    })
    .join("");
}

function mealGridResetSkips() {
  document.querySelectorAll(".meal-skip-cb").forEach(function (cb) {
    cb.checked = false;
    const label = cb.parentElement;
    if (label) label.classList.remove("is-skipped");
  });
}

function mealGridSkipToday() {
  const today = todayStr();
  document
    .querySelectorAll('.meal-day-row[data-date="' + today + '"] .meal-skip-cb')
    .forEach(function (cb) {
      cb.checked = true;
      const label = cb.parentElement;
      if (label) label.classList.add("is-skipped");
    });
}

async function submitMeals(lodgerId) {
  const defaults = readMealModalDefaults();
  if (isLocalForceDb()) {
    setLodgerMealDefaults(
      lodgerId,
      defaults.breakfast,
      defaults.lunch,
      defaults.dinner,
    );
  }
  const l =
    typeof rcReadReady === "function" && rcReadReady()
      ? rcLodgerById(lodgerId)
      : query("SELECT * FROM lodgers WHERE id=?", [lodgerId])[0];
  if (!l) {
    alert("找不到该挂单记录");
    return;
  }
  const map = {};
  document.querySelectorAll(".meal-skip-cb").forEach(function (cb) {
    const d = cb.dataset.date;
    const t = cb.dataset.type;
    if (!map[d]) map[d] = { breakfast: 0, lunch: 0, dinner: 0 };
    map[d][t] = defaults[t] && !cb.checked ? 1 : 0;
  });
  getLodgerStayDates(l).forEach(function (d) {
    if (map[d]) return;
    map[d] = {
      breakfast: defaults.breakfast ? 1 : 0,
      lunch: defaults.lunch ? 1 : 0,
      dinner: defaults.dinner ? 1 : 0,
    };
  });
  try {
    var writeResult = null;
    if (isLocalForceDb()) {
      await withTransaction(async () => {
        Object.entries(map).forEach(function (entry) {
          const date = entry[0];
          const vals = entry[1];
          run(
            "INSERT OR REPLACE INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
            [lodgerId, date, vals.breakfast, vals.lunch, vals.dinner],
          );
        });
        logAudit("保存用斋设置", "lodger", lodgerId, {
          name: personDisplayName(l),
          defaults: defaults,
          affected_dates: Object.keys(map).length,
        });
      });
      await saveDB();
    } else {
      const days = {};
      document.querySelectorAll(".meal-skip-cb").forEach(function (cb) {
        const d = cb.dataset.date;
        const t = cb.dataset.type;
        if (!days[d]) days[d] = { breakfast: 0, lunch: 0, dinner: 0 };
        days[d][t] = defaults[t] && !cb.checked ? 1 : 0;
      });
      getLodgerStayDates(l).forEach(function (d) {
        if (days[d]) return;
        days[d] = {
          breakfast: defaults.breakfast ? 1 : 0,
          lunch: defaults.lunch ? 1 : 0,
          dinner: defaults.dinner ? 1 : 0,
        };
      });
      writeResult = await apiSaveMeals({
        lodger_id: lodgerId,
        defaults: defaults,
        days: days,
      });
    }
    closeModal();
    showToast("用斋设置已保存");
    rcRefreshAfterWrite(writeResult);
  } catch (e) {
    console.error(e);
    alert("保存用斋设置失败：" + e.message);
  }
}

function generateMeals(lodgerId, startDate, endDate, breakfast, lunch, dinner) {
  if (!startDate) return;
  const start = new Date(startDate + "T12:00:00");
  if (isNaN(start.getTime())) {
    console.warn(
      "generateMeals: 无效的入住日期 | invalid check-in date:",
      startDate,
    );
    return;
  }
  let end;
  if (endDate) {
    end = new Date(endDate + "T12:00:00");
    if (isNaN(end.getTime())) {
      console.warn(
        "generateMeals: 无效的预离日期 | invalid expected checkout date:",
        endDate,
      );
      return;
    }
  } else {
    end = new Date(start);
    end.setDate(end.getDate() + 6);
  }
  const bf = breakfast ? 1 : 0;
  const lc = lunch ? 1 : 0;
  const dn = dinner ? 1 : 0;
  setLodgerMealDefaults(lodgerId, bf, lc, dn);
  let cur = new Date(start);
  let safety = 0;
  while (cur <= end && safety < 366) {
    const d = formatLocalDate(cur);
    // INSERT OR IGNORE 避免覆盖用户已手动设置的跳过记录
    run(
      "INSERT OR IGNORE INTO meals (lodger_id, date, breakfast, lunch, dinner) VALUES (?, ?, ?, ?, ?)",
      [lodgerId, d, bf, lc, dn],
    );
    cur.setDate(cur.getDate() + 1);
    safety++;
  }
}

/** 挂单尚无 meals 记录时补生成（如仅登记未分床） */
async function ensureLodgerMeals(lodgerId, breakfast, lunch, dinner) {
  const l = query("SELECT * FROM lodgers WHERE id=?", [lodgerId])[0];
  if (!l || l.status !== "在住") return;
  const count =
    query("SELECT COUNT(*) as c FROM meals WHERE lodger_id=?", [lodgerId])[0]
      ?.c || 0;
  if (count > 0) return;
  const flags =
    breakfast != null
      ? { breakfast: breakfast, lunch: lunch, dinner: dinner }
      : getLodgerMealDefaults(l);
  await generateMeals(
    lodgerId,
    l.check_in_date,
    l.expected_check_out,
    flags.breakfast,
    flags.lunch,
    flags.dinner,
  );
}

function getMealSummary(lodgerId) {
  const defaults = getLodgerMealDefaults(lodgerId);
  const rows = query("SELECT * FROM meals WHERE lodger_id=?", [lodgerId]);
  let bf = 0;
  let lc = 0;
  let dn = 0;
  rows.forEach(function (r) {
    if (r.breakfast) bf++;
    if (r.lunch) lc++;
    if (r.dinner) dn++;
  });
  return {
    breakfast: bf,
    lunch: lc,
    dinner: dn,
    total: rows.length,
    defaults: defaults,
  };
}
