/** 移动端 UI：表单分步、看板摘要 | Mobile layout helpers */

function isMobileLayout() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function renderMobileBoardHero() {
  var el = document.getElementById("mobile-board-hero");
  if (!el) return;
  if (!isMobileLayout()) {
    el.innerHTML = "";
    el.hidden = true;
    return;
  }
  if (typeof getBoardBedStats !== "function") return;
  var stats = getBoardBedStats();
  var today = todayStr();
  var flow;
  if (useOnlineDataPath() && typeof rcGetBoardFlowStats === "function") {
    flow = rcGetBoardFlowStats(today);
  } else {
    flow = {
      expArrive:
        query(
          "SELECT COUNT(*) as c FROM (SELECT id FROM reservations WHERE expected_check_in = ? AND status IN ('预约','已确认') UNION ALL SELECT id FROM lodgers WHERE check_in_date = ? AND status = '在住')",
          [today, today],
        )[0]?.c || 0,
      expDepart:
        query(
          "SELECT COUNT(*) as c FROM lodgers WHERE expected_check_out = ? AND status = '在住'",
          [today],
        )[0]?.c || 0,
    };
  }
  var expArrive = flow.expArrive;
  var expDepart = flow.expDepart;
  el.hidden = false;
  el.innerHTML =
    '<div class="mobile-hero-grid">' +
    '<button type="button" class="mobile-hero-card mobile-hero-card-primary" onclick="showView(\'stay\')">' +
    '<span class="mobile-hero-label">今日预到</span>' +
    '<span class="mobile-hero-value">' +
    expArrive +
    "</span>" +
    '<span class="mobile-hero-hint">办理入住</span>' +
    "</button>" +
    '<button type="button" class="mobile-hero-card" onclick="showView(\'lodgers\')">' +
    '<span class="mobile-hero-label">今日预离</span>' +
    '<span class="mobile-hero-value">' +
    expDepart +
    "</span>" +
    '<span class="mobile-hero-hint">在住列表</span>' +
    "</button>" +
    '<button type="button" class="mobile-hero-card" onclick="showView(\'lodging\')">' +
    '<span class="mobile-hero-label">空床</span>' +
    '<span class="mobile-hero-value">' +
    stats.empty +
    "</span>" +
    '<span class="mobile-hero-hint">房态分布</span>' +
    "</button>" +
    '<button type="button" class="mobile-hero-card mobile-hero-card-warn" onclick="showView(\'housekeeping\')">' +
    '<span class="mobile-hero-label">脏房</span>' +
    '<span class="mobile-hero-value">' +
    stats.dirty +
    "</span>" +
    '<span class="mobile-hero-hint">客房维护</span>' +
    "</button>" +
    "</div>";
}

var WIZARD_FORMS = {
  "checkin-form": {
    steps: [
      {
        label: "身份信息",
        fields: [
          "ci-name",
          "ci-gender",
          "ci-phone",
          "ci-idcard",
          "ci-emergency-name",
          "ci-emergency-phone",
        ],
      },
      {
        label: "床位安排",
        fields: [
          "ci-bed",
          "ci-role",
          "ci-in",
          "ci-out",
          "ci-source",
          "ci-event",
          "ci-class",
          "ci-participant-identity",
          "ci-age-group",
          "ci-special-needs",
        ],
      },
      {
        label: "收款用斋",
        fields: ["ci-deposit", "ci-room-fee", "ci-pay-method", "ci-meal-need"],
      },
    ],
  },
  "resv-form": {
    steps: [
      {
        label: "身份信息",
        fields: [
          "resv-name",
          "resv-gender",
          "resv-phone",
          "resv-idcard",
          "resv-emergency-name",
          "resv-emergency-phone",
        ],
      },
      {
        label: "预约详情",
        fields: [
          "resv-in",
          "resv-out",
          "resv-role",
          "resv-room",
          "resv-event",
          "resv-class",
          "resv-source",
          "resv-participant-identity",
          "resv-age-group",
          "resv-special-needs",
          "resv-meal-need",
        ],
      },
    ],
  },
};

function syncStayFormWizard(formId) {
  var form = document.getElementById(formId);
  var cfg = WIZARD_FORMS[formId];
  if (!form || !cfg) return;
  var mobile = isMobileLayout();
  form.classList.toggle("is-wizard-mobile", mobile);
  if (!mobile) {
    form.querySelectorAll(".form-wizard-panel").forEach(function (panel) {
      panel.hidden = false;
      panel.classList.add("is-active");
    });
    return;
  }
  var step = parseInt(form.getAttribute("data-wizard-step") || "1", 10);
  if (step < 1 || step > cfg.steps.length) step = 1;
  form.setAttribute("data-wizard-step", String(step));
  form.querySelectorAll(".form-wizard-panel").forEach(function (panel) {
    var n = parseInt(panel.getAttribute("data-wizard-panel") || "0", 10);
    var active = n === step;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });
  form.querySelectorAll(".form-wizard-step").forEach(function (btn) {
    var n = parseInt(btn.getAttribute("data-wizard-step") || "0", 10);
    btn.classList.toggle("active", n === step);
    btn.setAttribute("aria-selected", n === step ? "true" : "false");
  });
  var prev = form.querySelector("[data-wizard-action='prev']");
  var next = form.querySelector("[data-wizard-action='next']");
  var submit = form.querySelector("[data-wizard-action='submit']");
  if (prev) prev.hidden = step <= 1;
  if (next) next.hidden = step >= cfg.steps.length;
  if (submit) submit.hidden = step < cfg.steps.length;
}

async function validateWizardStep(formId, stepIndex) {
  var cfg = WIZARD_FORMS[formId];
  if (!cfg || !cfg.steps[stepIndex - 1]) return true;
  var fields = cfg.steps[stepIndex - 1].fields.slice();
  if (formId === "checkin-form" && stepIndex === 1) {
    if (!document.getElementById("ci-gender")?.value) {
      await uiAlert("请选择性别");
      return false;
    }
  }
  if (formId === "checkin-form" && stepIndex === 2) {
    if (!document.getElementById("ci-bed")?.value) {
      await uiAlert("请选择床位");
      return false;
    }
    if (!document.getElementById("ci-in")?.value) {
      await uiAlert("请选择入住日期");
      return false;
    }
  }
  if (formId === "resv-form" && stepIndex === 1) {
    if (!document.getElementById("resv-gender")?.value) {
      await uiAlert("请选择性别");
      return false;
    }
  }
  return validateFields(fields);
}

function goWizardStep(formId, delta) {
  var form = document.getElementById(formId);
  var cfg = WIZARD_FORMS[formId];
  if (!form || !cfg || !isMobileLayout()) return;
  var step = parseInt(form.getAttribute("data-wizard-step") || "1", 10);
  if (delta > 0 && !validateWizardStep(formId, step)) return;
  var next = Math.max(1, Math.min(cfg.steps.length, step + delta));
  form.setAttribute("data-wizard-step", String(next));
  syncStayFormWizard(formId);
  var panel = form.querySelector(
    '.form-wizard-panel[data-wizard-panel="' + next + '"]',
  );
  if (panel) {
    panel.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function initStayFormWizards() {
  Object.keys(WIZARD_FORMS).forEach(function (formId) {
    var form = document.getElementById(formId);
    if (!form) return;
    form.setAttribute("data-wizard-step", "1");
    syncStayFormWizard(formId);
  });
  if (!window._stayWizardResizeBound) {
    window._stayWizardResizeBound = true;
    window.addEventListener("resize", function () {
      Object.keys(WIZARD_FORMS).forEach(syncStayFormWizard);
      renderMobileBoardHero();
    });
  }
}

function renderLodgerCardActions(lodgerId) {
  var id = lodgerId;
  function btn(action, label, cls) {
    return (
      '<button type="button" class="btn btn-default btn-sm lodger-card-action' +
      (cls ? " " + cls : "") +
      '" onclick="event.stopPropagation(); ' +
      action +
      "(" +
      id +
      ')">' +
      escapeHtml(label) +
      "</button>"
    );
  }
  return (
    '<div class="lodger-card-actions">' +
    btn("openMealModal", "用斋") +
    btn("openExtendModal", "续住") +
    btn("openChangeBedModal", "换床") +
    btn("openCheckoutModal", "退房", "btn-primary") +
    "</div>"
  );
}
