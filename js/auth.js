/* ============================================================
   用户认证与权限 | Auth & Permissions
   本地多账号切换，共享同一套底层数据
   ============================================================ */

const AUTH_STORAGE_KEY = "ketang_current_user";

// 当前登录用户缓存
let currentUser = null;
let cachedAdminUsers = [];
let loginSubmitting = false;
/** unknown | authenticated | anonymous — remote gate; local uses currentUser */
let authStatus = "unknown";
/** 强制改密弹窗打开时不允许关闭 | Block modal dismiss during forced password change */
let passwordChangeBlocking = false;

function setAuthStatus(status) {
  authStatus = status || "unknown";
}

function getAuthStatus() {
  return authStatus;
}

function markAuthenticated() {
  setAuthStatus("authenticated");
}

function markAnonymous() {
  setAuthStatus("anonymous");
}

function applySessionRefresh(result) {
  if (!result) return;
  if (typeof setRemoteRefreshBlocked === "function")
    setRemoteRefreshBlocked(false);
  if (result.user) {
    currentUser = result.user;
    if (result.permissions) setSessionPermissions(result.permissions);
    else if (currentUser.role) {
      setSessionPermissions(
        getSessionPermissionsForRole(currentUser.role, currentUser),
      );
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    markAuthenticated();
    updateAuthUI();
    applyPermissions();
    schedulePasswordChangePromptIfNeeded();
  }
}

function handleApiUnauthorized() {
  clearAuthSession();
  if (typeof stopBoardPolling === "function") stopBoardPolling();
  showLoginOverlay();
}

function useRemoteAdminUsers() {
  return useOnlineDataPath();
}

async function ensureAdminUsersCache() {
  if (!useRemoteAdminUsers()) return cachedAdminUsers;
  const data = await apiAdminListUsers();
  cachedAdminUsers = data.users || [];
  return cachedAdminUsers;
}

function findAdminUserById(id) {
  const numericId = parseInt(id, 10);
  return (
    cachedAdminUsers.find(function (u) {
      return u.id === numericId;
    }) || null
  );
}

async function lookupAdminUser(id) {
  if (!useRemoteAdminUsers()) {
    return (
      query(
        "SELECT id, username, display_name, role, is_active FROM users WHERE id = ?",
        [id],
      )[0] || null
    );
  }
  let user = findAdminUserById(id);
  if (!user) {
    await ensureAdminUsersCache();
    user = findAdminUserById(id);
  }
  return user;
}

function restoreCachedUserFromStorage(isRemote) {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!saved) return;
  try {
    currentUser = JSON.parse(saved);
    if (currentUser?.permissions) {
      setSessionPermissions(currentUser.permissions);
    } else if (currentUser?.role) {
      setSessionPermissions(
        getSessionPermissionsForRole(currentUser.role, currentUser),
      );
    }
  } catch (e) {
    currentUser = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
}

function bootAuthUI() {
  const isRemote = typeof isRemoteDB === "function" && isRemoteDB();
  if (isRemote && typeof purgeLegacyClientTokens === "function") {
    purgeLegacyClientTokens();
  }
  restoreCachedUserFromStorage(isRemote);

  if (isRemote) {
    if (
      typeof isRemoteRefreshBlocked === "function" &&
      isRemoteRefreshBlocked()
    ) {
      showLoginOverlay();
      return;
    }
    if (currentUser) {
      showCachedSessionBootstrapping();
      return;
    }
    // No cached user yet: use a neutral boot gate until session is confirmed.
    showBootstrapping();
    return;
  }

  if (currentUser) {
    markAuthenticated();
    updateAuthUI();
    clearAuthPendingGate();
  } else {
    showLoginOverlay();
  }
}

function finishLocalAuth() {
  if (typeof isRemoteDB === "function" && isRemoteDB()) return;
  if (!currentUser || typeof query !== "function") return;
  try {
    const row = query(
      "SELECT auth_version, is_active FROM users WHERE id = ? LIMIT 1",
      [currentUser.id],
    )[0];
    if (
      !row ||
      row.is_active === 0 ||
      Number(row.auth_version || 1) !== Number(currentUser.auth_version || 1)
    ) {
      currentUser = null;
      localStorage.removeItem(AUTH_STORAGE_KEY);
      markAnonymous();
    } else if (currentUser.permissions) {
      setSessionPermissions(currentUser.permissions);
      markAuthenticated();
    } else if (currentUser.role) {
      setSessionPermissions(
        getSessionPermissionsForRole(currentUser.role, currentUser),
      );
      markAuthenticated();
    }
  } catch (e) {
    currentUser = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    markAnonymous();
  }
  updateAuthUI();
}

/** @deprecated use bootAuthUI + finishLocalAuth | Legacy init entry */
function initAuth() {
  bootAuthUI();
  finishLocalAuth();
}

function syncAuthBodyClass() {
  document.body.classList.toggle("auth-logged-in", isLoggedIn());
}

function setBootBannerVisible(visible) {
  const el = document.getElementById("app-boot-banner");
  if (el) el.hidden = !visible;
}

function setAuthBootScreenVisible(visible) {
  const el = document.getElementById("auth-boot-screen");
  const card = el ? el.querySelector(".auth-boot-card") : null;
  if (el) el.classList.toggle("active", !!visible);
  if (card) card.setAttribute("aria-busy", visible ? "true" : "false");
}

function clearAuthPendingGate() {
  document.documentElement.classList.remove("ketang-auth-pending");
  setAuthBootScreenVisible(false);
}

function showBootstrapping() {
  // 认证未知时只显示中性启动屏，不显示登录页 | Unknown auth shows neutral boot, not the login UI.
  document.body.classList.remove("auth-logged-in");
  document.body.classList.remove("auth-login-required");
  document.body.classList.add("auth-bootstrapping");
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.classList.remove("active");
  setLoginOverlayPanel("form");
  setAuthBootScreenVisible(true);
  setBootBannerVisible(false);
}

function showCachedSessionBootstrapping() {
  // 冷启动保持单一 loading 态：显示应用壳但不再叠加第二条启动横幅 | Keep a single loading state: show shell without a second startup banner.
  markAuthenticated();
  document.body.classList.remove("auth-login-required");
  document.body.classList.add("auth-bootstrapping");
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.classList.remove("active");
  setLoginOverlayPanel("form");
  updateAuthUI();
  clearAuthPendingGate();
  setBootBannerVisible(false);
}

function hideBootstrapping() {
  document.body.classList.remove("auth-bootstrapping");
  setAuthBootScreenVisible(false);
  setBootBannerVisible(false);
}

function closeProfileMenu() {
  const menu = document.getElementById("topbar-profile-menu");
  const btn = document.getElementById("topbar-profile-btn");
  const mobileBtn = document.getElementById("mobile-title-profile");
  if (menu) menu.hidden = true;
  if (btn) btn.setAttribute("aria-expanded", "false");
  if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "false");
}

function toggleProfileMenu(event) {
  if (event) event.stopPropagation();
  if (!currentUser) return;
  const menu = document.getElementById("topbar-profile-menu");
  const btn = document.getElementById("topbar-profile-btn");
  const mobileBtn = document.getElementById("mobile-title-profile");
  if (!menu) return;
  const willOpen = menu.hidden;
  closeProfileMenu();
  if (!willOpen) return;
  menu.hidden = false;
  if (btn) btn.setAttribute("aria-expanded", "true");
  if (mobileBtn) mobileBtn.setAttribute("aria-expanded", "true");
}

function teardownLoginSelectPicker(sel) {
  if (!sel || !sel.hasAttribute("data-picker-upgraded")) return;
  const wrap = sel.closest(".select-picker");
  if (wrap) {
    wrap.parentNode.insertBefore(sel, wrap);
    wrap.remove();
    sel.removeAttribute("data-picker-upgraded");
    sel.classList.remove("picker-native-hidden");
  }
}

function clearAuthSession() {
  closeProfileMenu();
  currentUser = null;
  markAnonymous();
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (typeof resetRemoteReadModelState === "function")
    resetRemoteReadModelState();
  syncAuthBodyClass();
}

/** 网络抖动时沿用本地缓存用户（已确认过的会话）| Degraded authenticated from cache */
function acceptCachedSessionDegraded(message) {
  if (!currentUser) return false;
  markAuthenticated();
  updateAuthUI();
  applyPermissions();
  hideLoginOverlay();
  if (typeof showToast === "function") {
    showToast("会话校验暂时失败，已使用本地缓存登录态：" + message);
  }
  return true;
}

function shouldRequestRestoreBootstrapBoard() {
  if (typeof rcHasSeededBoard === "function") return !rcHasSeededBoard();
  return true;
}

function applyRestoreBootstrapBoard(data) {
  if (typeof rcApplyLoginBootstrap === "function") rcApplyLoginBootstrap(data);
}

async function restoreRemoteSession() {
  if (typeof isRemoteDB !== "function" || !isRemoteDB()) {
    return !!currentUser && authStatus === "authenticated";
  }

  if (
    typeof isRemoteRefreshBlocked === "function" &&
    isRemoteRefreshBlocked()
  ) {
    clearAuthSession();
    showLoginOverlay();
    return false;
  }

  if (!currentUser) showBootstrapping();

  try {
    var restoreBootstrap = shouldRequestRestoreBootstrapBoard();
    const data = await apiSessionMeForRestore({
      bootstrapBoard: restoreBootstrap,
    });
    applySessionRefresh(data);
    applyRestoreBootstrapBoard(data);
    hideLoginOverlay();
    return true;
  } catch (e) {
    const msg = String(e.message || "");
    const authExpired = /登录已过期|401|Unauthorized/i.test(msg);
    if (!authExpired && acceptCachedSessionDegraded(msg)) {
      return true;
    }
  }

  try {
    var restoreBootstrap = shouldRequestRestoreBootstrapBoard();
    const data = await apiAuthRefreshForRestore({
      bootstrapBoard: restoreBootstrap,
    });
    applySessionRefresh(data);
    applyRestoreBootstrapBoard(data);
    hideLoginOverlay();
    return true;
  } catch (e) {
    const msg = String(e.message || "");
    const authExpired = /登录已过期|401|Unauthorized/i.test(msg);
    if (authExpired) {
      clearAuthSession();
      showLoginOverlay();
      return false;
    }
    if (acceptCachedSessionDegraded(msg)) {
      return true;
    }
    clearAuthSession();
    showLoginOverlay();
    return false;
  }
}

function getCurrentUser() {
  return currentUser;
}

function isLoggedIn() {
  if (typeof isRemoteDB === "function" && isRemoteDB()) {
    return authStatus === "authenticated";
  }
  return !!currentUser;
}

function isAdmin() {
  return currentUser && currentUser.role === "admin";
}

function isZhike() {
  return currentUser && currentUser.role === "zhike";
}

async function login(username, password) {
  if (typeof isRemoteDB === "function" && isRemoteDB()) {
    let result;
    try {
      result = await apiAuthLogin({
        username: username,
        password: password,
        bootstrap_board: true,
      });
    } catch (err) {
      console.warn("云端登录失败 | Remote login failed:", err);
      throw err;
    }
    if (!result.user) throw new Error("登录成功但未收到用户信息，请刷新后重试");
    applySessionRefresh(result);
    if (typeof rcApplyLoginBootstrap === "function") {
      rcApplyLoginBootstrap(result);
    }
    logAudit("用户登录", "user", result.user.id, {
      username: result.user.username,
      role: result.user.role,
    });
    updateAuthUI();
    applyPermissions();
    schedulePostLoginUiMounts();
    return true;
  }
  const user = query(
    "SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1",
    [username],
  )[0];
  if (!user || !(await verifyPasswordAsync(password, user.password)))
    return false;
  await upgradePasswordHashIfLegacy(user.id, password, user.password);
  const fresh =
    query("SELECT * FROM users WHERE id = ? LIMIT 1", [user.id])[0] || user;
  currentUser = {
    id: fresh.id,
    username: fresh.username,
    display_name: fresh.display_name,
    role: fresh.role,
    is_advanced: fresh.is_advanced ? 1 : 0,
    auth_version: fresh.auth_version || 1,
    must_change_password: fresh.must_change_password ? 1 : 0,
  };
  setSessionPermissions(
    getSessionPermissionsForRole(currentUser.role, currentUser),
  );
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
  markAuthenticated();
  logAudit("用户登录", "user", user.id, {
    username: user.username,
    role: user.role,
  });
  updateAuthUI();
  applyPermissions();
  schedulePostLoginUiMounts();
  schedulePasswordChangePromptIfNeeded();
  return true;
}

async function loginByRole(role, password) {
  if (typeof isRemoteDB === "function" && isRemoteDB()) {
    let result;
    try {
      result = await apiAuthLogin({
        role: role,
        password: password,
        bootstrap_board: true,
      });
    } catch (err) {
      console.warn("云端身份登录失败 | Remote role login failed:", err);
      throw err;
    }
    if (!result.user) throw new Error("登录成功但未收到用户信息，请刷新后重试");
    applySessionRefresh(result);
    if (typeof rcApplyLoginBootstrap === "function") {
      rcApplyLoginBootstrap(result);
    }
    logAudit("用户登录", "user", result.user.id, {
      username: result.user.username,
      role: result.user.role,
    });
    updateAuthUI();
    applyPermissions();
    return true;
  }

  const users = query(
    "SELECT * FROM users WHERE role = ? AND (is_active IS NULL OR is_active = 1) ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username",
    [role, role],
  );
  for (const user of users) {
    if (!(await verifyPasswordAsync(password, user.password))) continue;
    await upgradePasswordHashIfLegacy(user.id, password, user.password);
    const fresh =
      query("SELECT * FROM users WHERE id = ? LIMIT 1", [user.id])[0] || user;
    currentUser = {
      id: fresh.id,
      username: fresh.username,
      display_name: fresh.display_name,
      role: fresh.role,
      is_advanced: fresh.is_advanced ? 1 : 0,
      auth_version: fresh.auth_version || 1,
      must_change_password: fresh.must_change_password ? 1 : 0,
    };
    setSessionPermissions(
      getSessionPermissionsForRole(currentUser.role, currentUser),
    );
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    markAuthenticated();
    logAudit("用户登录", "user", user.id, {
      username: user.username,
      role: user.role,
    });
    updateAuthUI();
    applyPermissions();
    schedulePostLoginUiMounts();
    schedulePasswordChangePromptIfNeeded();
    return true;
  }
  return false;
}

async function logout() {
  closeProfileMenu();
  if (currentUser) {
    logAudit("用户登出", "user", currentUser.id, {
      username: currentUser.username,
    });
  }
  if (typeof isRemoteDB === "function" && isRemoteDB()) {
    if (typeof setRemoteRefreshBlocked === "function")
      setRemoteRefreshBlocked(true);
    if (typeof apiAuthLogout === "function") await apiAuthLogout();
  }
  clearAuthSession();
  if (typeof remoteLogout === "function") remoteLogout();
  updateAuthUI();
  if (typeof stopBoardPolling === "function") stopBoardPolling();
  showLoginOverlay();
}

function updateAuthUI() {
  syncAuthBodyClass();
  const profileWrap = document.getElementById("topbar-profile-wrap");
  const profileName = document.getElementById("topbar-profile-name");
  const profileAvatar = document.querySelector(".topbar-avatar");
  const mobileAvatar = document.getElementById("mobile-title-avatar");
  const profileRole = document.getElementById("topbar-profile-role");
  if (!currentUser) {
    closeProfileMenu();
    if (profileWrap) profileWrap.hidden = true;
    if (profileName) profileName.textContent = "";
    if (profileAvatar) profileAvatar.textContent = "—";
    if (mobileAvatar) mobileAvatar.textContent = "—";
    if (profileRole) profileRole.textContent = "";
    return;
  }
  if (profileWrap) profileWrap.hidden = false;
  const display = currentUser.display_name || currentUser.username;
  const roleLabel =
    USER_ROLE_OPTIONS.find((opt) => opt[0] === currentUser.role)?.[1] ||
    (currentUser.role === "admin" ? "管理员" : "知客师");
  if (profileName) profileName.textContent = display;
  if (profileAvatar) profileAvatar.textContent = display.charAt(0);
  if (mobileAvatar) mobileAvatar.textContent = display.charAt(0);
  if (profileRole) profileRole.textContent = roleLabel;
}

function setLoginOverlayPanel(mode) {
  const overlay = document.getElementById("login-overlay");
  const formPanel = document.getElementById("login-form-panel");
  const restorePanel = document.getElementById("login-restore-panel");
  if (!overlay || !formPanel || !restorePanel) return;
  const restoring = mode === "restore";
  formPanel.hidden = restoring;
  restorePanel.hidden = !restoring;
  overlay.classList.toggle("login-overlay--restore", restoring);
}

function showLoginOverlay() {
  if (typeof closeAllSelectPickers === "function") closeAllSelectPickers();
  closeProfileMenu();
  hideBootstrapping();
  markAnonymous();
  document.body.classList.remove("auth-logged-in", "auth-bootstrapping");
  document.body.classList.add("auth-login-required");
  const overlay = document.getElementById("login-overlay");
  const errorEl = document.getElementById("login-error");
  const passwordEl = document.getElementById("login-password");
  if (errorEl) errorEl.textContent = "";
  if (passwordEl) passwordEl.value = "";
  setLoginOverlayPanel("form");
  if (overlay) overlay.classList.add("active");
  syncAuthBodyClass();
  clearAuthPendingGate();
  setLoginPending(false);
  populateLoginUsers();
}

function hideLoginOverlay() {
  const overlay = document.getElementById("login-overlay");
  setLoginOverlayPanel("form");
  if (overlay) overlay.classList.remove("active");
  document.body.classList.remove("auth-login-required");
  hideBootstrapping();
  syncAuthBodyClass();
  clearAuthPendingGate();
}

async function populateLoginUsers() {
  const sel = document.getElementById("login-username");
  if (!sel) return;
  teardownLoginSelectPicker(sel);

  let html = '<option value="">请选择身份</option>';
  USER_ROLE_OPTIONS.forEach((opt) => {
    const role = opt[0];
    const roleLabel = opt[1];
    html += `<option value="${escapeHtml(role)}">${escapeHtml(roleLabel)}</option>`;
  });

  sel.innerHTML = html;
  sel.value = "";
}

function setLoginPending(isPending) {
  loginSubmitting = !!isPending;
  setPendingState({
    inputIds: ["login-username", "login-password"],
    buttonId: "login-submit-btn",
    pending: loginSubmitting,
    pendingText: "登录中…",
    idleText: "登录",
  });
}

function setPendingState(options) {
  const pending = !!options.pending;
  (options.inputIds || []).forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.disabled = pending;
  });
  const btn = document.getElementById(options.buttonId);
  if (!btn) return;
  btn.disabled = pending;
  btn.setAttribute("aria-busy", pending ? "true" : "false");
  btn.textContent = pending ? options.pendingText : options.idleText;
}

function schedulePostLoginUiMounts() {
  var run = function () {
    if (typeof mountFormMealNeedPickers === "function")
      mountFormMealNeedPickers();
    if (typeof mountLodgerRoleSelects === "function") mountLodgerRoleSelects();
    if (typeof mountParticipantTagSelects === "function")
      mountParticipantTagSelects();
  };
  if (typeof scheduleIdleTask === "function") scheduleIdleTask(run);
  else run();
}

async function submitLogin() {
  if (loginSubmitting) return;
  const selectedRole = document.getElementById("login-username").value;
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  if (!selectedRole) {
    if (errorEl) errorEl.textContent = "请选择身份";
    return;
  }
  if (!password) {
    if (errorEl) errorEl.textContent = "请输入密码";
    return;
  }
  setLoginPending(true);
  if (typeof ketangPerfMark === "function") ketangPerfMark("login:start");
  if (errorEl) errorEl.textContent = "正在验证身份，请稍候…";
  try {
    if (await loginByRole(selectedRole, password)) {
      if (errorEl) errorEl.textContent = "正在同步数据，请稍候…";
      document.getElementById("login-password").value = "";
      hideLoginOverlay();
      await renderAll({
        loginBootstrap: typeof isRemoteDB === "function" && isRemoteDB(),
      });
      schedulePostLoginUiMounts();
      if (typeof ketangPerfMark === "function") {
        ketangPerfMark("login:end");
        ketangPerfMark("login-ready");
        ketangPerfMeasure("login", "login:start", "login:end");
        ketangPerfMeasure("login-ready", "login:start", "login-ready");
      }
      if (typeof perfRumOnLoginReady === "function") perfRumOnLoginReady();
      if (errorEl) errorEl.textContent = "";
      if (typeof startBoardPolling === "function") startBoardPolling();
      schedulePasswordChangePromptIfNeeded();
    } else if (errorEl) {
      errorEl.textContent = "账号或密码错误";
    }
  } catch (e) {
    if (errorEl) errorEl.textContent = e.message || "登录失败";
  } finally {
    setLoginPending(false);
  }
}

function applyPermissions() {
  const can = function (code) {
    return hasPermission(code);
  };

  const menuMap = {
    board: can("board.read") || can("meals.read"),
    lodging: can("lodging.read") || can("lodging.checkin"),
    stay: can("lodging.read"),
    forecast: can("board.read"),
    housekeeping: can("housekeeping.read"),
    reports: can("reports.read"),
    history: can("lodging.read"),
    info: can("settings.read"),
    backup: can("backup.read"),
  };

  Object.keys(menuMap).forEach((view) => {
    const btn = document.querySelector(
      '.sidebar-nav-btn[data-view="' + view + '"]',
    );
    const footerBtn = document.querySelector(
      '.sidebar-footer-btn[data-view="' + view + '"]',
    );
    const visible = menuMap[view];
    if (btn) btn.style.display = visible ? "" : "none";
    if (footerBtn) footerBtn.style.display = visible ? "" : "none";
  });

  if (typeof applyMobileMorePermissions === "function") {
    applyMobileMorePermissions();
  }

  // 如果当前在明确标记为隐藏的页面，跳转回房态看板
  const activeView = document.querySelector(".view.active");
  if (activeView) {
    const viewId = activeView.id.replace("view-", "");
    if (menuMap[viewId] === false) showView("board");
  }
}

async function requireAdmin() {
  if (!hasPermission("users.write")) {
    await uiAlert("需要用户管理权限");
    return false;
  }
  return true;
}

let rolePermissionsDraft = null;

function permissionCodeLabel(code) {
  return typeof getPermissionLabel === "function"
    ? getPermissionLabel(code)
    : code;
}

async function loadRolePermissionsConfig() {
  await initRolePermissionDefaults();
  if (useOnlineDataPath()) {
    return apiAdminGetRolePermissions();
  }
  return getRolePermissionsConfigLocal();
}

function renderRolePermissionsPanel() {
  const panel = document.getElementById("role-permissions-panel");
  if (!panel) return;
  if (!requireAdmin()) {
    panel.innerHTML = '<p class="empty-tip">需要 users.write 权限。</p>';
    return;
  }
  panel.innerHTML = '<p class="empty-tip">加载中…</p>';
  loadRolePermissionsConfig()
    .then(function (data) {
      rolePermissionsDraft = {};
      USER_ROLE_OPTIONS.forEach(function (opt) {
        const role = opt[0];
        rolePermissionsDraft[role] = (data.effective[role] || []).slice();
      });
      paintRolePermissionsPanel(panel, data);
    })
    .catch(function (e) {
      panel.innerHTML =
        '<p class="empty-tip">加载失败：' + escapeHtml(e.message) + "</p>";
    });
}

function paintRolePermissionsPanel(panel, data) {
  const groups = getPermissionGroups();
  let html =
    '<div class="role-perm-toolbar btn-bar" style="margin-bottom: var(--space-3);">' +
    '<button type="button" class="btn btn-default" onclick="resetRolePermissionsDraft()">恢复默认模板</button>' +
    '<button type="button" class="btn btn-primary" onclick="saveRolePermissionsConfig()">保存角色权限</button>' +
    "</div>" +
    '<div class="role-perm-matrix">';
  USER_ROLE_OPTIONS.forEach(function (opt) {
    const role = opt[0];
    const label = opt[1];
    html +=
      '<div class="role-perm-column" data-role="' +
      escapeHtml(role) +
      '">' +
      '<h3 class="role-perm-role-title">' +
      escapeHtml(label) +
      "</h3>";
    groups.forEach(function (group) {
      html +=
        '<div class="role-perm-group"><div class="role-perm-group-title">' +
        escapeHtml(group.label) +
        "</div>";
      group.codes.forEach(function (code) {
        const checked = (rolePermissionsDraft[role] || []).includes(code);
        html +=
          '<label class="role-perm-item">' +
          '<input type="checkbox" data-role="' +
          escapeHtml(role) +
          '" data-code="' +
          escapeHtml(code) +
          '" ' +
          (checked ? "checked" : "") +
          " onchange=\"toggleRolePermissionDraft('" +
          escapeHtml(role) +
          "','" +
          escapeHtml(code) +
          "', this.checked)\">" +
          "<span>" +
          escapeHtml(permissionCodeLabel(code)) +
          "</span></label>";
      });
      html += "</div>";
    });
    html += "</div>";
  });
  html += "</div>";
  if (data.custom) {
    html +=
      '<p class="field-hint" style="margin-top: var(--space-3);">当前已使用自定义配置（非全部默认模板）。</p>';
  }
  panel.innerHTML = html;
}

function toggleRolePermissionDraft(role, code, enabled) {
  if (!rolePermissionsDraft[role]) rolePermissionsDraft[role] = [];
  const set = new Set(rolePermissionsDraft[role]);
  if (enabled) set.add(code);
  else set.delete(code);
  rolePermissionsDraft[role] = [...set];
}

async function resetRolePermissionsDraft() {
  if (!(await uiConfirm("确定将所有角色权限恢复为系统默认模板吗？"))) return;
  initRolePermissionDefaults().then(function () {
    const defaults = getDefaultRolePermissions();
    rolePermissionsDraft = {};
    USER_ROLE_OPTIONS.forEach(function (opt) {
      rolePermissionsDraft[opt[0]] = (defaults[opt[0]] || []).slice();
    });
    renderRolePermissionsPanel();
    showToast("已恢复默认模板（尚未保存）");
  });
}

async function saveRolePermissionsConfig() {
  if (!requireAdmin()) return;
  try {
    const sanitized = sanitizeRolePermissionPayload(rolePermissionsDraft);
    if (useOnlineDataPath()) {
      await apiAdminSaveRolePermissions(sanitized);
    } else {
      saveLocalRolePermissions(sanitized);
    }
    showToast("角色权限已保存，请相关账号重新登录后生效");
    renderRolePermissionsPanel();
  } catch (e) {
    await uiAlert("保存失败：" + e.message);
  }
}

function updateUserAdvancedFieldVisibility() {
  const roleEl = document.getElementById("user-role");
  const wrap = document.getElementById("user-advanced-wrap");
  if (!roleEl || !wrap) return;
  wrap.style.display = roleEl.value === "zhike" ? "" : "none";
}

function bindUserRoleAdvancedToggle() {
  const roleEl = document.getElementById("user-role");
  if (!roleEl || roleEl.dataset.advancedBound === "1") return;
  roleEl.dataset.advancedBound = "1";
  roleEl.addEventListener("change", updateUserAdvancedFieldVisibility);
}

async function requireBackupRead() {
  if (!hasPermission("backup.read")) {
    await uiAlert("需要备份读取权限");
    return false;
  }
  return true;
}

async function requireBackupWrite() {
  if (!hasPermission("backup.write")) {
    await uiAlert("需要备份写入权限");
    return false;
  }
  return true;
}

/* ============================================================
   用户管理 | User Management（仅管理员）
   ============================================================ */

const USER_ROLE_OPTIONS = [
  ["admin", "管理员"],
  ["zhike", "知客师"],
  ["kitchen", "厨房"],
  ["housekeeping", "房务"],
  ["viewer", "只读"],
];

function renderUserList() {
  const container = document.getElementById("user-list");
  if (!container) return;
  if (!requireAdmin()) {
    container.innerHTML = '<p class="empty-tip">需要管理员权限。</p>';
    return;
  }
  if (useOnlineDataPath()) {
    apiAdminListUsers()
      .then(function (data) {
        paintUserList(container, data.users || []);
      })
      .catch(function (e) {
        container.innerHTML =
          '<p class="empty-tip">加载用户失败：' +
          escapeHtml(e.message) +
          "</p>";
      });
    return;
  }
  paintUserList(
    container,
    query("SELECT * FROM users ORDER BY role, username"),
  );
}

function paintUserList(container, users) {
  cachedAdminUsers = users.slice();
  if (!users.length) {
    container.innerHTML = '<p class="empty-tip">暂无用户。</p>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr><th>账号</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead><tbody>`;
  users.forEach((u) => {
    const roleLabel =
      USER_ROLE_OPTIONS.find((opt) => opt[0] === u.role)?.[1] || u.role;
    const advancedTag =
      u.role === "zhike" && u.is_advanced
        ? ' <span class="room-tag" style="background:#fff3e0;color:#e65100">高级</span>'
        : "";
    const isCurrent = currentUser && currentUser.id === u.id;
    const activeLabel =
      u.is_active === 0
        ? '<span class="room-tag" style="background:#ffebee;color:#c62828">已停用</span>'
        : "";
    html += `<tr>
      <td>${escapeHtml(u.username)} ${isCurrent ? '<span class="room-tag" style="background:#e3f2fd;color:#1565c0">当前</span>' : ""} ${activeLabel}</td>
      <td>${escapeHtml(u.display_name || "-")}</td>
      <td>${roleLabel}${advancedTag}</td>
      <td>${escapeHtml(u.created_at) || "-"}</td>
      <td>
        <button class="btn btn-sm btn-default" onclick="openUserModal(${u.id})">编辑</button>
        ${
          u.is_active === 0
            ? `<button class="btn btn-sm btn-primary" onclick="reactivateUser(${u.id})">启用</button>`
            : `<button class="btn btn-sm btn-default" onclick="resetUserPassword(${u.id})">重置密码</button>
             ${!isCurrent ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">停用</button>` : ""}`
        }
      </td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

async function openUserModal(id) {
  if (!requireAdmin()) return;
  const isEdit = !!id;
  if (isEdit) {
    lookupAdminUser(id)
      .then(async function (u) {
        if (!u) {
          await uiAlert("用户不存在");
          return;
        }
        mountUserModal(u, true);
      })
      .catch(async function (e) {
        await uiAlert("加载用户失败：" + (e.message || "未知错误"));
      });
    return;
  }
  mountUserModal(null, false);
}

function mountUserModal(u, isEdit) {
  document.getElementById("modal-title").textContent = isEdit
    ? "编辑用户"
    : "新增用户";
  setModalWide(false);
  setModalBody(`
          <form id="user-form" onsubmit="submitUser(event)">
            <input type="hidden" id="user-id" value="${isEdit ? u.id : ""}">
            <div class="form-grid">
              <div class="field"><label>账号 *</label><input type="text" id="user-username" required value="${isEdit ? escapeHtml(u.username) : ""}" ${isEdit ? "disabled" : ""}></div>
              <div class="field"><label>显示名</label><input type="text" id="user-display" value="${isEdit ? escapeHtml(u.display_name || "") : ""}"></div>
              <div class="field"><label>角色 *</label>
                <select id="user-role">
                  ${USER_ROLE_OPTIONS.map((opt) => `<option value="${opt[0]}" ${isEdit && u.role === opt[0] ? "selected" : ""}>${opt[1]}</option>`).join("")}
                </select>
              </div>
              <div class="field" id="user-advanced-wrap" style="${isEdit && u.role === "zhike" ? "" : "display:none"}">
                <label><input type="checkbox" id="user-advanced" ${isEdit && u.is_advanced ? "checked" : ""}> 高级知客（额外开放备份/用户/信息管理等权限）</label>
              </div>
              <div class="field"><label>密码${isEdit ? "（留空则不修改）" : " *"}</label><input type="password" id="user-password" ${isEdit ? "" : "required"}></div>
            </div>
            <div class="btn-bar">
              <button type="submit" class="btn btn-primary">保存</button>
              <button type="button" class="btn" onclick="closeModal()">取消</button>
            </div>
          </form>
  `);
  document.getElementById("modal").classList.add("active");
  bindUserRoleAdvancedToggle();
  updateUserAdvancedFieldVisibility();
}

async function closeUserModal() {
  closeModal();
}

async function submitUser(e) {
  e.preventDefault();
  if (!requireAdmin()) return;

  const id = document.getElementById("user-id").value;
  const username = document.getElementById("user-username").value.trim();
  const displayName =
    document.getElementById("user-display").value.trim() || null;
  const role = document.getElementById("user-role").value;
  const password = document.getElementById("user-password").value;
  const advancedEl = document.getElementById("user-advanced");
  const isAdvanced =
    role === "zhike" && advancedEl && advancedEl.checked ? 1 : 0;

  if (!username) {
    await uiAlert("请输入账号");
    return;
  }
  if (!id && !password) {
    await uiAlert("请输入密码");
    return;
  }

  try {
    if (!id) validateUsername(username);
    if (password) validateNewPassword(password);
  } catch (e) {
    await uiAlert(e.message);
    return;
  }

  if (id) {
    const existing = useRemoteAdminUsers()
      ? findAdminUserById(parseInt(id, 10))
      : query("SELECT id, username, role FROM users WHERE id = ?", [id])[0];
    if (!existing && useRemoteAdminUsers()) {
      try {
        await ensureAdminUsersCache();
      } catch (e) {
        await uiAlert("加载用户失败：" + e.message);
        return;
      }
    }
    const resolved = useRemoteAdminUsers()
      ? findAdminUserById(parseInt(id, 10))
      : existing;
    if (!resolved) return;
    if (
      resolved.role === "admin" &&
      role !== "admin" &&
      countActiveAdmins(id) === 0
    ) {
      await uiAlert("不能移除最后一名管理员");
      return;
    }
  }

  try {
    if (useOnlineDataPath()) {
      if (id) {
        const result = await apiAdminUpdateUser({
          user_id: parseInt(id, 10),
          display_name: displayName,
          role: role,
          is_advanced: isAdvanced,
          password: password || undefined,
        });
        applySessionRefresh(result);
      } else {
        await apiAdminCreateUser({
          username: username,
          display_name: displayName,
          role: role,
          is_advanced: isAdvanced,
          password: password,
        });
      }
    } else if (id) {
      const existing = query(
        "SELECT id, username, role FROM users WHERE id = ?",
        [id],
      )[0];
      if (!existing) return;
      if (password) {
        bumpLocalAuthVersion(id);
        run(
          "UPDATE users SET display_name=?, role=?, is_advanced=?, password=?, must_change_password=0 WHERE id=?",
          [
            displayName,
            role,
            isAdvanced,
            await hashPasswordAsync(password),
            id,
          ],
        );
      } else {
        run(
          "UPDATE users SET display_name=?, role=?, is_advanced=? WHERE id=?",
          [displayName, role, isAdvanced, id],
        );
      }
      logAudit("更新用户", "user", id, { username: existing.username, role });
      if (currentUser && currentUser.id == id) {
        currentUser.display_name = displayName;
        currentUser.role = role;
        currentUser.is_advanced = isAdvanced;
        setSessionPermissions(getSessionPermissionsForRole(role, currentUser));
        if (password)
          currentUser.auth_version =
            query("SELECT auth_version FROM users WHERE id = ?", [id])[0]
              ?.auth_version || currentUser.auth_version;
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
        updateAuthUI();
        applyPermissions();
      }
    } else {
      const result = run(
        "INSERT INTO users (username, display_name, role, is_advanced, password, auth_version, must_change_password) VALUES (?, ?, ?, ?, ?, 1, 0)",
        [
          username,
          displayName,
          role,
          isAdvanced,
          await hashPasswordAsync(password),
        ],
      );
      logAudit("新增用户", "user", result.lastInsertId, { username, role });
    }
  } catch (err) {
    await uiAlert("保存失败：" + err.message);
    return;
  }

  if (useLocalDbPath()) {
    await saveDB();
  }
  closeUserModal();
  showToast("用户保存成功");
  renderUserList();
}

async function deleteUser(id) {
  if (!requireAdmin()) return;
  let u;
  try {
    u = await lookupAdminUser(id);
  } catch (e) {
    await uiAlert("加载用户失败：" + e.message);
    return;
  }
  if (!u) return;
  if (currentUser && currentUser.id === id) {
    await uiAlert("不能停用当前登录账号");
    return;
  }
  if (u.role === "admin" && countActiveAdmins(id) === 0) {
    await uiAlert("不能停用最后一名管理员");
    return;
  }
  if (!(await uiConfirm(`确定停用用户「${u.username}」吗？`))) return;
  try {
    if (useOnlineDataPath()) {
      await apiAdminDeactivateUser(id);
    } else {
      run(
        "UPDATE users SET is_active = 0, auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?",
        [id],
      );
      logAudit("停用用户", "user", id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    await uiAlert("停用失败：" + e.message);
    return;
  }
  showToast("用户已停用");
  renderUserList();
}

async function reactivateUser(id) {
  if (!requireAdmin()) return;
  if (!(await uiConfirm("确定重新启用该用户吗？"))) return;
  try {
    if (useOnlineDataPath()) {
      await apiAdminReactivateUser(id);
    } else {
      const u = query("SELECT username FROM users WHERE id = ?", [id])[0];
      if (!u) return;
      run("UPDATE users SET is_active = 1 WHERE id = ?", [id]);
      logAudit("启用用户", "user", id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    await uiAlert("启用失败：" + e.message);
    return;
  }
  showToast("用户已启用");
  renderUserList();
}

async function resetUserPassword(id) {
  if (!requireAdmin()) return;
  let username = "";
  try {
    const u = await lookupAdminUser(id);
    username = u?.username || "";
    if (!u) return;
  } catch (e) {
    await uiAlert("加载用户失败：" + e.message);
    return;
  }
  const temp = await uiPrompt(
    `为「${username || id}」设置临时密码（至少 6 位）：`,
  );
  if (temp == null) return;
  try {
    validateNewPassword(temp);
  } catch (e) {
    await uiAlert(e.message);
    return;
  }
  if (
    !(await uiConfirm(`确定重置「${username}」的密码吗？其他设备会话将失效。`))
  )
    return;
  try {
    if (useOnlineDataPath()) {
      await apiAdminResetUserPassword(id, temp);
    } else {
      const u = query("SELECT * FROM users WHERE id = ?", [id])[0];
      if (!u) return;
      bumpLocalAuthVersion(id);
      run(
        "UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?",
        [await hashPasswordAsync(temp), id],
      );
      logAudit("重置用户密码", "user", id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    await uiAlert("重置失败：" + e.message);
    return;
  }
  showToast("密码已重置，请告知用户临时密码");
  renderUserList();
}

function isPasswordChangeBlocking() {
  return passwordChangeBlocking;
}

function userMustChangePassword() {
  return !!(currentUser && currentUser.must_change_password);
}

function schedulePasswordChangePromptIfNeeded() {
  if (!userMustChangePassword()) return;
  if (typeof scheduleIdleTask === "function") {
    scheduleIdleTask(function () {
      openChangePasswordModal(true);
    });
  } else {
    setTimeout(function () {
      openChangePasswordModal(true);
    }, 0);
  }
}

function clearChangePasswordForm() {
  [
    "change-password-old",
    "change-password-new",
    "change-password-confirm",
  ].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const hint = document.getElementById("change-password-form-hint");
  if (hint) hint.textContent = "";
}

function finishPasswordChangeSuccess(message) {
  passwordChangeBlocking = false;
  if (currentUser) {
    currentUser.must_change_password = 0;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
  }
  clearChangePasswordForm();
  closeModal();
  closeProfileMenu();
  if (typeof showToast === "function") showToast(message || "密码已更新");
}

async function changeOwnPassword(oldPassword, newPassword) {
  validateNewPassword(newPassword, oldPassword);
  if (useOnlineDataPath()) {
    const result = await apiChangePassword(oldPassword, newPassword);
    applySessionRefresh(result);
    logAudit("修改密码", "user", currentUser.id, {
      username: currentUser.username,
    });
    return result;
  }
  const u = query("SELECT * FROM users WHERE id = ? LIMIT 1", [
    currentUser.id,
  ])[0];
  if (!u || !(await verifyPasswordAsync(oldPassword, u.password))) {
    throw new Error("原密码错误");
  }
  bumpLocalAuthVersion(currentUser.id);
  run("UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?", [
    await hashPasswordAsync(newPassword),
    currentUser.id,
  ]);
  currentUser.must_change_password = 0;
  currentUser.auth_version = (Number(currentUser.auth_version) || 1) + 1;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
  logAudit("修改密码", "user", currentUser.id, {
    username: currentUser.username,
  });
  await saveDB();
  return { ok: true };
}

function openChangePasswordModal(forced) {
  if (!currentUser) return;
  const modal = document.getElementById("modal");
  if (forced && modal && modal.classList.contains("active")) return;
  closeProfileMenu();
  passwordChangeBlocking = !!forced;
  document.getElementById("modal-title").textContent = forced
    ? "请修改密码"
    : "修改密码";
  const closeBtn = document.querySelector("#modal .close");
  if (closeBtn) closeBtn.hidden = !!forced;
  setModalWide(false);
  setModalBody(`
    <form id="change-password-modal-form" class="modal-form" onsubmit="submitChangePasswordModal(event)">
      ${
        forced
          ? '<p class="field-hint">首次登录或管理员要求，请先设置新密码后再继续使用。</p>'
          : ""
      }
      <div class="field">
        <label for="change-password-modal-old">原密码</label>
        <input type="password" id="change-password-modal-old" autocomplete="current-password" required>
      </div>
      <div class="field">
        <label for="change-password-modal-new">新密码</label>
        <input type="password" id="change-password-modal-new" autocomplete="new-password" required>
      </div>
      <div class="field">
        <label for="change-password-modal-confirm">确认新密码</label>
        <input type="password" id="change-password-modal-confirm" autocomplete="new-password" required>
      </div>
      <p class="field-hint" id="change-password-modal-hint" aria-live="polite"></p>
      <div class="btn-bar">
        <button type="submit" class="btn btn-primary" id="change-password-modal-submit">保存新密码</button>
        ${
          forced
            ? ""
            : '<button type="button" class="btn btn-default" onclick="closeChangePasswordModal()">取消</button>'
        }
      </div>
    </form>
  `);
  document.getElementById("modal").classList.add("active");
}

function closeChangePasswordModal() {
  if (passwordChangeBlocking) return;
  passwordChangeBlocking = false;
  const closeBtn = document.querySelector("#modal .close");
  if (closeBtn) closeBtn.hidden = false;
  closeModal();
}

async function submitChangePasswordModal(event) {
  event.preventDefault();
  if (!currentUser) return;
  const oldPassword = document.getElementById(
    "change-password-modal-old",
  ).value;
  const newPassword = document.getElementById(
    "change-password-modal-new",
  ).value;
  const confirmPassword = document.getElementById(
    "change-password-modal-confirm",
  ).value;
  const hint = document.getElementById("change-password-modal-hint");
  if (newPassword !== confirmPassword) {
    if (hint) hint.textContent = "两次输入的新密码不一致";
    return;
  }
  setPendingState({
    inputIds: [
      "change-password-modal-old",
      "change-password-modal-new",
      "change-password-modal-confirm",
    ],
    buttonId: "change-password-modal-submit",
    pending: true,
    pendingText: "保存中…",
    idleText: "保存新密码",
  });
  if (hint) hint.textContent = "";
  try {
    await changeOwnPassword(oldPassword, newPassword);
    finishPasswordChangeSuccess("密码已更新");
  } catch (e) {
    if (hint) hint.textContent = e.message || "修改失败";
  } finally {
    setPendingState({
      inputIds: [
        "change-password-modal-old",
        "change-password-modal-new",
        "change-password-modal-confirm",
      ],
      buttonId: "change-password-modal-submit",
      pending: false,
      pendingText: "保存中…",
      idleText: "保存新密码",
    });
  }
}

async function submitChangePasswordForm(event) {
  event.preventDefault();
  if (!currentUser) return;
  const oldPassword = document.getElementById("change-password-old").value;
  const newPassword = document.getElementById("change-password-new").value;
  const confirmPassword = document.getElementById(
    "change-password-confirm",
  ).value;
  const hint = document.getElementById("change-password-form-hint");
  if (newPassword !== confirmPassword) {
    if (hint) hint.textContent = "两次输入的新密码不一致";
    return;
  }
  setPendingState({
    inputIds: [
      "change-password-old",
      "change-password-new",
      "change-password-confirm",
    ],
    buttonId: "change-password-submit-btn",
    pending: true,
    pendingText: "保存中…",
    idleText: "保存新密码",
  });
  if (hint) hint.textContent = "";
  try {
    await changeOwnPassword(oldPassword, newPassword);
    finishPasswordChangeSuccess("密码已更新");
  } catch (e) {
    if (hint) hint.textContent = e.message || "修改失败";
  } finally {
    setPendingState({
      inputIds: [
        "change-password-old",
        "change-password-new",
        "change-password-confirm",
      ],
      buttonId: "change-password-submit-btn",
      pending: false,
      pendingText: "保存中…",
      idleText: "保存新密码",
    });
  }
}

document.addEventListener("click", function (e) {
  if (!e.target.closest(".topbar-profile-wrap")) closeProfileMenu();
});
