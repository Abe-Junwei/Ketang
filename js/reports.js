async function reportsInitAndLoad() {
  initReportDates();
  const eventSel = document.getElementById("r-event");
  if (eventSel) {
    eventSel.innerHTML = '<option value="">加载中…</option>';
  }
  try {
    if (typeof rcEnsureViewModules === "function") {
      await rcEnsureViewModules("reports", false);
    }
  } catch (e) {
    if (eventSel) {
      eventSel.innerHTML =
        '<option value="">加载失败：' +
        escapeHtml(e.message || "") +
        "</option>";
    }
    return;
  }
  populateReportEventSelect();
}

function initReportDates() {
  const today = todayStr();
  const m = document.getElementById("r-meal-date");
  const d = document.getElementById("r-daily-date");
  const mo = document.getElementById("r-month");
  if (m && !m.value) m.value = today;
  if (d && !d.value) d.value = today;
  if (mo && !mo.value) mo.value = today.slice(0, 7);
  populateReportEventSelect();
}

function populateReportEventSelect() {
  const sel = document.getElementById("r-event");
  if (!sel) return;
  var events;
  if (useOnlineDataPath()) {
    events = rcEventsForSelect();
  } else {
    events = query(
      "SELECT id, name, event_type FROM events WHERE status != '已取消' ORDER BY start_date DESC, id DESC",
    );
  }
  let html = '<option value=\"\">全部营期</option>';
  events.forEach((e) => {
    html += `<option value="${e.id}">${escapeHtml(e.name)} (${escapeHtml(e.event_type)})</option>`;
  });
  sel.innerHTML = html;
  if (typeof rebuildSelectPicker === "function") rebuildSelectPicker(sel);
}

function destroyReportCharts() {
  destroyKetangChartsByPrefix("report-");
}

async function reportsEnsureData(rangeHint) {
  if (typeof rcUseApiRead !== "function" || !rcUseApiRead()) return;
  if (typeof rcEnsureViewModules !== "function") return;
  await rcEnsureViewModules("reports", false);
  // Older than lodgers_recent window: pull full lodgers module
  if (rangeHint && typeof rcEnsureLodgersForReportRange === "function") {
    await rcEnsureLodgersForReportRange(rangeHint);
  }
}

async function renderMealReport() {
  await reportsEnsureData();
  destroyReportCharts();
  const date = document.getElementById("r-meal-date").value;
  const container = document.getElementById("meal-report-result");
  if (!date) {
    container.innerHTML = '<p class="empty-tip">请选择日期</p>';
    return;
  }

  const byRole = getMealReportByRole(date);
  const byRoom = getMealDayByRoom(date);
  const total = getMealDayStats(date);
  const dayDetail = getMealDayDetail(date);

  const makeTable = (rows, cols) => {
    if (!rows.length) return '<p class="empty-tip">无记录</p>';
    return (
      `<table><thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead><tbody>` +
      rows
        .map(
          (r) =>
            `<tr>${cols.map((c) => `<td>${c.key === "role" || c.key === "room_name" ? escapeHtml(r[c.key] || "-") : r[c.key] || 0}</td>`).join("")}</tr>`,
        )
        .join("") +
      "</tbody></table>"
    );
  };

  const chartHtml = byRole.length
    ? `<div class="forecast-charts">${chartBoxHtml("按身份用斋", "chart-meal-role")}${byRoom.length && byRoom.length <= 16 ? chartBoxHtml("按房间用斋", "chart-meal-room") : ""}</div>`
    : "";

  container.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${total.bf || 0}</div><div class="label">早斋总数</div></div>
      <div class="stat"><div class="num">${total.lc || 0}</div><div class="label">午斋总数</div></div>
      <div class="stat"><div class="num">${total.dn || 0}</div><div class="label">药石总数</div></div>
    </div>
    ${chartHtml}
    <p class="panel-card-desc" style="margin-top:var(--space-2);">统计口径：当日在寺挂单 + 当日待入住预约；人次为各餐合计。</p>
    <h3>按身份汇总</h3>
    ${makeTable(byRole, [
      { key: "role", label: "身份" },
      { key: "people", label: "用餐" },
      { key: "noEat", label: "不用斋" },
      { key: "bf", label: "早斋" },
      { key: "lc", label: "午斋" },
      { key: "dn", label: "药石" },
    ])}
    <h3 style="margin-top: var(--space-4);">在寺跳过</h3>
    ${
      dayDetail.skipped.length
        ? '<ul class="meals-skip-list">' +
          dayDetail.skipped
            .map(function (s) {
              return (
                '<li><span class="meals-skip-name">' +
                escapeHtml(s.displayName || personDisplayName(s)) +
                "</span>（" +
                escapeHtml(lodgerRoleDisplayName(s.role)) +
                "）跳" +
                escapeHtml(s.skipped.join("、")) +
                "</li>"
              );
            })
            .join("") +
          "</ul>"
        : '<p class="empty-tip">无跳过记录</p>'
    }
    <h3 style="margin-top: var(--space-4);">按房间汇总（在寺）</h3>
    ${makeTable(byRoom, [
      { key: "room_name", label: "房间" },
      { key: "people", label: "用餐人数" },
      { key: "bf", label: "早斋" },
      { key: "lc", label: "午斋" },
      { key: "dn", label: "药石" },
    ])}
  `;

  renderMealReportCharts(byRole, byRoom);
}

function renderMealReportCharts(byRole, byRoom) {
  if (typeof Chart === "undefined") return;
  const T = getChartTheme();
  if (byRole.length) {
    createKetangChart("report-meal-role", "chart-meal-role", {
      type: "bar",
      data: {
        labels: byRole.map((r) => r.role || "未分类"),
        datasets: [
          {
            label: "早斋",
            data: byRole.map((r) => r.bf || 0),
            backgroundColor: T.bf,
          },
          {
            label: "午斋",
            data: byRole.map((r) => r.lc || 0),
            backgroundColor: T.lc,
          },
          {
            label: "药石",
            data: byRole.map((r) => r.dn || 0),
            backgroundColor: T.dn,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "top" } },
        scales: { y: { ticks: { stepSize: 1 } } },
      },
    });
  }
  if (byRoom.length && byRoom.length <= 16) {
    createKetangChart("report-meal-room", "chart-meal-room", {
      type: "bar",
      data: {
        labels: byRoom.map((r) => r.room_name || "-"),
        datasets: [
          {
            label: "早斋",
            data: byRoom.map((r) => r.bf || 0),
            backgroundColor: T.bf,
          },
          {
            label: "午斋",
            data: byRoom.map((r) => r.lc || 0),
            backgroundColor: T.lc,
          },
          {
            label: "药石",
            data: byRoom.map((r) => r.dn || 0),
            backgroundColor: T.dn,
          },
        ],
      },
      options: {
        plugins: { legend: { position: "top" } },
        scales: {
          x: { ticks: { maxRotation: 60, minRotation: 0 } },
          y: { ticks: { stepSize: 1 } },
        },
      },
    });
  }
}

function exportMealReportCSV() {
  const date = document.getElementById("r-meal-date").value;
  if (!date) {
    alert("请选择日期");
    return;
  }
  const byRole = getMealReportByRole(date);
  const lines = [
    "\uFEFF" +
      ["身份", "用餐", "不用斋", "早斋", "午斋", "药石"].map(csvCell).join(","),
  ];
  byRole.forEach((r) =>
    lines.push(
      [
        r.role || "未分类",
        r.people || 0,
        r.noEat || 0,
        r.bf || 0,
        r.lc || 0,
        r.dn || 0,
      ]
        .map(csvCell)
        .join(","),
    ),
  );
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `meal_report_${date}.csv`);
}

function renderPaymentMethodTable(rows) {
  if (!rows.length) {
    return '<p class="empty-tip">暂无收款记录</p>';
  }
  let html =
    '<table class="data-table"><thead><tr><th>收款方式</th><th>笔数</th><th>金额</th></tr></thead><tbody>';
  rows.forEach(function (row) {
    html +=
      "<tr><td>" +
      escapeHtml(row.method) +
      "</td><td>" +
      (row.cnt || 0) +
      "</td><td>" +
      (row.total || 0).toFixed(2) +
      "</td></tr>";
  });
  html += "</tbody></table>";
  return html;
}

async function renderDailyReport() {
  destroyReportCharts();
  const date = document.getElementById("r-daily-date").value;
  const container = document.getElementById("daily-report-result");
  if (!date) {
    container.innerHTML = '<p class="empty-tip">请选择日期</p>';
    return;
  }
  await reportsEnsureData(date);

  var checkins;
  var checkouts;
  var inHouse;
  var expectedCheckout;
  var payMap = {};
  var payMethods;
  var checkinList;
  var checkoutList;
  if (useOnlineDataPath()) {
    var daily = rcDailyReportData(date);
    checkins = daily.checkins;
    checkouts = daily.checkouts;
    inHouse = daily.inHouse;
    expectedCheckout = daily.expectedCheckout;
    daily.payments.forEach(function (p) {
      payMap[p.type] = p.total || 0;
    });
    payMethods = daily.payMethods;
    checkinList = daily.checkinList;
    checkoutList = daily.checkoutList;
  } else {
    checkins =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE check_in_date = ? AND status IN ('在住','已退')",
        [date],
      )[0]?.c || 0;
    checkouts =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE actual_check_out = ? AND status IN ('在住','已退')",
        [date],
      )[0]?.c || 0;
    inHouse =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE check_in_date <= ? AND status = '在住' AND (expected_check_out IS NULL OR expected_check_out > ?)",
        [date, date],
      )[0]?.c || 0;
    expectedCheckout =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE status = '在住' AND expected_check_out = ?",
        [date],
      )[0]?.c || 0;
    query(
      `
    SELECT p.type, COALESCE(SUM(p.amount), 0) as total, COUNT(*) as cnt
    FROM payments p
    LEFT JOIN lodgers l ON l.id = p.lodger_id
    WHERE date(p.paid_at) = ? AND (p.lodger_id IS NULL OR l.status IN ('在住', '已退'))
    GROUP BY p.type
  `,
      [date],
    ).forEach(function (p) {
      payMap[p.type] = p.total || 0;
    });
    payMethods = query(
      `
    SELECT COALESCE(NULLIF(p.method, ''), '未填写') as method,
           COALESCE(SUM(p.amount), 0) as total,
           COUNT(*) as cnt
    FROM payments p
    LEFT JOIN lodgers l ON l.id = p.lodger_id
    WHERE date(p.paid_at) = ? AND (p.lodger_id IS NULL OR l.status IN ('在住', '已退'))
    GROUP BY COALESCE(NULLIF(p.method, ''), '未填写')
    ORDER BY total DESC
  `,
      [date],
    );
    checkinList = query(
      `
    SELECT l.*, r.name as room_name, b.bed_number
    FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.check_in_date = ? AND l.status IN ('在住','已退') ORDER BY l.id DESC
  `,
      [date],
    );
    checkoutList = query(
      `
    SELECT l.*, r.name as room_name, b.bed_number
    FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.actual_check_out = ? AND l.status IN ('在住','已退') ORDER BY l.id DESC
  `,
      [date],
    );
  }

  const meals = getMealDayStats(date);

  container.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${checkins}</div><div class="label">今日入住</div></div>
      <div class="stat"><div class="num">${checkouts}</div><div class="label">今日退房</div></div>
      <div class="stat"><div class="num">${inHouse}</div><div class="label">在住人数</div></div>
      <div class="stat"><div class="num">${expectedCheckout}</div><div class="label">预计今日退房</div></div>
      <div class="stat"><div class="num">${(payMap["押金"] || 0).toFixed(2)}</div><div class="label">押金</div></div>
      <div class="stat"><div class="num">${(payMap["房费"] || 0).toFixed(2)}</div><div class="label">房费</div></div>
      <div class="stat"><div class="num">${(payMap["退款"] || 0).toFixed(2)}</div><div class="label">退款</div></div>
      <div class="stat"><div class="num">${meals.bf || 0}</div><div class="label">早斋</div></div>
      <div class="stat"><div class="num">${meals.lc || 0}</div><div class="label">午斋</div></div>
      <div class="stat"><div class="num">${meals.dn || 0}</div><div class="label">药石</div></div>
    </div>
    <div class="forecast-charts">
      ${chartBoxHtml("今日到离", "chart-daily-flow")}
      ${chartBoxHtml("款项构成", "chart-daily-pay")}
      ${chartBoxHtml("今日用斋", "chart-daily-meals")}
    </div>
    <h3>今日入住明细</h3>
    ${renderReportTable(checkinList, ["姓名", "身份", "房间/床位", "手机号"])}
    <h3 style="margin-top: var(--space-4);">收款方式统计</h3>
    ${renderPaymentMethodTable(payMethods)}
    <h3 style="margin-top: var(--space-4);">今日退房明细</h3>
    ${renderReportTable(checkoutList, ["姓名", "身份", "房间/床位", "手机号"])}
  `;

  renderDailyReportCharts(
    checkins,
    checkouts,
    inHouse,
    expectedCheckout,
    payMap,
    meals,
  );
}

function renderDailyReportCharts(
  checkins,
  checkouts,
  inHouse,
  expectedCheckout,
  payMap,
  meals,
) {
  if (typeof Chart === "undefined") return;
  const T = getChartTheme();
  createKetangChart("report-daily-flow", "chart-daily-flow", {
    type: "bar",
    data: {
      labels: ["入住", "退房", "在住", "预计退房"],
      datasets: [
        {
          label: "人数",
          data: [checkins, checkouts, inHouse, expectedCheckout],
          backgroundColor: [T.flowIn, T.flowOut, T.success, T.warning],
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { stepSize: 1 } } },
    },
  });

  const payLabels = [];
  const payData = [];
  const payColors = [];
  [
    ["押金", T.success],
    ["房费", T.primary],
    ["退款", T.depart],
  ].forEach(function (pair) {
    const val = payMap[pair[0]] || 0;
    if (val > 0) {
      payLabels.push(pair[0]);
      payData.push(val);
      payColors.push(pair[1]);
    }
  });
  if (payData.length) {
    createKetangChart("report-daily-pay", "chart-daily-pay", {
      type: "doughnut",
      data: {
        labels: payLabels,
        datasets: [
          { data: payData, backgroundColor: payColors, borderWidth: 1 },
        ],
      },
      options: { plugins: { legend: { position: "right" } } },
    });
  }

  createKetangChart("report-daily-meals", "chart-daily-meals", {
    type: "bar",
    data: {
      labels: ["早斋", "午斋", "药石"],
      datasets: [
        {
          label: "人数",
          data: [meals.bf || 0, meals.lc || 0, meals.dn || 0],
          backgroundColor: [T.bf, T.lc, T.dn],
        },
      ],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { stepSize: 1 } } },
    },
  });
}

function renderReportTable(rows, cols) {
  if (!rows.length) return '<p class="empty-tip">无</p>';
  return (
    `<table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td>${escapeHtml(personDisplayName(r))}</td><td>${escapeHtml(lodgerRoleDisplayName(r.role) || "-")}</td><td>${escapeHtml((r.room_name || "-") + (r.bed_number ? "/" + r.bed_number : ""))}</td><td>${escapeHtml(r.phone || "-")}</td></tr>`,
      )
      .join("") +
    "</tbody></table>"
  );
}

async function exportDailyReportCSV() {
  const date = document.getElementById("r-daily-date").value;
  if (!date) {
    alert("请选择日期");
    return;
  }
  await reportsEnsureData(date);
  const rows = useOnlineDataPath()
    ? rcDailyReportExportRows(date)
    : query(
        `
    SELECT l.*, r.name as room_name, b.bed_number
    FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id
    WHERE l.status IN ('在住', '已退') AND (l.check_in_date = ? OR l.actual_check_out = ?) ORDER BY l.check_in_date DESC, l.id DESC
  `,
        [date, date],
      );
  const lines = [
    "\uFEFF" +
      [
        "类型",
        "房间/床位",
        "姓名",
        "身份",
        "性别",
        "手机号",
        "入住日期",
        "实际离院日期",
        "备注",
      ]
        .map(csvCell)
        .join(","),
  ];
  rows.forEach((r) => {
    const type = r.check_in_date === date ? "入住" : "退房";
    lines.push(
      [
        type,
        (r.room_name || "") + (r.bed_number ? "/" + r.bed_number : ""),
        personDisplayName(r),
        r.role || "",
        r.gender || "",
        r.phone || "",
        r.check_in_date || "",
        r.actual_check_out || "",
        r.notes || "",
      ]
        .map(csvCell)
        .join(","),
    );
  });
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `daily_report_${date}.csv`);
}

async function renderMonthlyReport() {
  destroyReportCharts();
  const month = document.getElementById("r-month").value;
  const container = document.getElementById("monthly-report-result");
  if (!month) {
    container.innerHTML = '<p class="empty-tip">请选择月份</p>';
    return;
  }
  await reportsEnsureData(month);

  var checkins;
  var checkouts;
  var payMap = {};
  var payMethods;
  var byDay;
  if (useOnlineDataPath()) {
    var monthly = rcMonthlyReportData(month);
    checkins = monthly.checkins;
    checkouts = monthly.checkouts;
    monthly.payments.forEach(function (p) {
      payMap[p.type] = p.total || 0;
    });
    payMethods = monthly.payMethods;
    byDay = monthly.byDay;
  } else {
    checkins =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE check_in_date LIKE ? AND status IN ('在住','已退')",
        [month + "%"],
      )[0]?.c || 0;
    checkouts =
      query(
        "SELECT COUNT(*) as c FROM lodgers WHERE actual_check_out LIKE ? AND status IN ('在住','已退')",
        [month + "%"],
      )[0]?.c || 0;
    query(
      `
    SELECT p.type, COALESCE(SUM(p.amount), 0) as total
    FROM payments p
    LEFT JOIN lodgers l ON l.id = p.lodger_id
    WHERE p.paid_at LIKE ? AND (p.lodger_id IS NULL OR l.status IN ('在住', '已退'))
    GROUP BY p.type
  `,
      [month + "%"],
    ).forEach(function (p) {
      payMap[p.type] = p.total || 0;
    });
    payMethods = query(
      `
    SELECT COALESCE(NULLIF(p.method, ''), '未填写') as method,
           COALESCE(SUM(p.amount), 0) as total,
           COUNT(*) as cnt
    FROM payments p
    LEFT JOIN lodgers l ON l.id = p.lodger_id
    WHERE p.paid_at LIKE ? AND (p.lodger_id IS NULL OR l.status IN ('在住', '已退'))
    GROUP BY COALESCE(NULLIF(p.method, ''), '未填写')
    ORDER BY total DESC
  `,
      [month + "%"],
    );
    byDay = query(
      `
    SELECT check_in_date as day, COUNT(*) as cnt
    FROM lodgers
    WHERE check_in_date LIKE ? AND status IN ('在住','已退')
    GROUP BY check_in_date
    ORDER BY check_in_date
  `,
      [month + "%"],
    );
  }

  const meals = getMealMonthStats(month);

  const chartSection = byDay.length
    ? `<div class="forecast-charts">${chartBoxHtml("每日入住趋势", "chart-monthly-checkins", true)}${chartBoxHtml("月款项构成", "chart-monthly-pay")}</div>`
    : "";

  container.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${checkins}</div><div class="label">月入住人次</div></div>
      <div class="stat"><div class="num">${checkouts}</div><div class="label">月退房人次</div></div>
      <div class="stat"><div class="num">${(payMap["押金"] || 0).toFixed(2)}</div><div class="label">押金</div></div>
      <div class="stat"><div class="num">${(payMap["房费"] || 0).toFixed(2)}</div><div class="label">房费</div></div>
      <div class="stat"><div class="num">${(payMap["退款"] || 0).toFixed(2)}</div><div class="label">退款</div></div>
      <div class="stat"><div class="num">${meals.bf || 0}</div><div class="label">早斋</div></div>
      <div class="stat"><div class="num">${meals.lc || 0}</div><div class="label">午斋</div></div>
      <div class="stat"><div class="num">${meals.dn || 0}</div><div class="label">药石</div></div>
    </div>
    ${chartSection}
    <h3>收款方式统计</h3>
    ${renderPaymentMethodTable(payMethods)}
    <h3 style="margin-top: var(--space-4);">每日入住人次</h3>
    ${byDay.length ? `<table><thead><tr><th>日期</th><th>入住人次</th></tr></thead><tbody>${byDay.map((r) => `<tr><td>${r.day}</td><td>${r.cnt}</td></tr>`).join("")}</tbody></table>` : '<p class="empty-tip">无</p>'}
  `;

  renderMonthlyReportCharts(byDay, payMap);
}

function renderMonthlyReportCharts(byDay, payMap) {
  if (typeof Chart === "undefined") return;
  const T = getChartTheme();
  if (byDay.length) {
    createKetangChart("report-monthly-checkins", "chart-monthly-checkins", {
      type: "line",
      data: {
        labels: byDay.map((r) => r.day.slice(8)),
        datasets: [
          {
            label: "入住人次",
            data: byDay.map((r) => r.cnt),
            borderColor: T.primary,
            backgroundColor: "rgba(166, 75, 63, 0.12)",
            fill: true,
            tension: 0.25,
            pointRadius: 3,
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { stepSize: 1 } } },
      },
    });
  }
  const payLabels = [];
  const payData = [];
  const payColors = [];
  [
    ["押金", T.success],
    ["房费", T.primary],
    ["退款", T.depart],
  ].forEach(function (pair) {
    const val = payMap[pair[0]] || 0;
    if (val > 0) {
      payLabels.push(pair[0]);
      payData.push(val);
      payColors.push(pair[1]);
    }
  });
  if (payData.length) {
    createKetangChart("report-monthly-pay", "chart-monthly-pay", {
      type: "doughnut",
      data: {
        labels: payLabels,
        datasets: [
          { data: payData, backgroundColor: payColors, borderWidth: 1 },
        ],
      },
      options: { plugins: { legend: { position: "right" } } },
    });
  }
}

async function exportMonthlyReportCSV() {
  const month = document.getElementById("r-month").value;
  if (!month) {
    alert("请选择月份");
    return;
  }
  await reportsEnsureData(month);
  const byDay = useOnlineDataPath()
    ? rcMonthlyReportData(month).byDay
    : query(
        `
    SELECT check_in_date as day, COUNT(*) as cnt
    FROM lodgers
    WHERE check_in_date LIKE ? AND status IN ('在住', '已退')
    GROUP BY check_in_date
    ORDER BY check_in_date
  `,
        [month + "%"],
      );
  const lines = ["\uFEFF" + ["日期", "入住人次"].map(csvCell).join(",")];
  byDay.forEach((r) => lines.push([r.day, r.cnt].map(csvCell).join(",")));
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `monthly_report_${month}.csv`);
}

/* ============================================================
   营期统计报表 | Event Report
   ============================================================ */

async function renderEventReport() {
  await reportsEnsureData();
  destroyReportCharts();
  const eventId = document.getElementById("r-event").value;
  const groupBy = document.getElementById("r-event-group").value || "role";
  const container = document.getElementById("event-report-result");
  if (!container) return;

  const members = useOnlineDataPath()
    ? rcEventReportMembers(eventId || null)
    : (function () {
        let sql = `
    SELECT name, dharma_name, gender, role, class_name, '在住' as kind, status,
      check_in_date as date_in, expected_check_out as date_out
    FROM lodgers
    WHERE event_id = ? AND status = '在住'
    UNION ALL
    SELECT name, dharma_name, gender, role, class_name, '预约' as kind, status,
      expected_check_in as date_in, expected_check_out as date_out
    FROM reservations
    WHERE event_id = ? AND status IN ('预约', '已确认')
  `;
        let params = [eventId || 0, eventId || 0];
        if (!eventId) {
          sql = `
      SELECT name, dharma_name, gender, role, class_name, '在住' as kind, status,
        check_in_date as date_in, expected_check_out as date_out
      FROM lodgers
      WHERE event_id IS NOT NULL AND status = '在住'
      UNION ALL
      SELECT name, dharma_name, gender, role, class_name, '预约' as kind, status,
        expected_check_in as date_in, expected_check_out as date_out
      FROM reservations
      WHERE event_id IS NOT NULL AND status IN ('预约', '已确认')
    `;
          params = [];
        }
        return query(sql, params);
      })();

  if (members.length === 0) {
    container.innerHTML = '<p class="empty-tip">无记录。</p>';
    return;
  }

  const groups = {};
  members.forEach((m) => {
    const key = m[groupBy] || "未分类";
    if (!groups[key])
      groups[key] = { count: 0, male: 0, female: 0, checkedIn: 0, reserved: 0 };
    groups[key].count++;
    if (m.gender === "男") groups[key].male++;
    if (m.gender === "女") groups[key].female++;
    if (m.kind === "在住") groups[key].checkedIn++;
    else groups[key].reserved++;
  });

  const groupNames = Object.keys(groups).sort();
  const groupLabel =
    groupBy === "role" ? "身份" : groupBy === "class_name" ? "班级" : "性别";

  const total = {
    count: members.length,
    male: members.filter((m) => m.gender === "男").length,
    female: members.filter((m) => m.gender === "女").length,
    checkedIn: members.filter((m) => m.kind === "在住").length,
    reserved: members.filter((m) => m.kind === "预约").length,
  };

  let html = `
    <div class="stats">
      <div class="stat"><div class="num">${total.count}</div><div class="label">总人数</div></div>
      <div class="stat"><div class="num">${total.male}</div><div class="label">男</div></div>
      <div class="stat"><div class="num">${total.female}</div><div class="label">女</div></div>
      <div class="stat"><div class="num">${total.checkedIn}</div><div class="label">已入住</div></div>
      <div class="stat"><div class="num">${total.reserved}</div><div class="label">仅预约</div></div>
    </div>
    <div class="forecast-charts">
      ${chartBoxHtml("按" + groupLabel + " · 性别", "chart-event-gender")}
      ${chartBoxHtml("按" + groupLabel + " · 入住状态", "chart-event-status")}
    </div>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>${groupLabel}</th>
        <th>人数</th><th>男</th><th>女</th><th>已入住</th><th>仅预约</th>
      </tr></thead><tbody>
  `;
  groupNames.forEach((key) => {
    const g = groups[key];
    html += `<tr>
      <td>${escapeHtml(key)}</td>
      <td>${g.count}</td>
      <td>${g.male}</td>
      <td>${g.female}</td>
      <td>${g.checkedIn}</td>
      <td>${g.reserved}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  html += `<h3 class="section-title">营期入住明细</h3>`;
  html += `<div class="table-wrap"><table>
    <thead><tr>
      <th>姓名 / 法名</th><th>性别</th><th>身份</th><th>班级</th><th>类型</th><th>状态</th><th>入住/预计入住</th><th>预离</th>
    </tr></thead><tbody>`;
  members.forEach((m) => {
    html += `<tr>
      <td>${escapeHtml(personDisplayName(m))}</td>
      <td>${escapeHtml(m.gender) || "-"}</td>
      <td>${escapeHtml(m.role) || "-"}</td>
      <td>${escapeHtml(m.class_name) || "-"}</td>
      <td>${m.kind}</td>
      <td>${escapeHtml(m.status)}</td>
      <td>${escapeHtml(m.date_in) || "-"}</td>
      <td>${escapeHtml(m.date_out) || "-"}</td>
    </tr>`;
  });
  html += `</tbody></table></div>`;

  container.innerHTML = html;
  renderEventReportCharts(groupNames, groups);
}

function renderEventReportCharts(groupNames, groups) {
  if (typeof Chart === "undefined") return;
  const T = getChartTheme();
  createKetangChart("report-event-gender", "chart-event-gender", {
    type: "bar",
    data: {
      labels: groupNames.map((k) => k),
      datasets: [
        {
          label: "男",
          data: groupNames.map((k) => groups[k].male),
          backgroundColor: T.male,
          stack: "gender",
        },
        {
          label: "女",
          data: groupNames.map((k) => groups[k].female),
          backgroundColor: T.female,
          stack: "gender",
        },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { stepSize: 1 } },
      },
    },
  });
  createKetangChart("report-event-status", "chart-event-status", {
    type: "bar",
    data: {
      labels: groupNames.map((k) => k),
      datasets: [
        {
          label: "已入住",
          data: groupNames.map((k) => groups[k].checkedIn),
          backgroundColor: T.registered,
          stack: "status",
        },
        {
          label: "仅预约",
          data: groupNames.map((k) => groups[k].reserved),
          backgroundColor: T.gap,
          stack: "status",
        },
      ],
    },
    options: {
      scales: {
        x: { stacked: true },
        y: { stacked: true, ticks: { stepSize: 1 } },
      },
    },
  });
}

function exportEventReportCSV() {
  const eventId = document.getElementById("r-event").value;

  const members = useOnlineDataPath()
    ? rcEventReportMembers(eventId || null)
    : (function () {
        let sql = `
    SELECT name, dharma_name, gender, role, class_name, '在住' as kind, status,
      check_in_date as date_in, expected_check_out as date_out
    FROM lodgers
    WHERE event_id = ? AND status = '在住'
    UNION ALL
    SELECT name, dharma_name, gender, role, class_name, '预约' as kind, status,
      expected_check_in as date_in, expected_check_out as date_out
    FROM reservations
    WHERE event_id = ? AND status IN ('预约', '已确认')
  `;
        let params = [eventId || 0, eventId || 0];
        if (!eventId) {
          sql = `
      SELECT name, dharma_name, gender, role, class_name, '在住' as kind, status,
        check_in_date as date_in, expected_check_out as date_out
      FROM lodgers
      WHERE event_id IS NOT NULL AND status = '在住'
      UNION ALL
      SELECT name, dharma_name, gender, role, class_name, '预约' as kind, status,
        expected_check_in as date_in, expected_check_out as date_out
      FROM reservations
      WHERE event_id IS NOT NULL AND status IN ('预约', '已确认')
    `;
          params = [];
        }
        return query(sql, params);
      })();
  const headers = [
    "姓名 / 法名",
    "性别",
    "身份",
    "班级",
    "类型",
    "状态",
    "入住/预计入住",
    "预离",
  ];
  const lines = ["\uFEFF" + headers.map(csvCell).join(",")];
  members.forEach((m) => {
    lines.push(
      [
        personDisplayName(m),
        m.gender || "",
        m.role || "",
        m.class_name || "",
        m.kind,
        m.status,
        m.date_in || "",
        m.date_out || "",
      ]
        .map(csvCell)
        .join(","),
    );
  });

  const suffix = eventId ? "event_" + eventId : "all_events";
  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  downloadBlob(blob, `event_report_${suffix}.csv`);
}
