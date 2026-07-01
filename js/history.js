function renderHistory() {
  const tbody = document.getElementById("history-table");
  tbody.innerHTML = "";
  const start = document.getElementById("h-start").value;
  const end = document.getElementById("h-end").value;
  const kw = document.getElementById("h-keyword").value.trim();
  const room = document.getElementById("h-room").value.trim();
  const role = document.getElementById("h-role").value;
  let sql = `
    SELECT l.*, r.name as room_name, b.bed_number, e.name as event_name
    FROM lodgers l
    LEFT JOIN beds b ON b.id = l.bed_id
    LEFT JOIN rooms r ON r.id = b.room_id
    LEFT JOIN events e ON e.id = l.event_id
    WHERE 1=1
  `;
  const params = [];
  if (start) {
    sql += " AND l.check_in_date >= ?";
    params.push(start);
  }
  if (end) {
    sql += " AND l.check_in_date <= ?";
    params.push(end);
  }
  if (room) {
    sql += " AND (r.name LIKE ? OR b.bed_number LIKE ?)";
    params.push("%" + room + "%", "%" + room + "%");
  }
  if (role) {
    const roleVals = lodgerRoleMatchValues(role);
    sql +=
      " AND l.role IN (" +
      roleVals
        .map(function () {
          return "?";
        })
        .join(",") +
      ")";
    params.push.apply(params, roleVals);
  }
  if (kw) {
    sql += " AND (l.name LIKE ? OR l.dharma_name LIKE ? OR l.phone LIKE ?)";
    params.push("%" + kw + "%", "%" + kw + "%", "%" + kw + "%");
  }
  sql += " ORDER BY l.check_in_date DESC, l.id DESC";
  const rows = query(sql, params);
  rows.forEach((r) => {
    const meal = getMealSummary(r.id);
    const mealLabel = `早${meal.breakfast} 午${meal.lunch} 晚${meal.dinner}`;
    const bedLabel = escapeHtml(
      (r.room_name || "-") + (r.bed_number ? "/" + r.bed_number : ""),
    );
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${bedLabel}</td>
      <td>${escapeHtml(personDisplayName(r))}</td>
      <td>${escapeHtml(lodgerRoleDisplayName(r.role)) || "-"}</td>
      <td>${escapeHtml(r.gender) || "-"}</td>
      <td>${escapeHtml(r.phone) || "-"}</td>
      <td>${escapeHtml(r.check_in_date) || "-"}</td>
      <td>${escapeHtml(r.expected_check_out) || "-"}</td>
      <td>${escapeHtml(r.actual_check_out) || "-"}</td>
      <td>${escapeHtml(r.status) || "-"}</td>
      <td>${mealLabel}</td>
      <td>${escapeHtml(r.notes) || "-"}</td>
      <td>${r.status !== "在住" ? `<button class="btn btn-danger btn-sm" onclick="deleteLodger(${r.id})">删除</button>` : '<span class="text-muted">在住</span>'}</td>
    `;
    tbody.appendChild(tr);
  });
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="empty-tip">无匹配记录</td></tr>';
  }
}

function resetHistoryFilter() {
  document.getElementById("h-start").value = "";
  document.getElementById("h-end").value = "";
  document.getElementById("h-keyword").value = "";
  document.getElementById("h-room").value = "";
  document.getElementById("h-role").value = "";
  renderHistory();
}

function exportCSV() {
  const rows = query(`
    SELECT l.*, r.name as room_name, b.bed_number, e.name as event_name
    FROM lodgers l
    LEFT JOIN beds b ON b.id=l.bed_id
    LEFT JOIN rooms r ON r.id=b.room_id
    LEFT JOIN events e ON e.id=l.event_id
    ORDER BY l.check_in_date DESC, l.id DESC
  `);
  const headers = [
    "序号",
    "房间/床位",
    "姓名",
    "身份",
    "性别",
    "手机号",
    "身份证",
    "入住日期",
    "预离日期",
    "实际离院日期",
    "状态",
    "来源",
    "营期",
    "班级",
    "早斋天数",
    "午斋天数",
    "药石天数",
    "押金",
    "房费",
    "退款",
    "净收款",
    "备注",
  ];
  const lines = ["\uFEFF" + headers.map(csvCell).join(",")];
  rows.forEach((r, idx) => {
    const meal = getMealSummary(r.id);
    const bedLabel =
      (r.room_name || "") + (r.bed_number ? "/" + r.bed_number : "");
    const pay = query(
      "SELECT COALESCE(SUM(CASE WHEN type='押金' THEN amount ELSE 0 END),0) as deposit, COALESCE(SUM(CASE WHEN type='房费' THEN amount ELSE 0 END),0) as room_fee, COALESCE(SUM(CASE WHEN type='退款' THEN amount ELSE 0 END),0) as refund FROM payments WHERE lodger_id=?",
      [r.id],
    )[0];
    const net = (pay.deposit + pay.room_fee - pay.refund).toFixed(2);
    const cols = [
      idx + 1,
      bedLabel,
      personDisplayName(r),
      r.role || "",
      r.gender || "",
      r.phone || "",
      r.id_card || "",
      r.check_in_date || "",
      r.expected_check_out || "",
      r.actual_check_out || "",
      r.status || "",
      r.source || "",
      r.event_name || "",
      r.class_name || "",
      meal.breakfast,
      meal.lunch,
      meal.dinner,
      pay.deposit,
      pay.room_fee,
      pay.refund,
      net,
      r.notes || "",
    ].map((c) => '"' + String(c).replace(/"/g, '""') + '"');
    lines.push(cols.join(","));
  });
  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ketang_ledger_" + todayStr() + ".csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("已导出 CSV 台账");
}
