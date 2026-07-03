/* ============================================================
   流动预测 | Forecast & Scheduling
   每日调度预报 + 按周流动预测
   ============================================================ */

const FORECAST_ROLE_GROUPS = {
  法师: "师",
  沙弥师: "师",
  行者: "师",
  师资: "师资",
  禅营: "学员",
  修道班: "学员",
  后勤义工: "义工",
  项目义工: "义工",
  访客: "特殊",
  工人: "特殊",
};

async function forecastLoadTab(tab) {
  initForecastDates();
  const panel = document.getElementById("forecast-panel-" + tab);
  if (panel) {
    panel.innerHTML = '<p class="empty-tip">加载中…</p>';
  }
  try {
    if (typeof rcEnsureViewModules === "function") {
      await rcEnsureViewModules("forecast", false);
    }
  } catch (e) {
    if (panel) {
      panel.innerHTML =
        '<p class="empty-tip">加载失败：' +
        escapeHtml(e.message || "未知错误") +
        "</p>";
    }
    return;
  }
  renderForecastTab(tab);
}

function initForecastDates() {
  const today = todayStr();
  const d = document.getElementById("fc-today-date");
  const s = document.getElementById("fc-start-date");
  if (d && !d.value) d.value = today;
  if (s && !s.value) s.value = today;
}

function renderForecastTab(tab) {
  // 切换 tab 时统一销毁旧图表，避免 canvas 移除后实例泄漏
  destroyKetangChartsByPrefix("forecast-");
  document
    .querySelectorAll(".forecast-tab-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelectorAll(".forecast-tab-panel")
    .forEach((p) => p.classList.remove("active"));
  const btn = document.querySelector(
    '.forecast-tab-btn[data-tab="' + tab + '"]',
  );
  const panel = document.getElementById("forecast-panel-" + tab);
  if (btn) btn.classList.add("active");
  if (panel) panel.classList.add("active");
  if (tab === "today") renderTodayForecast();
  if (tab === "flow") renderFlowForecast();
  if (typeof updateTopbarForForecastTab === "function") {
    updateTopbarForForecastTab(tab);
  }
}

/* ============================================================
   每日预报 | Today Forecast
   ============================================================ */

function renderTodayForecast() {
  const dateInput = document.getElementById("fc-today-date");
  const date = dateInput ? dateInput.value : todayStr();
  if (!date) return;

  const container = document.getElementById("today-forecast-result");
  if (!container) return;

  var arrivalsResv;
  var arrivalsLodger;
  var departures;
  var actualCheckins;
  var actualCheckouts;
  var inHouse;
  var byEvent;
  var arrivalRooms;
  var departureRooms;

  if (typeof rcReadReady === "function" && rcReadReady()) {
    var fd = rcForecastTodayData(date);
    arrivalsResv = fd.arrivalsResv;
    arrivalsLodger = fd.arrivalsLodger;
    departures = fd.departures;
    actualCheckins = fd.actualCheckins;
    actualCheckouts = fd.actualCheckouts;
    inHouse = fd.inHouse;
    byEvent = fd.byEvent;
    arrivalRooms = fd.arrivalRooms;
    departureRooms = fd.departureRooms;
  } else {
    // 预计到达：预约/在住中 expected_check_in = date，且状态正常
    arrivalsResv = query(
      `
    SELECT r.*, e.name as event_name
    FROM reservations r
    LEFT JOIN events e ON e.id = r.event_id
    WHERE r.expected_check_in = ? AND r.status IN ('预约','已确认')
    ORDER BY e.name, r.name
  `,
      [date],
    );
    arrivalsLodger = query(
      `
    SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number
    FROM lodgers l
    LEFT JOIN events e ON e.id = l.event_id
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.check_in_date = ? AND l.status = '在住'
    ORDER BY e.name, l.name
  `,
      [date],
    );

    // 预计离开：在住中 expected_check_out = date
    departures = query(
      `
    SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number
    FROM lodgers l
    LEFT JOIN events e ON e.id = l.event_id
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.expected_check_out = ? AND l.status = '在住'
    ORDER BY e.name, l.name
  `,
      [date],
    );

    // 实际已入住 / 已退房（以 actual_check_out 为空判断）
    actualCheckins =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE check_in_date = ? AND status = '在住'",
        [date],
      )[0]?.c || 0;
    actualCheckouts =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE actual_check_out = ? AND status IN ('在住','已退')",
        [date],
      )[0]?.c || 0;
    inHouse =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE status='在住' AND check_in_date <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)",
        [date, date],
      )[0]?.c || 0;

    // 按营期汇总
    byEvent = {};
    [...arrivalsResv, ...arrivalsLodger].forEach((a) => {
      const key = a.event_name || "散客";
      if (!byEvent[key])
        byEvent[key] = { arrive: 0, depart: 0, male: 0, female: 0 };
      byEvent[key].arrive++;
      if (a.gender === "男") byEvent[key].male++;
      if (a.gender === "女") byEvent[key].female++;
    });
    departures.forEach((d) => {
      const key = d.event_name || "散客";
      if (!byEvent[key])
        byEvent[key] = { arrive: 0, depart: 0, male: 0, female: 0 };
      byEvent[key].depart++;
    });

    // 房间变动清单
    arrivalRooms = query(
      `
    SELECT DISTINCT r.name as room_name, r.location, r.dorm_type
    FROM reservations res
    LEFT JOIN events e ON e.id = res.event_id
    LEFT JOIN rooms r ON (res.room_preference LIKE '%' || r.name || '%' OR (e.gender_type IN ('男','男众') AND r.dorm_type = '男寮') OR (e.gender_type IN ('女','女众') AND r.dorm_type = '女寮') OR r.dorm_type = '不限')
    WHERE res.expected_check_in = ? AND res.status IN ('预约','已确认')
    ORDER BY r.location, r.name
  `,
      [date],
    );
    departureRooms = query(
      `
    SELECT DISTINCT r.name as room_name, r.location, r.dorm_type
    FROM lodgers l
    JOIN beds b ON b.id = l.bed_id
    JOIN rooms r ON r.id = b.room_id
    WHERE l.expected_check_out = ? AND l.status = '在住'
    ORDER BY r.location, r.name
  `,
      [date],
    );
  }

  const totalArrivals = arrivalsResv.length + arrivalsLodger.length;
  const totalDepartures = departures.length;

  let html = `
    <div class="forecast-stats">
      <div class="forecast-stat"><div class="forecast-stat-num">${totalArrivals}</div><div class="forecast-stat-label">预计到达</div></div>
      <div class="forecast-stat"><div class="forecast-stat-num">${totalDepartures}</div><div class="forecast-stat-label">预计离开</div></div>
      <div class="forecast-stat"><div class="forecast-stat-num">${actualCheckins}</div><div class="forecast-stat-label">实际已入住</div></div>
      <div class="forecast-stat"><div class="forecast-stat-num">${actualCheckouts}</div><div class="forecast-stat-label">实际已退房</div></div>
      <div class="forecast-stat"><div class="forecast-stat-num">${inHouse}</div><div class="forecast-stat-label">在住人数</div></div>
    </div>
    <div class="forecast-charts">
      <div class="forecast-chart-box"><h4>今日到离</h4><canvas id="chart-today-flow"></canvas></div>
      <div class="forecast-chart-box"><h4>按营期到达</h4><canvas id="chart-today-event"></canvas></div>
      <div class="forecast-chart-box"><h4>按身份分布</h4><canvas id="chart-today-role"></canvas></div>
    </div>
  `;

  // 按营期汇总
  html += `<h3 class="section-title">按营期汇总</h3>`;
  if (Object.keys(byEvent).length === 0) {
    html += `<p class="empty-tip">今日无营期到离记录。</p>`;
  } else {
    html += `<div class="table-wrap"><table><thead><tr><th>营期</th><th>预计到达</th><th>预计离开</th><th>男</th><th>女</th></tr></thead><tbody>`;
    Object.keys(byEvent)
      .sort()
      .forEach((key) => {
        const e = byEvent[key];
        html += `<tr><td>${escapeHtml(key)}</td><td>${e.arrive}</td><td>${e.depart}</td><td>${e.male}</td><td>${e.female}</td></tr>`;
      });
    html += `</tbody></table></div>`;
  }

  // 房间变动
  html += `<h3 class="section-title">涉及房间变动</h3>`;
  html += `<div class="forecast-room-changes">`;
  html += `<div class="forecast-room-change-col">
    <h4>今日入住房间（${arrivalRooms.length}）</h4>
    ${arrivalRooms.length ? "<ul>" + arrivalRooms.map((r) => `<li>${escapeHtml(r.location || "")} ${escapeHtml(r.name)} <span class="room-tag" style="background:#e3f2fd;color:#1565c0">${escapeHtml(r.dorm_type)}</span></li>`).join("") + "</ul>" : '<p class="empty-tip">无</p>'}
  </div>`;
  html += `<div class="forecast-room-change-col">
    <h4>今日退房房间（${departureRooms.length}）</h4>
    ${departureRooms.length ? "<ul>" + departureRooms.map((r) => `<li>${escapeHtml(r.location || "")} ${escapeHtml(r.name)} <span class="room-tag" style="background:#e3f2fd;color:#1565c0">${escapeHtml(r.dorm_type)}</span></li>`).join("") + "</ul>" : '<p class="empty-tip">无</p>'}
  </div>`;
  html += `</div>`;

  // 预计到达明细
  html += `<h3 class="section-title">预计到达明细（${totalArrivals} 人）</h3>`;
  if (totalArrivals === 0) {
    html += `<p class="empty-tip">今日无预计到达。</p>`;
  } else {
    html += `<div class="table-wrap"><table><thead><tr><th>姓名 / 法名</th><th>性别</th><th>营期</th><th>身份</th><th>班级</th><th>类型</th><th>预离</th><th>房间偏好/床位</th></tr></thead><tbody>`;
    [...arrivalsResv, ...arrivalsLodger].forEach((a) => {
      const kind = a.room_name ? "在住" : "预约";
      const roomInfo = a.room_name
        ? `${escapeHtml(a.room_name)} / ${escapeHtml(a.bed_number || "")}`
        : escapeHtml(a.room_preference || "-");
      html += `<tr>
        <td>${escapeHtml(personDisplayName(a))}</td>
        <td>${escapeHtml(a.gender) || "-"}</td>
        <td>${escapeHtml(a.event_name || "散客")}</td>
        <td>${escapeHtml(a.role) || "-"}</td>
        <td>${escapeHtml(a.class_name) || "-"}</td>
        <td>${kind}</td>
        <td>${escapeHtml(a.expected_check_out) || "-"}</td>
        <td>${roomInfo}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  // 预计离开明细
  html += `<h3 class="section-title">预计离开明细（${totalDepartures} 人）</h3>`;
  if (totalDepartures === 0) {
    html += `<p class="empty-tip">今日无预计离开。</p>`;
  } else {
    html += `<div class="table-wrap"><table><thead><tr><th>姓名 / 法名</th><th>性别</th><th>营期</th><th>身份</th><th>班级</th><th>房间/床位</th></tr></thead><tbody>`;
    departures.forEach((d) => {
      html += `<tr>
        <td>${escapeHtml(personDisplayName(d))}</td>
        <td>${escapeHtml(d.gender) || "-"}</td>
        <td>${escapeHtml(d.event_name || "散客")}</td>
        <td>${escapeHtml(d.role) || "-"}</td>
        <td>${escapeHtml(d.class_name) || "-"}</td>
        <td>${escapeHtml(d.room_name || "-")} / ${escapeHtml(d.bed_number || "-")}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  html += `<div class="btn-bar" style="margin-top: var(--space-4);">
    <button class="btn btn-default" onclick="exportTodayForecastCSV()">导出 CSV</button>
    <button class="btn btn-default" onclick="printTodayForecast()">打印</button>
  </div>`;

  container.innerHTML = html;
  renderTodayForecastCharts(
    date,
    totalArrivals,
    totalDepartures,
    arrivalsResv,
    arrivalsLodger,
  );
}

function exportTodayForecastCSV() {
  const date = document.getElementById("fc-today-date").value;
  if (!date) {
    alert("请选择日期");
    return;
  }

  const arrivalsResv = query(
    `
    SELECT r.*, e.name as event_name FROM reservations r LEFT JOIN events e ON e.id = r.event_id
    WHERE r.expected_check_in = ? AND r.status IN ('预约','已确认') ORDER BY r.name
  `,
    [date],
  );
  const arrivalsLodger = query(
    `
    SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number FROM lodgers l
    LEFT JOIN events e ON e.id = l.event_id LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.check_in_date = ? AND l.status = '在住' ORDER BY l.name
  `,
    [date],
  );
  const departures = query(
    `
    SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number FROM lodgers l
    LEFT JOIN events e ON e.id = l.event_id LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.expected_check_out = ? AND l.status = '在住' ORDER BY l.name
  `,
    [date],
  );

  const lines = [
    "\uFEFF" +
      [
        "类型",
        "姓名 / 法名",
        "性别",
        "营期",
        "身份",
        "班级",
        "日期",
        "预离",
        "房间/偏好",
      ]
        .map(csvCell)
        .join(","),
  ];
  arrivalsResv.forEach((a) =>
    lines.push(
      [
        "到达(预约)",
        personDisplayName(a),
        a.gender || "",
        a.event_name || "散客",
        a.role || "",
        a.class_name || "",
        a.expected_check_in || "",
        a.expected_check_out || "",
        a.room_preference || "",
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  arrivalsLodger.forEach((a) =>
    lines.push(
      [
        "到达(已住)",
        personDisplayName(a),
        a.gender || "",
        a.event_name || "散客",
        a.role || "",
        a.class_name || "",
        a.check_in_date || "",
        a.expected_check_out || "",
        (a.room_name || "") + "/" + (a.bed_number || ""),
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  departures.forEach((d) =>
    lines.push(
      [
        "离开",
        personDisplayName(d),
        d.gender || "",
        d.event_name || "散客",
        d.role || "",
        d.class_name || "",
        d.expected_check_out || "",
        "",
        (d.room_name || "") + "/" + (d.bed_number || ""),
      ]
        .map(csvCell)
        .join(","),
    ),
  );

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `today_forecast_${date}.csv`);
}

function printTodayForecast() {
  const date = document.getElementById("fc-today-date").value;
  const content = document.getElementById("today-forecast-result").innerHTML;
  const win = window.open("", "_blank");
  win.document.write(`
    <html><head><title>每日预报 ${date}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 20px; color: #333; }
      h3 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
      th { background: #f5f5f5; }
      .forecast-stats { display: flex; gap: 16px; margin-bottom: 16px; }
      .forecast-stat { text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 4px; min-width: 80px; }
      .forecast-stat-num { font-size: 20px; font-weight: bold; }
      .forecast-stat-label { font-size: 11px; color: #666; }
      .forecast-room-changes { display: flex; gap: 20px; }
      .forecast-room-change-col { flex: 1; }
      .room-tag { padding: 0 6px; border-radius: 3px; font-size: 10px; }
      .btn-bar { display: none; }
    </style></head><body>
    <h2>${date} 每日调度预报</h2>
    ${content}
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    win.close();
  }, 300);
}

/* ============================================================
   按周流动预测 | Weekly Flow Forecast
   ============================================================ */

function renderFlowForecast() {
  const startInput = document.getElementById("fc-start-date");
  const weeksInput = document.getElementById("fc-weeks");
  const startDate = startInput ? startInput.value : todayStr();
  const weeks = parseInt(weeksInput ? weeksInput.value : "8", 10) || 8;
  if (!startDate) return;

  const container = document.getElementById("flow-forecast-result");
  if (!container) return;

  var weekData;
  var totalMaleBeds;
  var totalFemaleBeds;
  var totalFlexBeds;

  if (typeof rcReadReady === "function" && rcReadReady()) {
    var flowPack = rcForecastFlowWeeks(startDate, weeks);
    weekData = flowPack.weekData;
    totalMaleBeds = flowPack.totalMaleBeds;
    totalFemaleBeds = flowPack.totalFemaleBeds;
    totalFlexBeds = flowPack.totalFlexBeds;
  } else {
    // 计算每周的周一作为周标签
    weekData = [];
    let current = new Date(startDate);
    current.setDate(current.getDate() - current.getDay() + 1); // 调整到周一

    for (let i = 0; i < weeks; i++) {
      const monday = formatDateStr(current);
      const sundayDate = new Date(current);
      sundayDate.setDate(sundayDate.getDate() + 6);
      const sunday = formatDateStr(sundayDate);

      // 该周日在住人数：入住 <= 周日 且 （未退房 或 退房 > 周日）
      const inHouse = query(
        `
      SELECT gender, role, COUNT(*) as c FROM lodgers
      WHERE status = '在住' AND check_in_date <= ? AND (expected_check_out IS NULL OR expected_check_out > ?)
      GROUP BY gender, role
    `,
        [sunday, sunday],
      );

      // 该周内预计到达
      const arrivals = query(
        `
      SELECT gender, role, COUNT(*) as c FROM (
        SELECT gender, role FROM reservations WHERE expected_check_in >= ? AND expected_check_in <= ? AND status IN ('预约','已确认')
        UNION ALL
        SELECT gender, role FROM lodgers WHERE check_in_date >= ? AND check_in_date <= ? AND status = '在住'
      ) GROUP BY gender, role
    `,
        [monday, sunday, monday, sunday],
      );

      // 该周内预计离开
      const departures = query(
        `
      SELECT gender, role, COUNT(*) as c FROM lodgers
      WHERE status = '在住' AND expected_check_out >= ? AND expected_check_out <= ?
      GROUP BY gender, role
    `,
        [monday, sunday],
      );

      const stats = {
        male: 0,
        female: 0,
        shi: 0,
        teacher: 0,
        student: 0,
        volunteer: 0,
        special: 0,
        arrive: 0,
        depart: 0,
      };
      inHouse.forEach((r) => {
        if (r.gender === "男") stats.male += r.c;
        if (r.gender === "女") stats.female += r.c;
        accumulateRole(stats, r.role, r.c);
      });
      arrivals.forEach((r) => {
        stats.arrive += r.c;
      });
      departures.forEach((r) => {
        stats.depart += r.c;
      });

      weekData.push({ label: monday + " ~ " + sunday, stats });
      current.setDate(current.getDate() + 7);
    }

    // 总床位
    totalMaleBeds =
      query(
        "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id=b.room_id WHERE r.dorm_type='男寮' AND b.status!='维修' AND b.status!='备用'",
      )[0]?.c || 0;
    totalFemaleBeds =
      query(
        "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id=b.room_id WHERE r.dorm_type='女寮' AND b.status!='维修' AND b.status!='备用'",
      )[0]?.c || 0;
    totalFlexBeds =
      query(
        "SELECT COUNT(*) as c FROM beds b JOIN rooms r ON r.id=b.room_id WHERE r.dorm_type='不限' AND b.status!='维修' AND b.status!='备用'",
      )[0]?.c || 0;
  }

  // 可用于调剂的不限房间（当前空床）
  const flexRooms =
    typeof rcReadReady === "function" &&
    rcReadReady() &&
    typeof rcFlexEmptyRooms === "function"
      ? rcFlexEmptyRooms()
      : query(`
    SELECT r.name, r.location, COUNT(b.id) as beds
    FROM rooms r
    JOIN beds b ON b.room_id = r.id
    LEFT JOIN lodgers l ON l.bed_id = b.id AND l.status='在住'
    WHERE r.dorm_type='不限' AND b.status!='维修' AND b.status!='备用' AND l.id IS NULL
    GROUP BY r.id
    ORDER BY beds DESC, r.name
  `);
  const flexRoomNames = flexRooms.map(
    (r) => `${escapeHtml(r.location || "")}${escapeHtml(r.name)}(${r.beds}床)`,
  );
  const flexRoomHint = flexRoomNames.length
    ? `可调：${flexRoomNames.join("、")}`
    : "无可调剂不限房间";

  let html = `
    <div class="forecast-legend">
      <span>男寮床位 ${totalMaleBeds}，女寮床位 ${totalFemaleBeds}，不限 ${totalFlexBeds}</span>
    </div>
    <div class="table-wrap"><table class="forecast-week-table">
      <thead><tr>
        <th>周次</th><th>在住男</th><th>在住女</th><th>师</th><th>师资</th><th>学员</th><th>义工</th><th>特殊</th><th>预计到达</th><th>预计离开</th><th>床位预警</th>
      </tr></thead><tbody>
  `;

  weekData.forEach((w) => {
    const s = w.stats;
    const warnings = [];
    const suggestions = [];
    if (s.male > totalMaleBeds) {
      const gap = s.male - totalMaleBeds;
      warnings.push(`男寮缺 ${gap}`);
      suggestions.push(
        gap <= totalFlexBeds
          ? flexRoomHint
          : `${flexRoomHint}，仍不足 ${gap - totalFlexBeds} 床`,
      );
    }
    if (s.female > totalFemaleBeds) {
      const gap = s.female - totalFemaleBeds;
      warnings.push(`女寮缺 ${gap}`);
      suggestions.push(
        gap <= totalFlexBeds
          ? flexRoomHint
          : `${flexRoomHint}，仍不足 ${gap - totalFlexBeds} 床`,
      );
    }
    const roomingLink = `<a href="javascript:void(0)" onclick="showView('info'); renderInfo('events')" style="text-decoration:underline;color:var(--color-primary)">去营期管理查看排房建议</a>`;
    const warnHtml = warnings.length
      ? `<span class="forecast-warning">${warnings.join("，")}</span><div class="forecast-suggestion">${suggestions.join("<br>")}<br>${roomingLink}</div>`
      : '<span class="forecast-ok">充足</span>';
    const barMax = Math.max(
      totalMaleBeds + totalFemaleBeds + totalFlexBeds,
      s.male + s.female,
      1,
    );
    const barPct = Math.round(((s.male + s.female) / barMax) * 100);
    html += `<tr>
      <td>${escapeHtml(w.label)}</td>
      <td>${s.male}</td>
      <td>${s.female}</td>
      <td>${s.shi}</td>
      <td>${s.teacher}</td>
      <td>${s.student}</td>
      <td>${s.volunteer}</td>
      <td>${s.special}</td>
      <td>${s.arrive}</td>
      <td>${s.depart}</td>
      <td>${warnHtml}<div class="forecast-mini-bar"><div style="width:${barPct}%"></div></div></td>
    </tr>`;
  });

  html += `</tbody></table></div>`;

  // 营期入住率
  html += `<h3 class="section-title">营期入住率</h3>`;
  const events = query(`
    SELECT e.*,
      (SELECT COUNT(*) FROM lodgers l WHERE l.event_id = e.id AND l.status = '在住') as checked_in,
      (SELECT COUNT(*) FROM reservations r WHERE r.event_id = e.id AND r.status IN ('预约','已确认')) as reserved
    FROM events e
    WHERE e.status != '已取消'
    ORDER BY e.start_date DESC
  `);
  if (!events.length) {
    html += `<p class="empty-tip">暂无营期数据。</p>`;
  } else {
    html += `<div class="table-wrap"><table><thead><tr><th>营期</th><th>预计招生</th><th>已报名</th><th>已入住</th><th>差额</th><th>进度</th></tr></thead><tbody>`;
    events.forEach((e) => {
      const registered = (e.checked_in || 0) + (e.reserved || 0);
      const pct = e.expected_count
        ? Math.round((registered / e.expected_count) * 100)
        : 0;
      html += `<tr>
        <td>${escapeHtml(e.name)}</td>
        <td>${e.expected_count || 0}</td>
        <td>${registered}</td>
        <td>${e.checked_in || 0}</td>
        <td>${(e.expected_count || 0) - registered}</td>
        <td><div class="forecast-progress"><div style="width:${pct}%"></div></div> ${pct}%</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }

  html += `
    <div class="forecast-charts">
      <div class="forecast-chart-box wide"><h4>未来入住趋势</h4><canvas id="chart-flow-trend"></canvas></div>
      <div class="forecast-chart-box"><h4>身份构成</h4><canvas id="chart-flow-role"></canvas></div>
    </div>
  `;

  container.innerHTML = html;
  renderFlowForecastCharts(weekData, totalMaleBeds, totalFemaleBeds);
}

function accumulateRole(stats, role, count) {
  const bucket = roleToGroup(role);
  if (bucket === "师") stats.shi += count;
  else if (bucket === "师资") stats.teacher += count;
  else if (bucket === "学员") stats.student += count;
  else if (bucket === "义工") stats.volunteer += count;
  else stats.special += count;
}

function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ============================================================
   Chart.js 可视化 | Data Visualization
   ============================================================ */

function renderTodayForecastCharts(
  date,
  totalArrivals,
  totalDepartures,
  arrivalsResv,
  arrivalsLodger,
) {
  if (typeof Chart === "undefined") return;
  const T = getChartTheme();

  createKetangChart("forecast-today-flow", "chart-today-flow", {
    type: "bar",
    data: {
      labels: ["预计到达", "预计离开"],
      datasets: [
        {
          label: "人数",
          data: [totalArrivals, totalDepartures],
          backgroundColor: [T.arrive, T.flowOut],
          borderWidth: 1,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { stepSize: 1 } } },
    },
  });

  // 2. 按营期到达
  const eventCounts = {};
  [...arrivalsResv, ...arrivalsLodger].forEach((a) => {
    const key = a.event_name || "散客";
    eventCounts[key] = (eventCounts[key] || 0) + 1;
  });
  if (Object.keys(eventCounts).length > 0) {
    const labels = Object.keys(eventCounts);
    const data = labels.map((k) => eventCounts[k]);
    createKetangChart("forecast-today-event", "chart-today-event", {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: getChartColors(labels.length),
            borderWidth: 1,
          },
        ],
      },
      options: { plugins: { legend: { position: "right" } } },
    });
  }

  // 3. 按身份分布（今日到离人员）
  const roleCounts = {};
  [...arrivalsResv, ...arrivalsLodger].forEach((a) => {
    const group = roleToGroup(a.role);
    roleCounts[group] = (roleCounts[group] || 0) + 1;
  });
  if (Object.keys(roleCounts).length > 0) {
    const labels = Object.keys(roleCounts);
    const data = labels.map((k) => roleCounts[k]);
    createKetangChart("forecast-today-role", "chart-today-role", {
      type: "pie",
      data: {
        labels: labels,
        datasets: [
          {
            data: data,
            backgroundColor: getChartColors(labels.length),
            borderWidth: 1,
          },
        ],
      },
      options: { plugins: { legend: { position: "right" } } },
    });
  }
}

function renderFlowForecastCharts(weekData, totalMaleBeds, totalFemaleBeds) {
  if (typeof Chart === "undefined" || weekData.length === 0) return;
  const T = getChartTheme();

  const labels = weekData.map((w) => w.label.split(" ~ ")[0]);
  const maleData = weekData.map((w) => w.stats.male);
  const femaleData = weekData.map((w) => w.stats.female);
  const arriveData = weekData.map((w) => w.stats.arrive);
  const departData = weekData.map((w) => w.stats.depart);
  const capLine = function (n) {
    return Array(labels.length).fill(n);
  };

  createKetangChart("forecast-flow-trend", "chart-flow-trend", {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "在住男",
          data: maleData,
          backgroundColor: T.male,
          stack: "male",
        },
        {
          label: "在住女",
          data: femaleData,
          backgroundColor: T.female,
          stack: "female",
        },
        {
          label: "预计到达",
          data: arriveData,
          backgroundColor: T.arrive,
          stack: "flowA",
        },
        {
          label: "预计离开",
          data: departData,
          backgroundColor: T.depart,
          stack: "flowB",
        },
        {
          type: "line",
          label: "男寮床位",
          data: capLine(totalMaleBeds),
          borderColor: T.capacity,
          backgroundColor: "transparent",
          borderDash: [6, 4],
          borderWidth: 2,
          pointRadius: 0,
          order: 0,
        },
        {
          type: "line",
          label: "女寮床位",
          data: capLine(totalFemaleBeds),
          borderColor: T.capacityFemale,
          backgroundColor: "transparent",
          borderDash: [4, 4],
          borderWidth: 2,
          pointRadius: 0,
          order: 0,
        },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: false, ticks: { stepSize: 1 } },
      },
      plugins: { tooltip: { mode: "index", intersect: false } },
    },
  });

  const last = weekData[weekData.length - 1].stats;
  const roleData = [
    last.shi,
    last.teacher,
    last.student,
    last.volunteer,
    last.special,
  ];
  const roleLabels = ["师", "师资", "学员", "义工", "特殊"];
  if (roleData.some((v) => v > 0)) {
    createKetangChart("forecast-flow-role", "chart-flow-role", {
      type: "doughnut",
      data: {
        labels: roleLabels,
        datasets: [
          {
            data: roleData,
            backgroundColor: getChartColors(roleLabels.length),
            borderWidth: 1,
          },
        ],
      },
      options: { plugins: { legend: { position: "right" } } },
    });
  }
}

function roleToGroup(role) {
  if (!role) return "未分类";
  const r =
    typeof lodgerRoleCanon === "function" ? lodgerRoleCanon(role) : role;
  if (["法师", "沙弥", "行者"].includes(r)) return "师";
  if (r === "老师") return "师资";
  if (r === "学员") return "学员";
  if (["管理员", "义工", "营务"].includes(r)) return "义工";
  return "特殊";
}
