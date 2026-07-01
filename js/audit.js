function logAudit(action, targetType, targetId, detail) {
  try {
    const enriched = detail || {};
    if (typeof getCurrentUser === 'function') {
      const user = getCurrentUser();
      if (user) {
        enriched._operator = user.display_name || user.username;
        enriched._operator_id = user.id;
        enriched._operator_role = user.role;
      }
    }
    run("INSERT INTO audit_logs (action, target_type, target_id, detail) VALUES (?, ?, ?, ?)",
      [action, targetType || null, targetId || null, JSON.stringify(enriched)]);
    return true;
  } catch (e) {
    console.warn('审计日志写入失败：', e);
    if (typeof showToast === 'function') {
      showToast('审计日志写入失败：' + (e && e.message ? e.message : '未知错误'));
    }
    return false;
  }
}

