/* ============================================================
   用户认证与权限 | Auth & Permissions
   本地多账号切换，共享同一套底层数据
   ============================================================ */

const AUTH_STORAGE_KEY = 'ketang_current_user';

// 当前登录用户缓存
let currentUser = null;
let cachedAdminUsers = [];
let pendingLoginPassword = null;

function applySessionRefresh(result) {
  if (!result) return;
  if (result.token && typeof setRemoteSessionToken === 'function') setRemoteSessionToken(result.token);
  if (result.user) {
    currentUser = result.user;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    updateAuthUI();
    applyPermissions();
  }
}

function handleApiUnauthorized() {
  clearAuthSession();
  if (typeof stopBoardPolling === 'function') stopBoardPolling();
  showLoginOverlay();
}

function useRemoteAdminUsers() {
  return typeof useRemoteWriteApi === 'function' && useRemoteWriteApi();
}

async function ensureAdminUsersCache() {
  if (!useRemoteAdminUsers()) return cachedAdminUsers;
  const data = await apiAdminListUsers();
  cachedAdminUsers = data.users || [];
  return cachedAdminUsers;
}

function findAdminUserById(id) {
  const numericId = parseInt(id, 10);
  return cachedAdminUsers.find(function (u) { return u.id === numericId; }) || null;
}

async function lookupAdminUser(id) {
  if (!useRemoteAdminUsers()) {
    return query('SELECT id, username, display_name, role, is_active FROM users WHERE id = ?', [id])[0] || null;
  }
  let user = findAdminUserById(id);
  if (!user) {
    await ensureAdminUsersCache();
    user = findAdminUserById(id);
  }
  return user;
}

function initAuth() {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      const isRemote = typeof isRemoteDB === 'function' && isRemoteDB();
      if (currentUser && typeof query === 'function' && !isRemote) {
        const row = query('SELECT auth_version, is_active FROM users WHERE id = ? LIMIT 1', [currentUser.id])[0];
        if (!row || row.is_active === 0 || (row.auth_version || 1) !== (currentUser.auth_version || 1)) {
          currentUser = null;
          localStorage.removeItem(AUTH_STORAGE_KEY);
        }
      }
    } catch (e) {
      currentUser = null;
    }
  }
  updateAuthUI();
}

function clearAuthSession() {
  currentUser = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  if (typeof setRemoteSessionToken === 'function') setRemoteSessionToken('');
}

async function restoreRemoteSession() {
  if (typeof isRemoteDB !== 'function' || !isRemoteDB()) return true;
  if (!getRemoteSessionToken() || !currentUser) {
    clearAuthSession();
    return false;
  }
  try {
    const data = await apiSessionMe();
    currentUser = data.user;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    updateAuthUI();
    applyPermissions();
    if (data.must_change_password) showForceChangePasswordModal();
    return true;
  } catch (e) {
    clearAuthSession();
    return false;
  }
}

function getCurrentUser() {
  return currentUser;
}

function isLoggedIn() {
  return !!currentUser;
}

function isAdmin() {
  return currentUser && currentUser.role === 'admin';
}

function isZhike() {
  return currentUser && currentUser.role === 'zhike';
}

async function login(username, password) {
  if (typeof isRemoteDB === 'function' && isRemoteDB()) {
    let result;
    try {
      result = await remoteLoginAsync(username, password);
    } catch (err) {
      console.warn('云端登录失败 | Remote login failed:', err);
      throw err;
    }
    currentUser = result.user;
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
    logAudit('用户登录', 'user', result.user.id, { username: result.user.username, role: result.user.role });
    updateAuthUI();
    applyPermissions();
    if (typeof mountFormMealNeedPickers === 'function') mountFormMealNeedPickers();
    if (typeof mountLodgerRoleSelects === 'function') mountLodgerRoleSelects();
    if (result.must_change_password) showForceChangePasswordModal();
    return true;
  }
  const user = query("SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1", [username])[0];
  if (!user || !(await verifyPasswordAsync(password, user.password))) return false;
  await upgradePasswordHashIfLegacy(user.id, password, user.password);
  const fresh = query('SELECT * FROM users WHERE id = ? LIMIT 1', [user.id])[0] || user;
  const mustChange = mustChangePasswordForUser(fresh);
  currentUser = {
    id: fresh.id,
    username: fresh.username,
    display_name: fresh.display_name,
    role: fresh.role,
    auth_version: fresh.auth_version || 1
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
  logAudit('用户登录', 'user', user.id, { username: user.username, role: user.role });
  updateAuthUI();
  applyPermissions();
  if (typeof mountFormMealNeedPickers === 'function') mountFormMealNeedPickers();
  if (typeof mountLodgerRoleSelects === 'function') mountLodgerRoleSelects();
  if (mustChange) showForceChangePasswordModal();
  return true;
}

function logout() {
  if (currentUser) {
    logAudit('用户登出', 'user', currentUser.id, { username: currentUser.username });
  }
  clearAuthSession();
  if (typeof remoteLogout === 'function') remoteLogout();
  updateAuthUI();
  if (typeof stopBoardPolling === 'function') stopBoardPolling();
  showLoginOverlay();
}

function updateAuthUI() {
  const profileName = document.getElementById('topbar-profile-name');
  const profileAvatar = document.querySelector('.topbar-avatar');
  if (profileName && currentUser) {
    profileName.textContent = currentUser.display_name || currentUser.username;
  }
  if (profileAvatar && currentUser) {
    profileAvatar.textContent = (currentUser.display_name || currentUser.username).charAt(0);
  }
}

function showLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.add('active');
  populateLoginUsers();
}

function hideLoginOverlay() {
  const overlay = document.getElementById('login-overlay');
  if (overlay) overlay.classList.remove('active');
}

function populateLoginUsers() {
  const sel = document.getElementById('login-username');
  if (!sel) return;
  let users = [];
  try {
    users = (typeof isRemoteDB === 'function' && isRemoteDB())
      ? remoteListLoginUsers()
      : query("SELECT * FROM users WHERE is_active IS NULL OR is_active = 1 ORDER BY role, username");
  } catch (e) {
    console.warn('加载账号列表失败 | Failed to load login users:', e);
  }
  let html = '<option value=\"\">请选择账号</option>';
  users.forEach(u => {
    const loginRoleLabel = USER_ROLE_OPTIONS.find(opt => opt[0] === u.role)?.[1] || (u.role === 'admin' ? '管理员' : '知客师');
    html += `<option value="${escapeHtml(u.username)}">${escapeHtml(u.display_name || u.username)} (${loginRoleLabel})</option>`;
  });
  sel.innerHTML = html;
  if (typeof rebuildSelectPicker === 'function') rebuildSelectPicker(sel);
}

async function submitLogin() {
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  if (!username) {
    if (errorEl) errorEl.textContent = '请选择账号';
    return;
  }
  if (!password) {
    if (errorEl) errorEl.textContent = '请输入密码';
    return;
  }
  try {
    if (await login(username, password)) {
      if (errorEl) errorEl.textContent = '';
      pendingLoginPassword = password;
      document.getElementById('login-password').value = '';
      if (!document.getElementById('force-password-modal')) {
        hideLoginOverlay();
        renderAll();
        if (typeof startBoardPolling === 'function') startBoardPolling();
      }
    } else if (errorEl) {
      errorEl.textContent = '账号或密码错误';
    }
  } catch (e) {
    if (errorEl) errorEl.textContent = e.message || '登录失败';
  }
}

function showForceChangePasswordModal() {
  if (document.getElementById('force-password-modal')) return;
  hideLoginOverlay();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-overlay active" id="force-password-modal">
      <div class="modal">
        <div class="modal-header"><h3>请修改密码</h3></div>
        <div class="modal-body">
          <p class="empty-tip">当前账号需要设置新密码后才能继续使用系统。</p>
          <div class="field"><label>新密码</label><input type="password" id="force-new-password" minlength="6"></div>
          <div class="field"><label>确认新密码</label><input type="password" id="force-new-password2" minlength="6"></div>
          <p class="field-error" id="force-password-error"></p>
          <div class="btn-bar">
            <button type="button" class="btn btn-primary" onclick="submitForceChangePassword()">保存新密码</button>
          </div>
        </div>
      </div>
    </div>
  `);
}

async function submitForceChangePassword() {
  const p1 = document.getElementById('force-new-password').value;
  const p2 = document.getElementById('force-new-password2').value;
  const errEl = document.getElementById('force-password-error');
  if (p1.length < 6) { if (errEl) errEl.textContent = '新密码至少 6 位'; return; }
  if (p1 !== p2) { if (errEl) errEl.textContent = '两次输入不一致'; return; }
  try {
    validateNewPassword(p1, pendingLoginPassword || '');
  } catch (e) {
    if (errEl) errEl.textContent = e.message;
    return;
  }
  try {
    if (typeof isRemoteDB === 'function' && isRemoteDB()) {
      const result = await apiChangePassword(pendingLoginPassword || '', p1);
      applySessionRefresh(result);
    } else if (currentUser) {
      bumpLocalAuthVersion(currentUser.id);
      run('UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?', [await hashPasswordAsync(p1), currentUser.id]);
      currentUser.auth_version = query('SELECT auth_version FROM users WHERE id = ?', [currentUser.id])[0]?.auth_version || currentUser.auth_version;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
      await saveDB();
    }
    const el = document.getElementById('force-password-modal');
    if (el) el.remove();
    pendingLoginPassword = null;
    hideLoginOverlay();
    showToast('密码已更新');
    renderAll();
    if (typeof startBoardPolling === 'function') startBoardPolling();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || '修改失败';
  }
}

function applyPermissions() {
  const isAdminUser = isAdmin();

  // 侧边栏菜单权限
  const menuMap = {
    'board': true,
    'lodging': true,
    'stay': true,
    'forecast': true,
    'housekeeping': true,
    'reports': true,
    'history': true,
    'info': isAdminUser,
    'backup': isAdminUser
  };

  Object.keys(menuMap).forEach(view => {
    const btn = document.querySelector('.sidebar-nav-btn[data-view="' + view + '"]');
    const footerBtn = document.querySelector('.sidebar-footer-btn[data-view="' + view + '"]');
    const visible = menuMap[view];
    if (btn) btn.style.display = visible ? '' : 'none';
    if (footerBtn) footerBtn.style.display = visible ? '' : 'none';
  });

  // 如果当前在明确标记为隐藏的页面，跳转回房态看板
  const activeView = document.querySelector('.view.active');
  if (activeView && !isAdminUser) {
    const viewId = activeView.id.replace('view-', '');
    if (menuMap[viewId] === false) showView('board');
  }
}

function requireAdmin() {
  if (!isAdmin()) {
    alert('需要管理员权限');
    return false;
  }
  return true;
}


/* ============================================================
   用户管理 | User Management（仅管理员）
   ============================================================ */

const USER_ROLE_OPTIONS = [
  ['admin', '管理员'],
  ['zhike', '知客师'],
  ['kitchen', '厨房'],
  ['housekeeping', '房务'],
  ['viewer', '只读']
];

function renderUserList() {
  const container = document.getElementById('user-list');
  if (!container) return;
  if (!requireAdmin()) {
    container.innerHTML = '<p class="empty-tip">需要管理员权限。</p>';
    return;
  }
  if (typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()) {
    apiAdminListUsers().then(function (data) {
      paintUserList(container, data.users || []);
    }).catch(function (e) {
      container.innerHTML = '<p class="empty-tip">加载用户失败：' + escapeHtml(e.message) + '</p>';
    });
    return;
  }
  paintUserList(container, query("SELECT * FROM users ORDER BY role, username"));
}

function paintUserList(container, users) {
  cachedAdminUsers = users.slice();
  if (!users.length) {
    container.innerHTML = '<p class="empty-tip">暂无用户。</p>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr><th>账号</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead><tbody>`;
  users.forEach(u => {
    const roleLabel = USER_ROLE_OPTIONS.find(opt => opt[0] === u.role)?.[1] || u.role;
    const isCurrent = currentUser && currentUser.id === u.id;
    const activeLabel = (u.is_active === 0) ? '<span class="room-tag" style="background:#ffebee;color:#c62828">已停用</span>' : '';
    const resetLabel = (u.must_change_password === 1 && u.is_active !== 0) ? '<span class="room-tag" style="background:#fff3e0;color:#e65100">待改密</span>' : '';
    html += `<tr>
      <td>${escapeHtml(u.username)} ${isCurrent ? '<span class="room-tag" style="background:#e3f2fd;color:#1565c0">当前</span>' : ''} ${activeLabel} ${resetLabel}</td>
      <td>${escapeHtml(u.display_name || '-')}</td>
      <td>${roleLabel}</td>
      <td>${escapeHtml(u.created_at) || '-'}</td>
      <td>
        <button class="btn btn-sm btn-default" onclick="openUserModal(${u.id})">编辑</button>
        ${u.is_active === 0
          ? `<button class="btn btn-sm btn-primary" onclick="reactivateUser(${u.id})">启用</button>`
          : `<button class="btn btn-sm btn-default" onclick="resetUserPassword(${u.id})">重置密码</button>
             ${!isCurrent ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">停用</button>` : ''}`}
      </td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function openUserModal(id) {
  if (!requireAdmin()) return;
  const isEdit = !!id;
  if (isEdit) {
    lookupAdminUser(id).then(function (u) {
      if (!u) {
        alert('用户不存在');
        return;
      }
      mountUserModal(u, true);
    }).catch(function (e) {
      alert('加载用户失败：' + (e.message || '未知错误'));
    });
    return;
  }
  mountUserModal(null, false);
}

function mountUserModal(u, isEdit) {
  const html = `
    <div class="modal-overlay" id="user-modal" onclick="if(event.target===this)closeUserModal()">
      <div class="modal">
        <div class="modal-header">
          <h3>${isEdit ? '编辑用户' : '新增用户'}</h3>
          <button type="button" class="modal-close" onclick="closeUserModal()">×</button>
        </div>
        <div class="modal-body">
          <form id="user-form" onsubmit="submitUser(event)">
            <input type="hidden" id="user-id" value="${isEdit ? u.id : ''}">
            <div class="form-grid">
              <div class="field"><label>账号 *</label><input type="text" id="user-username" required value="${isEdit ? escapeHtml(u.username) : ''}" ${isEdit ? 'disabled' : ''}></div>
              <div class="field"><label>显示名</label><input type="text" id="user-display" value="${isEdit ? escapeHtml(u.display_name || '') : ''}"></div>
              <div class="field"><label>角色 *</label>
                <select id="user-role">
                  ${USER_ROLE_OPTIONS.map(opt => `<option value="${opt[0]}" ${isEdit && u.role === opt[0] ? 'selected' : ''}>${opt[1]}</option>`).join('')}
                </select>
              </div>
              <div class="field"><label>密码${isEdit ? '（留空则不修改）' : ' *'}</label><input type="password" id="user-password" ${isEdit ? '' : 'required'}></div>
            </div>
            <div class="btn-bar">
              <button type="submit" class="btn btn-primary">保存</button>
              <button type="button" class="btn" onclick="closeUserModal()">取消</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  if (typeof upgradeSelects === 'function') {
    const modalEl = document.getElementById('user-modal');
    if (modalEl) upgradeSelects(modalEl);
  }
}

function closeUserModal() {
  const el = document.getElementById('user-modal');
  if (el) el.remove();
}

async function submitUser(e) {
  e.preventDefault();
  if (!requireAdmin()) return;

  const id = document.getElementById('user-id').value;
  const username = document.getElementById('user-username').value.trim();
  const displayName = document.getElementById('user-display').value.trim() || null;
  const role = document.getElementById('user-role').value;
  const password = document.getElementById('user-password').value;

  if (!username) { alert('请输入账号'); return; }
  if (!id && !password) { alert('请输入密码'); return; }

  try {
    if (!id) validateUsername(username);
    if (password) validateNewPassword(password);
  } catch (e) {
    alert(e.message);
    return;
  }

  if (id) {
    const existing = useRemoteAdminUsers()
      ? findAdminUserById(parseInt(id, 10))
      : query('SELECT id, username, role FROM users WHERE id = ?', [id])[0];
    if (!existing && useRemoteAdminUsers()) {
      try {
        await ensureAdminUsersCache();
      } catch (e) {
        alert('加载用户失败：' + e.message);
        return;
      }
    }
    const resolved = useRemoteAdminUsers() ? findAdminUserById(parseInt(id, 10)) : existing;
    if (!resolved) return;
    if (resolved.role === 'admin' && role !== 'admin' && countActiveAdmins(id) === 0) {
      alert('不能移除最后一名管理员');
      return;
    }
  }

  try {
    if (typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()) {
      if (id) {
        const result = await apiAdminUpdateUser({
          user_id: parseInt(id, 10),
          display_name: displayName,
          role: role,
          password: password || undefined
        });
        applySessionRefresh(result);
      } else {
        await apiAdminCreateUser({
          username: username,
          display_name: displayName,
          role: role,
          password: password
        });
      }
    } else if (id) {
      const existing = query('SELECT id, username, role FROM users WHERE id = ?', [id])[0];
      if (!existing) return;
      if (password) {
        bumpLocalAuthVersion(id);
        run("UPDATE users SET display_name=?, role=?, password=?, must_change_password=0 WHERE id=?", [displayName, role, await hashPasswordAsync(password), id]);
      } else {
        run("UPDATE users SET display_name=?, role=? WHERE id=?", [displayName, role, id]);
      }
      logAudit('更新用户', 'user', id, { username: existing.username, role });
      if (currentUser && currentUser.id == id) {
        currentUser.display_name = displayName;
        currentUser.role = role;
        if (password) currentUser.auth_version = query('SELECT auth_version FROM users WHERE id = ?', [id])[0]?.auth_version || currentUser.auth_version;
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
        updateAuthUI();
        applyPermissions();
      }
    } else {
      const result = run("INSERT INTO users (username, display_name, role, password, auth_version, must_change_password) VALUES (?, ?, ?, ?, 1, 0)", [username, displayName, role, await hashPasswordAsync(password)]);
      logAudit('新增用户', 'user', result.lastInsertId, { username, role });
    }
  } catch (err) {
    alert('保存失败：' + err.message);
    return;
  }

  if (!(typeof useRemoteWriteApi === 'function' && useRemoteWriteApi())) {
    await saveDB();
  }
  closeUserModal();
  showToast('用户保存成功');
  renderUserList();
}

async function deleteUser(id) {
  if (!requireAdmin()) return;
  let u;
  try {
    u = await lookupAdminUser(id);
  } catch (e) {
    alert('加载用户失败：' + e.message);
    return;
  }
  if (!u) return;
  if (currentUser && currentUser.id === id) {
    alert('不能停用当前登录账号');
    return;
  }
  if (u.role === 'admin' && countActiveAdmins(id) === 0) {
    alert('不能停用最后一名管理员');
    return;
  }
  if (!confirm(`确定停用用户「${u.username}」吗？`)) return;
  try {
    if (typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()) {
      await apiAdminDeactivateUser(id);
    } else {
      run("UPDATE users SET is_active = 0, auth_version = COALESCE(auth_version, 1) + 1 WHERE id = ?", [id]);
      logAudit('停用用户', 'user', id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    alert('停用失败：' + e.message);
    return;
  }
  showToast('用户已停用');
  renderUserList();
}

async function reactivateUser(id) {
  if (!requireAdmin()) return;
  if (!confirm('确定重新启用该用户吗？')) return;
  try {
    if (typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()) {
      await apiAdminReactivateUser(id);
    } else {
      const u = query('SELECT username FROM users WHERE id = ?', [id])[0];
      if (!u) return;
      run('UPDATE users SET is_active = 1 WHERE id = ?', [id]);
      logAudit('启用用户', 'user', id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    alert('启用失败：' + e.message);
    return;
  }
  showToast('用户已启用');
  renderUserList();
}

async function resetUserPassword(id) {
  if (!requireAdmin()) return;
  let username = '';
  try {
    const u = await lookupAdminUser(id);
    username = u?.username || '';
    if (!u) return;
  } catch (e) {
    alert('加载用户失败：' + e.message);
    return;
  }
  const temp = prompt(`为「${username || id}」设置临时密码（至少 6 位）：`);
  if (temp == null) return;
  try {
    validateNewPassword(temp);
  } catch (e) {
    alert(e.message);
    return;
  }
  if (!confirm(`确定重置「${username}」的密码吗？该用户下次登录必须修改密码，其他设备会话将失效。`)) return;
  try {
    if (typeof useRemoteWriteApi === 'function' && useRemoteWriteApi()) {
      await apiAdminResetUserPassword(id, temp);
    } else {
      const u = query('SELECT * FROM users WHERE id = ?', [id])[0];
      if (!u) return;
      bumpLocalAuthVersion(id);
      run('UPDATE users SET password = ?, must_change_password = 1 WHERE id = ?', [await hashPasswordAsync(temp), id]);
      logAudit('重置用户密码', 'user', id, { username: u.username });
      await saveDB();
    }
  } catch (e) {
    alert('重置失败：' + e.message);
    return;
  }
  showToast('密码已重置，请告知用户临时密码');
  renderUserList();
}
