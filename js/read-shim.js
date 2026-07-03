/* 在线读 shim：本地 query / 云端 rc* | Read shim for local SQL vs online rc */

function readUseRc() {
  return (
    typeof isLocalForceDb === "function" &&
    !isLocalForceDb() &&
    typeof rcReadReady === "function" &&
    rcReadReady()
  );
}

function readLodger(id) {
  if (readUseRc()) return rcLodgerById(id);
  return query("SELECT * FROM lodgers WHERE id=?", [id])[0] || null;
}

function readLodgerEnriched(id) {
  if (readUseRc()) return rcEnrichLodgerRow(rcLodgerById(id));
  return (
    query(
      "SELECT l.*, e.name as event_name, r.name as room_name, b.bed_number, r.location, r.dorm_type FROM lodgers l LEFT JOIN events e ON e.id=l.event_id LEFT JOIN beds b ON b.id=l.bed_id LEFT JOIN rooms r ON r.id=b.room_id WHERE l.id=?",
      [id],
    )[0] || null
  );
}

function readGuest(id) {
  if (readUseRc()) return rcGuestById(id);
  return query("SELECT * FROM guests WHERE id=?", [id])[0] || null;
}

function readBedJoined(bedId) {
  if (readUseRc()) return rcBedJoined(bedId);
  return (
    query(
      "SELECT b.*, r.name as room_name, r.dorm_type, r.location FROM beds b JOIN rooms r ON r.id=b.room_id WHERE b.id=?",
      [bedId],
    )[0] || null
  );
}

function readReservation(id) {
  if (readUseRc()) return rcReservationById(id);
  return query("SELECT * FROM reservations WHERE id=?", [id])[0] || null;
}

function readPaymentsForLodger(lodgerId) {
  if (readUseRc()) return rcPaymentsForLodger(lodgerId);
  return query("SELECT * FROM payments WHERE lodger_id=?", [lodgerId]);
}

function readMealsForLodger(lodgerId) {
  if (readUseRc()) return rcMealsForLodger(lodgerId);
  return query("SELECT * FROM meals WHERE lodger_id=?", [lodgerId]);
}

function readPaidTotal(lodgerId) {
  if (readUseRc()) return rcPaidTotalForLodger(lodgerId);
  return (
    query("SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE lodger_id=?", [
      lodgerId,
    ])[0]?.total || 0
  );
}

function readUnassignedLodgers() {
  if (readUseRc()) return rcUnassignedLodgers();
  return query(`
    SELECT l.*, e.name as event_name FROM lodgers l
    LEFT JOIN events e ON e.id=l.event_id
    WHERE l.status='在住' AND (l.bed_id IS NULL OR l.bed_id=0)
    ORDER BY l.check_in_date DESC, l.id DESC
  `);
}

function readUnassignedReservations() {
  if (readUseRc()) return rcUnassignedReservations();
  return query(`
    SELECT r.*, e.name as event_name FROM reservations r
    LEFT JOIN events e ON e.id=r.event_id
    WHERE r.status IN ('预约','已确认') AND (r.bed_id IS NULL OR r.bed_id=0)
    ORDER BY r.expected_check_in ASC, r.id ASC
  `);
}

function readRoomById(roomId) {
  if (readUseRc()) return rcRoomById(roomId);
  return query("SELECT * FROM rooms WHERE id=?", [roomId])[0] || null;
}

function readActiveLodgerCount() {
  if (readUseRc()) {
    return rcBoardLodgers().filter(function (l) {
      return l.status === "在住";
    }).length;
  }
  return query("SELECT COUNT(*) as c FROM lodgers WHERE status='在住'")[0]?.c || 0;
}

function readPaymentSummary(lodgerId) {
  if (readUseRc()) return rcPaymentSummary(lodgerId);
  var row =
    query(
      "SELECT COALESCE(SUM(CASE WHEN type IN ('押金','房费') THEN amount ELSE 0 END), 0) as income, COALESCE(SUM(CASE WHEN type = '退款' THEN amount ELSE 0 END), 0) as refund FROM payments WHERE lodger_id = ?",
      [lodgerId],
    )[0] || {};
  return {
    income: row.income || 0,
    refund: row.refund || 0,
    refund_total: row.refund || 0,
    balance: (row.income || 0) - (row.refund || 0),
  };
}

function readLodgerForVoucher(id) {
  var l = readLodgerEnriched(id);
  if (!l) return null;
  if (readUseRc()) {
    var pays = rcPaymentsForLodger(id);
    var deposit = 0;
    var roomFee = 0;
    pays.forEach(function (p) {
      if (p.type === "押金") deposit += parseFloat(p.amount) || 0;
      if (p.type === "房费") roomFee += parseFloat(p.amount) || 0;
    });
    return Object.assign({}, l, { deposit: deposit, room_fee: roomFee });
  }
  return (
    query(
      "SELECT l.*, r.name as room_name, b.bed_number, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '押金') as deposit, (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE lodger_id = l.id AND type = '房费') as room_fee FROM lodgers l LEFT JOIN beds b ON b.id = l.bed_id LEFT JOIN rooms r ON r.id = b.room_id WHERE l.id = ?",
      [id],
    )[0] || null
  );
}
