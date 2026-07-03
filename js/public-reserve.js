/* Phase 4 公开预约页 | Public reservation form (no login) */

(function () {
  var form = document.getElementById("reserve-form");
  var resultEl = document.getElementById("reserve-result");
  if (!form) return;

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var btn = document.getElementById("rv-submit");
    var name = document.getElementById("rv-name").value.trim();
    var gender = document.getElementById("rv-gender").value;
    var idCard = document.getElementById("rv-idcard").value.trim();
    var phone = document.getElementById("rv-phone").value.trim();
    var checkIn = document.getElementById("rv-in").value;
    var checkOut = document.getElementById("rv-out").value || null;
    var role = document.getElementById("rv-role").value;
    var emergencyName = document.getElementById("rv-emergency-name").value.trim();
    var emergencyPhone = document
      .getElementById("rv-emergency-phone")
      .value.trim();
    var notes = document.getElementById("rv-notes").value.trim();

    if (!name || !gender || !idCard || !checkIn) {
      alert("请填写必填项：姓名、性别、身份证、预计入住");
      return;
    }
    if (typeof validateGuestContact === "function") {
      var contact = validateGuestContact({
        phone: phone,
        idCard: idCard,
        emergencyName: emergencyName,
        emergencyPhone: emergencyPhone,
      });
      if (!contact.ok) {
        alert(contact.msg || "请检查联系方式");
        return;
      }
    }

    btn.disabled = true;
    btn.textContent = "提交中…";
    try {
      var res = await fetch("/api/public/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          gender: gender,
          id_card: idCard,
          phone: phone || null,
          expected_check_in: checkIn,
          expected_check_out: checkOut,
          role: role,
          emergency_name: emergencyName || null,
          emergency_phone: emergencyPhone || null,
          notes: notes || null,
          source: "公开预约",
        }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        throw new Error(body.error || "提交失败（" + res.status + "）");
      }
      form.hidden = true;
      resultEl.hidden = false;
      resultEl.className = "reserve-success";
      resultEl.innerHTML =
        "<p><strong>预约已提交</strong></p><p>客堂知客师将尽快审核，请保持电话畅通。床位需经确认，请勿自行前往入住。</p>";
    } catch (err) {
      alert(err.message || "提交失败");
    } finally {
      btn.disabled = false;
      btn.textContent = "提交预约";
    }
  });
})();
