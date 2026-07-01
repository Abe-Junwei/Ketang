/** Custom select picker — 替代原生下拉，统一宣纸墨韵风格 | Replace native select menus */

function closeAllSelectPickers() {
  if (typeof closeAllMealNeedPickers === "function") closeAllMealNeedPickers();
  document.querySelectorAll(".select-picker.open").forEach(function (wrap) {
    wrap.classList.remove("open");
    const trigger = wrap.querySelector(".select-picker-trigger");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    const list = wrap.querySelector(".select-picker-list");
    if (list) {
      list.classList.remove("select-picker-list-fixed");
      list.style.top = "";
      list.style.left = "";
      list.style.minWidth = "";
      list.style.maxHeight = "";
    }
  });
}

function refreshSelectPicker(sel) {
  if (!sel || !sel.hasAttribute("data-picker-upgraded")) return;
  const wrap = sel.closest(".select-picker");
  if (!wrap) return;
  const trigger = wrap.querySelector(".select-picker-trigger");
  const labelEl =
    trigger && trigger.querySelector(".select-picker-trigger-text");
  const opt = sel.options[sel.selectedIndex];
  if (labelEl) {
    labelEl.textContent = opt ? opt.textContent : "请选择";
  }
  if (trigger) {
    trigger.dataset.value = opt ? opt.value : "";
    trigger.classList.toggle("invalid", sel.classList.contains("invalid"));
    trigger.classList.toggle("select-picker-trigger-placeholder", !sel.value);
  }
  wrap.querySelectorAll(".select-picker-item").forEach(function (item) {
    item.classList.toggle("selected", item.dataset.value === sel.value);
  });
}

function rebuildSelectPicker(sel, html) {
  if (!sel) return;
  if (sel.hasAttribute("data-no-picker")) {
    if (html !== undefined) sel.innerHTML = html;
    return;
  }
  if (html !== undefined) sel.innerHTML = html;
  if (sel.hasAttribute("data-picker-upgraded")) {
    const wrap = sel.closest(".select-picker");
    if (wrap) {
      wrap.parentNode.insertBefore(sel, wrap);
      wrap.remove();
      sel.removeAttribute("data-picker-upgraded");
      sel.classList.remove("picker-native-hidden");
    }
  }
  upgradeSelects(sel.parentNode);
  refreshSelectPicker(sel);
}

function positionSelectPickerList(wrap) {
  const list = wrap.querySelector(".select-picker-list");
  const trigger = wrap.querySelector(".select-picker-trigger");
  if (!list || !trigger) return;
  list.classList.add("select-picker-list-fixed");
  list.style.visibility = "hidden";
  list.style.maxHeight = "";
  const tr = trigger.getBoundingClientRect();
  const pw = list.offsetWidth;
  const ph = list.offsetHeight;
  const gap = 4;
  let top = tr.bottom + gap;
  let left = tr.left;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (left < 8) left = 8;
  const spaceBelow = window.innerHeight - top - 8;
  const spaceAbove = tr.top - gap - 8;
  if (ph > spaceBelow && spaceAbove > spaceBelow) {
    top = Math.max(8, tr.top - Math.min(ph, spaceAbove) - gap);
    list.style.maxHeight = Math.min(240, spaceAbove) + "px";
  } else {
    list.style.maxHeight = Math.min(240, spaceBelow) + "px";
  }
  list.style.top = top + "px";
  list.style.left = left + "px";
  list.style.minWidth = tr.width + "px";
  list.style.visibility = "";
}

function isInsideOpenMenu(el) {
  return (
    el &&
    el.closest &&
    (el.closest(".select-picker-list") ||
      el.closest(".meal-need-picker-panel") ||
      el.closest(".bed-action-popover") ||
      el.closest(".bed-picker-dropdown") ||
      el.closest(".assign-pick-list"))
  );
}

function handleOverlayScrollClose(e) {
  if (isInsideOpenMenu(e.target)) return;
  closeAllSelectPickers();
  if (typeof closeBedActionMenus === "function") closeBedActionMenus();
}

function toggleSelectPicker(triggerEl) {
  const wrap = triggerEl.closest(".select-picker");
  if (!wrap) return;
  const wasOpen = wrap.classList.contains("open");
  closeAllSelectPickers();
  if (typeof closeBedActionMenus === "function") closeBedActionMenus();
  if (wasOpen) return;
  wrap.classList.add("open");
  triggerEl.setAttribute("aria-expanded", "true");
  positionSelectPickerList(wrap);
}

function upgradeSelects(root) {
  root = root || document;
  root
    .querySelectorAll(
      "select:not([data-picker-upgraded]):not([data-no-picker])",
    )
    .forEach(function (sel) {
      if (sel.multiple || sel.size > 1) return;
      sel.setAttribute("data-picker-upgraded", "1");
      sel.classList.add("picker-native-hidden");

      const wrap = document.createElement("div");
      wrap.className = "select-picker";

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "select-picker-trigger";
      trigger.setAttribute("aria-haspopup", "listbox");
      trigger.setAttribute("aria-expanded", "false");
      trigger.innerHTML =
        '<span class="select-picker-trigger-text"></span>' +
        icon("chevron", "icon-xs select-picker-chevron");

      const list = document.createElement("div");
      list.className = "select-picker-list ui-menu";
      list.setAttribute("role", "listbox");

      Array.from(sel.options).forEach(function (opt) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "select-picker-item ui-menu-item";
        item.setAttribute("role", "option");
        item.dataset.value = opt.value;
        item.textContent = opt.textContent;
        if (opt.disabled) {
          item.disabled = true;
          item.classList.add("ui-menu-item-disabled");
        }
        if (opt.selected) item.classList.add("selected");
        item.addEventListener("click", function (e) {
          e.stopPropagation();
          if (opt.disabled) return;
          sel.value = opt.value;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
          refreshSelectPicker(sel);
          wrap.classList.remove("open");
          trigger.setAttribute("aria-expanded", "false");
          list.classList.remove("select-picker-list-fixed");
          list.style.top = "";
          list.style.left = "";
          list.style.minWidth = "";
          list.style.maxHeight = "";
        });
        list.appendChild(item);
      });

      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleSelectPicker(trigger);
      });

      wrap.appendChild(trigger);
      wrap.appendChild(list);
      sel.parentNode.insertBefore(wrap, sel);
      wrap.appendChild(sel);
      refreshSelectPicker(sel);
    });
}

document.addEventListener("click", function (e) {
  if (
    !e.target.closest(".select-picker") &&
    !e.target.closest(".meal-need-picker")
  ) {
    closeAllSelectPickers();
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    if (typeof dismissConfirm === "function") dismissConfirm(false);
    closeAllSelectPickers();
    if (typeof closeBedActionMenus === "function") closeBedActionMenus();
  }
});
window.addEventListener("scroll", handleOverlayScrollClose, true);
window.addEventListener("wheel", handleOverlayScrollClose, true);
