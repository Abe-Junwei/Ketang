/* ============================================================
   用户认证与权限 | Auth & Permissions
   本地多账号切换，共享同一套底层数据
   ============================================================ */

const AUTH_STORAGE_KEY = 'ketang_current_user';

// 当前登录用户缓存
let currentUser = null;

function initAuth() {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
    } catch (e) {
      currentUser = null;
    }
  }
  updateAuthUI();
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

function login(username, password) {
  const user = query("SELECT * FROM users WHERE username = ? AND (is_active IS NULL OR is_active = 1) LIMIT 1", [username])[0];
  if (!user || !verifyPassword(password, user.password)) return false;
  // 如果密码仍是明文，登录成功后自动升级为哈希
  if (!String(user.password).startsWith('sha256$')) {
    run("UPDATE users SET password = ? WHERE id = ?", [hashPassword(password), user.id]);
  }
  currentUser = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role
  };
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
  logAudit('用户登录', 'user', user.id, { username: user.username, role: user.role });
  updateAuthUI();
  applyPermissions();
  if (typeof mountFormMealNeedPickers === 'function') mountFormMealNeedPickers();
  if (typeof mountLodgerRoleSelects === 'function') mountLodgerRoleSelects();
  return true;
}

function logout() {
  if (currentUser) {
    logAudit('用户登出', 'user', currentUser.id, { username: currentUser.username });
  }
  currentUser = null;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  updateAuthUI();
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
  const users = query("SELECT * FROM users WHERE is_active IS NULL OR is_active = 1 ORDER BY role, username");
  let html = '<option value=\"\">请选择账号</option>';
  users.forEach(u => {
    html += `<option value="${escapeHtml(u.username)}">${escapeHtml(u.display_name || u.username)} (${u.role === 'admin' ? '管理员' : '知客师'})</option>`;
  });
  sel.innerHTML = html;
  if (typeof rebuildSelectPicker === 'function') rebuildSelectPicker(sel);
}

function submitLogin() {
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
  if (login(username, password)) {
    if (errorEl) errorEl.textContent = '';
    document.getElementById('login-password').value = '';
    hideLoginOverlay();
    renderAll();
  } else {
    if (errorEl) errorEl.textContent = '账号或密码错误';
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

const USER_ROLE_OPTIONS = [['zhike', '知客师'], ['admin', '管理员']];

function renderUserList() {
  const container = document.getElementById('user-list');
  if (!container) return;
  if (!requireAdmin()) {
    container.innerHTML = '<p class="empty-tip">需要管理员权限。</p>';
    return;
  }

  const users = query("SELECT * FROM users ORDER BY role, username");
  if (!users.length) {
    container.innerHTML = '<p class="empty-tip">暂无用户。</p>';
    return;
  }

  let html = `<div class="table-wrap"><table>
    <thead><tr><th>账号</th><th>显示名</th><th>角色</th><th>创建时间</th><th>操作</th></tr></thead><tbody>`;
  users.forEach(u => {
    const roleLabel = u.role === 'admin' ? '管理员' : '知客师';
    const isCurrent = currentUser && currentUser.id === u.id;
    const activeLabel = (u.is_active === 0) ? '<span class="room-tag" style="background:#ffebee;color:#c62828">已停用</span>' : '';
    html += `<tr>
      <td>${escapeHtml(u.username)} ${isCurrent ? '<span class="room-tag" style="background:#e3f2fd;color:#1565c0">当前</span>' : ''} ${activeLabel}</td>
      <td>${escapeHtml(u.display_name || '-')}</td>
      <td>${roleLabel}</td>
      <td>${escapeHtml(u.created_at) || '-'}</td>
      <td>
        <button class="btn btn-sm btn-default" onclick="openUserModal(${u.id})">编辑</button>
        ${!isCurrent ? `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">停用</button>` : ''}
      </td>
    </tr>`;
  });
  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function openUserModal(id) {
  if (!requireAdmin()) return;
  const isEdit = !!id;
  const u = isEdit ? query("SELECT * FROM users WHERE id = ?", [id])[0] : null;

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

  if (id) {
    // 编辑
    const existing = query("SELECT * FROM users WHERE id = ?", [id])[0];
    if (!existing) return;
    if (password) {
      run("UPDATE users SET display_name=?, role=?, password=? WHERE id=?", [displayName, role, hashPassword(password), id]);
    } else {
      run("UPDATE users SET display_name=?, role=? WHERE id=?", [displayName, role, id]);
    }
    logAudit('更新用户', 'user', id, { username: existing.username, role });
    // 如果编辑的是当前用户，更新缓存
    if (currentUser && currentUser.id == id) {
      currentUser.display_name = displayName;
      currentUser.role = role;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
      updateAuthUI();
      applyPermissions();
    }
  } else {
    // 新增
    try {
      run("INSERT INTO users (username, display_name, role, password) VALUES (?, ?, ?, ?)", [username, displayName, role, hashPassword(password)]);
      const newId = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
      logAudit('新增用户', 'user', newId, { username, role });
    } catch (err) {
      alert('账号已存在或保存失败：' + err.message);
      return;
    }
  }

  await saveDB();
  closeUserModal();
  showToast('用户保存成功');
  renderUserList();
}

async function deleteUser(id) {
  if (!requireAdmin()) return;
  const u = query("SELECT * FROM users WHERE id = ?", [id])[0];
  if (!u) return;
  if (currentUser && currentUser.id === id) {
    alert('不能删除当前登录账号');
    return;
  }
  if (!confirm(`确定停用用户「${u.username}」吗？`)) return;
  run("UPDATE users SET is_active = 0 WHERE id = ?", [id]);
  logAudit('停用用户', 'user', id, { username: u.username });
  await saveDB();
  showToast('用户已删除');
  renderUserList();
}
