/* Phase 9.2 夏季容量预测 | Summer capacity forecast on board */

var CAPACITY_ACTIVE_EVENT_STATUSES = ["筹备中", "招生中", "进行中"];

function capacityFormatDate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function capacityAddDays(dateStr, days) {
  var d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return capacityFormatDate(d);
}

function capacityDayInEventRange(evt, day) {
  var start = evt.arrival_date || evt.start_date;
  var end = evt.departure_date || evt.end_date;
  if (!start || day < start) return false;
  if (end && day > end) return false;
  return true;
}

function capacityIntOrZero(value) {
  var n = parseInt(value, 10);
  return isFinite(n) && n >= 0 ? n : 0;
}

function capacityCountDemographics(people) {
  var stats = { child: 0, elder: 0, teacher: 0, volunteer: 0 };
  people.forEach(function (p) {
    if (!p) return;
    if (p.age_group === "儿童" || p.age_group === "青少年") stats.child++;
    if (p.age_group === "老年") stats.elder++;
    if (p.participant_identity === "师资") stats.teacher++;
    if (p.participant_identity === "义工") stats.volunteer++;
  });
  return stats;
}

function capacityRegisteredOnDay(eventId, day) {
  if (roomingReadReady()) {
    var lodgers = rcAllLodgersMerged()
      .filter(function (l) {
        return (
          l.event_id == eventId &&
          l.status === "在住" &&
          l.check_in_date <= day &&
          (!l.expected_check_out || l.expected_check_out > day)
        );
      })
      .map(function (l) {
        return {
          gender: l.gender,
          participant_identity: l.participant_identity,
          age_group: l.age_group,
        };
      });
    var reservations = rcRows("reservations", "reservations")
      .filter(function (r) {
        return (
          r.event_id == eventId &&
          (r.status === "预约" || r.status === "已确认") &&
          r.expected_check_in <= day &&
          (!r.expected_check_out || r.expected_check_out > day)
        );
      })
      .map(function (r) {
        return {
          gender: r.gender,
          participant_identity: r.participant_identity,
          age_group: r.age_group,
        };
      });
    var all = lodgers.concat(reservations);
    return {
      all: all,
      male: all.filter(function (p) {
        return p.gender === "男";
      }).length,
      female: all.filter(function (p) {
        return p.gender === "女";
      }).length,
      demo: capacityCountDemographics(all),
    };
  }
  if (!roomingUseLocalRead()) {
    return { all: [], male: 0, female: 0, demo: capacityCountDemographics([]) };
  }
  var lodgers = query(
    "SELECT gender, participant_identity, age_group FROM lodgers WHERE event_id=? AND status='在住' AND check_in_date <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)",
    [eventId, day, day],
  );
  var reservations = query(
    "SELECT gender, participant_identity, age_group FROM reservations WHERE event_id=? AND status IN ('预约','已确认') AND expected_check_in <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)",
    [eventId, day, day],
  );
  var all = lodgers.concat(reservations);
  return {
    all: all,
    male: all.filter(function (p) {
      return p.gender === "男";
    }).length,
    female: all.filter(function (p) {
      return p.gender === "女";
    }).length,
    demo: capacityCountDemographics(all),
  };
}

function capacityEventTargets(evt, registered) {
  var reg = registered.all.length;
  var regMale = registered.male;
  var regFemale = registered.female;
  var targetMale = capacityIntOrZero(evt.male_count);
  var targetFemale = capacityIntOrZero(evt.female_count);
  var targetChild = capacityIntOrZero(evt.child_count);
  var targetElder = capacityIntOrZero(evt.elder_count);
  var targetTeacher = capacityIntOrZero(evt.teacher_count);
  var targetVolunteer = capacityIntOrZero(evt.volunteer_count);
  var demographicSum =
    targetMale +
    targetFemale +
    targetChild +
    targetElder +
    targetTeacher +
    targetVolunteer;
  var targetTotal = Math.max(
    capacityIntOrZero(evt.expected_count),
    capacityIntOrZero(evt.confirmed_count),
  );
  if (demographicSum > 0) targetTotal = Math.max(targetTotal, demographicSum);

  if (evt.gender_type === "男众") {
    targetMale = Math.max(targetMale, targetTotal);
    targetFemale = 0;
  } else if (evt.gender_type === "女众") {
    targetFemale = Math.max(targetFemale, targetTotal);
    targetMale = 0;
  } else if (demographicSum === 0 && reg < targetTotal) {
    var remaining = targetTotal - reg;
    var maleRatio = reg > 0 ? regMale / reg : 0.5;
    var addMale = Math.round(remaining * maleRatio);
    targetMale = Math.max(targetMale, regMale + addMale);
    targetFemale = Math.max(targetFemale, regFemale + (remaining - addMale));
  } else {
    targetMale = Math.max(targetMale, regMale);
    targetFemale = Math.max(targetFemale, regFemale);
    targetChild = Math.max(targetChild, registered.demo.child);
    targetElder = Math.max(targetElder, registered.demo.elder);
    targetTeacher = Math.max(targetTeacher, registered.demo.teacher);
    targetVolunteer = Math.max(targetVolunteer, registered.demo.volunteer);
  }

  return {
    male: targetMale,
    female: targetFemale,
    child: targetChild,
    elder: targetElder,
    teacher: targetTeacher,
    volunteer: targetVolunteer,
    total: Math.max(targetTotal, targetMale + targetFemale),
  };
}

function getCapacityBedTotals(includeSpare) {
  if (roomingReadReady()) {
    var male = 0;
    var female = 0;
    var flex = 0;
    rcBoardBeds().forEach(function (b) {
      if (b.status === "维修" || b.status === "备用") return;
      var room = rcBoardRooms().find(function (r) {
        return r.id == b.room_id;
      });
      if (!room) return;
      if (
        typeof isSpareRoom === "function" &&
        isSpareRoom(room) &&
        !includeSpare
      )
        return;
      if (room.dorm_type === "男寮") male++;
      else if (room.dorm_type === "女寮") female++;
      else if (room.dorm_type === "不限") flex++;
    });
    return {
      male: male,
      female: female,
      flex: flex,
      total: male + female + flex,
    };
  }
  if (!roomingUseLocalRead()) {
    return { male: 0, female: 0, flex: 0, total: 0 };
  }
  var spareSql = spareRoomExcludeClause("r", !!includeSpare);
  var base =
    " FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.status!='维修' AND b.status!='备用' AND " +
    spareSql;
  return {
    male:
      query("SELECT COUNT(*) as c" + base + " AND r.dorm_type='男寮'")[0]?.c ||
      0,
    female:
      query("SELECT COUNT(*) as c" + base + " AND r.dorm_type='女寮'")[0]?.c ||
      0,
    flex:
      query("SELECT COUNT(*) as c" + base + " AND r.dorm_type='不限'")[0]?.c ||
      0,
    total: query("SELECT COUNT(*) as c" + base)[0]?.c || 0,
  };
}

function loadCapacityActiveEvents() {
  if (roomingReadReady()) {
    return rcRows("events", "events")
      .filter(function (evt) {
        return CAPACITY_ACTIVE_EVENT_STATUSES.indexOf(evt.status) !== -1;
      })
      .sort(function (a, b) {
        var sa = a.arrival_date || a.start_date || "";
        var sb = b.arrival_date || b.start_date || "";
        if (sa !== sb) return sa.localeCompare(sb);
        return (a.name || "").localeCompare(b.name || "", "zh-CN");
      });
  }
  if (!roomingUseLocalRead()) return [];
  return query(
    "SELECT * FROM events WHERE status IN ('筹备中','招生中','进行中') ORDER BY COALESCE(arrival_date, start_date), name",
  );
}

function computeDailyCapacityForecast(startDate, dayCount) {
  var events = loadCapacityActiveEvents();
  var days = [];
  for (var i = 0; i < dayCount; i++) {
    days.push(capacityAddDays(startDate, i));
  }

  return days.map(function (day) {
    var includeSpare = events.some(function (evt) {
      return !!evt.include_spare_beds && capacityDayInEventRange(evt, day);
    });
    var beds = getCapacityBedTotals(includeSpare);

    var lodgers = roomingReadReady()
      ? rcAllLodgersMerged()
          .filter(function (l) {
            return (
              l.status === "在住" &&
              l.check_in_date <= day &&
              (!l.expected_check_out || l.expected_check_out > day)
            );
          })
          .map(function (l) {
            return {
              gender: l.gender,
              participant_identity: l.participant_identity,
              age_group: l.age_group,
              event_id: l.event_id,
            };
          })
      : roomingUseLocalRead()
        ? query(
            "SELECT gender, participant_identity, age_group, event_id FROM lodgers WHERE status='在住' AND check_in_date <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)",
            [day, day],
          )
        : [];
    var reservations = roomingReadReady()
      ? rcRows("reservations", "reservations")
          .filter(function (r) {
            return (
              (r.status === "预约" || r.status === "已确认") &&
              r.expected_check_in <= day &&
              (!r.expected_check_out || r.expected_check_out > day)
            );
          })
          .map(function (r) {
            return {
              gender: r.gender,
              participant_identity: r.participant_identity,
              age_group: r.age_group,
              event_id: r.event_id,
            };
          })
      : roomingUseLocalRead()
        ? query(
            "SELECT gender, participant_identity, age_group, event_id FROM reservations WHERE status IN ('预约','已确认') AND expected_check_in <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)",
            [day, day],
          )
        : [];
    var registered = lodgers.concat(reservations);
    var male = registered.filter(function (p) {
      return p.gender === "男";
    }).length;
    var female = registered.filter(function (p) {
      return p.gender === "女";
    }).length;
    var demo = capacityCountDemographics(registered);

    var forecastMale = 0;
    var forecastFemale = 0;
    var forecastChild = 0;
    var forecastElder = 0;
    var forecastTeacher = 0;
    var forecastVolunteer = 0;
    var activeEvents = [];

    events.forEach(function (evt) {
      if (!capacityDayInEventRange(evt, day)) return;
      var reg = capacityRegisteredOnDay(evt.id, day);
      var targets = capacityEventTargets(evt, reg);
      forecastMale += Math.max(0, targets.male - reg.male);
      forecastFemale += Math.max(0, targets.female - reg.female);
      forecastChild += Math.max(0, targets.child - reg.demo.child);
      forecastElder += Math.max(0, targets.elder - reg.demo.elder);
      forecastTeacher += Math.max(0, targets.teacher - reg.demo.teacher);
      forecastVolunteer += Math.max(0, targets.volunteer - reg.demo.volunteer);
      if (reg.all.length > 0 || (evt.expected_count || 0) > 0) {
        activeEvents.push(evt.name);
      }
    });

    var totalMale = male + forecastMale;
    var totalFemale = female + forecastFemale;
    var totalChild = demo.child + forecastChild;
    var totalElder = demo.elder + forecastElder;
    var totalTeacher = demo.teacher + forecastTeacher;
    var totalVolunteer = demo.volunteer + forecastVolunteer;
    var totalPeople = registered.length + forecastMale + forecastFemale;
    var capacityUsable = beds.male + beds.female + beds.flex;
    var lodgingDemand = totalMale + totalFemale;
    var maleGap = Math.max(0, totalMale - beds.male);
    var femaleGap = Math.max(0, totalFemale - beds.female);
    var totalGap = Math.max(0, lodgingDemand - capacityUsable);

    return {
      day: day,
      registered: registered.length,
      forecastExtra: forecastMale + forecastFemale,
      totalPeople: totalPeople,
      male: totalMale,
      female: totalFemale,
      child: totalChild,
      elder: totalElder,
      teacher: totalTeacher,
      volunteer: totalVolunteer,
      beds: beds,
      capacityUsable: capacityUsable,
      maleGap: maleGap,
      femaleGap: femaleGap,
      totalGap: totalGap,
      includeSpare: includeSpare,
      activeEvents: activeEvents,
    };
  });
}

function initBoardCapacityControls() {
  var start = document.getElementById("board-cap-start");
  var days = document.getElementById("board-cap-days");
  if (start && !start.value) start.value = todayStr();
  if (days && !days.value) days.value = "14";
}

function renderBoardCapacityForecast() {
  var container = document.getElementById("board-capacity-result");
  if (!container) return;
  initBoardCapacityControls();

  var startDate =
    document.getElementById("board-cap-start")?.value || todayStr();
  var dayCount =
    parseInt(document.getElementById("board-cap-days")?.value, 10) || 14;
  if (!startDate) return;

  var rows = computeDailyCapacityForecast(startDate, dayCount);
  if (!rows.length) {
    container.innerHTML = '<p class="empty-tip">暂无预测数据。</p>';
    return;
  }

  var peak = rows.reduce(function (best, row) {
    return row.totalPeople > best.totalPeople ? row : best;
  }, rows[0]);
  var gapDays = rows.filter(function (row) {
    return row.totalGap > 0;
  });

  var html =
    '<div class="board-cap-summary">' +
    '<div class="board-cap-stat"><span class="board-cap-stat-num">' +
    peak.totalPeople +
    '</span><span class="board-cap-stat-label">峰值预计人数</span><span class="board-cap-stat-sub">' +
    escapeHtml(peak.day) +
    "</span></div>" +
    '<div class="board-cap-stat"><span class="board-cap-stat-num">' +
    gapDays.length +
    '</span><span class="board-cap-stat-label">床位缺口天数</span><span class="board-cap-stat-sub">含预计招生</span></div>' +
    '<div class="board-cap-stat"><span class="board-cap-stat-num">' +
    rows[0].capacityUsable +
    '</span><span class="board-cap-stat-label">物理可用床位</span><span class="board-cap-stat-sub">未扣在住/房务；男' +
    rows[0].beds.male +
    " / 女" +
    rows[0].beds.female +
    " / 不限" +
    rows[0].beds.flex +
    "</span></div></div>";

  if (typeof isMobileLayout !== "function" || !isMobileLayout()) {
    html +=
      '<div class="board-cap-chart-wrap"><canvas id="chart-board-capacity" role="img" aria-label="容量预测趋势"></canvas></div>';
  }

  html +=
    '<div class="table-wrap board-cap-table-wrap"><table class="board-cap-table"><thead><tr>' +
    "<th>日期</th><th>已报名</th><th>预计补充</th><th>合计</th><th>男</th><th>女</th><th>儿童</th><th>老人</th><th>师资</th><th>义工</th><th>可用床</th><th>缺口</th>" +
    "</tr></thead><tbody>";

  rows.forEach(function (row) {
    var gapText = row.totalGap > 0 ? "缺 " + row.totalGap : "充足";
    var gapClass = row.totalGap > 0 ? "forecast-warning" : "forecast-ok";
    var spareHint = row.includeSpare
      ? ' <span class="board-cap-spare-hint">含备用床</span>'
      : "";
    html +=
      "<tr" +
      (row.totalGap > 0 ? ' class="board-cap-gap-row"' : "") +
      ">" +
      "<td>" +
      escapeHtml(row.day) +
      "</td>" +
      "<td>" +
      row.registered +
      "</td>" +
      "<td>" +
      row.forecastExtra +
      "</td>" +
      "<td><strong>" +
      row.totalPeople +
      "</strong></td>" +
      "<td>" +
      row.male +
      "</td>" +
      "<td>" +
      row.female +
      "</td>" +
      "<td>" +
      row.child +
      "</td>" +
      "<td>" +
      row.elder +
      "</td>" +
      "<td>" +
      row.teacher +
      "</td>" +
      "<td>" +
      row.volunteer +
      "</td>" +
      "<td>" +
      row.capacityUsable +
      spareHint +
      "</td>" +
      '<td><span class="' +
      gapClass +
      '">' +
      escapeHtml(gapText) +
      "</span></td>" +
      "</tr>";
  });
  html += "</tbody></table></div>";

  if (gapDays.length) {
    html +=
      '<p class="board-cap-hint text-muted">提示：预计补充 = 营期预计招生 / 人数统计与已报名差额；缺口按男女寮与不限床位合计估算。</p>';
  }

  container.innerHTML = html;
  renderBoardCapacityChart(rows);
}

function renderBoardCapacityChart(rows) {
  if (!isKetangChartRuntimeReady() || !rows.length) return;
  if (typeof isMobileLayout === "function" && isMobileLayout()) return;
  var T = getChartTheme();
  var labels = rows.map(function (r) {
    return r.day.slice(5);
  });
  createKetangChart("board-capacity", "chart-board-capacity", {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "预计人数",
          data: rows.map(function (r) {
            return r.totalPeople;
          }),
          borderColor: T.primary,
          backgroundColor: T.flowIn,
          fill: true,
          tension: 0.25,
        },
        {
          label: "可用床位",
          data: rows.map(function (r) {
            return r.capacityUsable;
          }),
          borderColor: T.success,
          borderDash: [6, 4],
          tension: 0.25,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function toggleBoardCapacityPanel() {
  var panel = document.getElementById("board-capacity-panel");
  if (!panel) return;
  var collapsed = panel.classList.toggle("is-collapsed");
  var btn = document.getElementById("board-capacity-toggle");
  if (btn) {
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btn.textContent = collapsed ? "展开" : "收起";
  }
}
