'use strict';

const { getPool } = require('../db');
const { hashPassword } = require('../utils/password');

/**
 * 数据仓储层：所有 SQL 集中在这里，路由层只调用这些 async 方法。
 * 对外返回 camelCase 字段对象。
 */

/* ----------------------------- 映射 ----------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id, username: r.username, name: r.name, role: r.role,
    status: r.status, createdAt: r.created_at,
  };
}
function mapUserWithHash(r) {
  if (!r) return null;
  return { ...mapUser(r), passwordHash: r.password_hash };
}
function mapLot(r) {
  if (!r) return null;
  return {
    id: r.id, code: r.code, name: r.name, district: r.district, address: r.address,
    totalSpaces: r.total_spaces, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSpace(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, code: r.code, type: r.type, status: r.status,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapVehicle(r) {
  if (!r) return null;
  return {
    id: r.id, plateNo: r.plate_no, ownerName: r.owner_name, phone: r.phone,
    vehicleType: r.vehicle_type, isMember: !!r.is_member, createdAt: r.created_at,
  };
}
function mapSession(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, spaceId: r.space_id, plateNo: r.plate_no,
    enterTime: r.enter_time, exitTime: r.exit_time, feeCents: r.fee_cents,
    status: r.status, paid: !!r.paid, createdAt: r.created_at,
  };
}
function mapRatePlan(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, vehicleType: r.vehicle_type, isHoliday: !!r.is_holiday,
    freeMinutes: r.free_minutes, dailyCapCents: r.daily_cap_cents,
    memberDiscountPct: r.member_discount_pct, firstSegmentFree: !!r.first_segment_free,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapRateSegment(r) {
  if (!r) return null;
  return {
    id: r.id, planId: r.plan_id, startTime: r.start_time, endTime: r.end_time,
    unitPriceCents: r.unit_price_cents, granularityMinutes: r.granularity_minutes,
    minDurationMinutes: r.min_duration_minutes, sortOrder: r.sort_order,
  };
}
function mapLotBinding(r) {
  if (!r) return null;
  return {
    id: r.id, lotId: r.lot_id, planId: r.plan_id, createdAt: r.created_at,
  };
}
function mapHoliday(r) {
  if (!r) return null;
  return {
    id: r.id, holidayDate: r.holiday_date, name: r.name, createdAt: r.created_at,
  };
}
function mapBillingSnapshot(r) {
  if (!r) return null;
  return {
    id: r.id, sessionId: r.session_id, planId: r.plan_id,
    snapshotJson: typeof r.snapshot_json === 'string' ? JSON.parse(r.snapshot_json) : r.snapshot_json,
    calculatedCents: r.calculated_cents,
    detailJson: typeof r.detail_json === 'string' ? JSON.parse(r.detail_json) : r.detail_json,
    createdAt: r.created_at,
  };
}

/* ----------------------------- 用户 ----------------------------- */

async function getUserByUsername(username) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE username = ?', [username]);
  return mapUserWithHash(rows[0]);
}
async function getUserById(id) {
  const [rows] = await getPool().query('SELECT * FROM users WHERE id = ?', [id]);
  return mapUser(rows[0]);
}
async function listUsers() {
  const [rows] = await getPool().query('SELECT * FROM users ORDER BY id');
  return rows.map(mapUser);
}
async function createUser({ username, password, name, role = 'VIEWER', status = 'ACTIVE' }) {
  const [r] = await getPool().query(
    'INSERT INTO users (username, password_hash, name, role, status) VALUES (?, ?, ?, ?, ?)',
    [username, hashPassword(password), name, role, status],
  );
  return getUserById(r.insertId);
}
async function updateUser(id, fields) {
  const map = { name: 'name', role: 'role', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (fields[k] !== undefined) { sets.push(`${col} = ?`); params.push(fields[k]); }
  }
  if (fields.password !== undefined) { sets.push('password_hash = ?'); params.push(hashPassword(fields.password)); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getUserById(id);
}
async function deleteUser(id) {
  const [r] = await getPool().query('DELETE FROM users WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function countUsers() {
  const [rows] = await getPool().query('SELECT COUNT(*) AS n FROM users');
  return rows[0].n;
}

/* ----------------------------- 停车场 ----------------------------- */

async function listLots({ district, status, keyword } = {}) {
  const where = []; const params = [];
  if (district) { where.push('district = ?'); params.push(district); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (keyword) { where.push('(code LIKE ? OR name LIKE ? OR address LIKE ?)'); const k = `%${keyword}%`; params.push(k, k, k); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_lots ${clause} ORDER BY id DESC`, params);
  return rows.map(mapLot);
}
async function getLotById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE id = ?', [id]);
  return mapLot(rows[0]);
}
async function getLotByCode(code) {
  const [rows] = await getPool().query('SELECT * FROM parking_lots WHERE code = ?', [code]);
  return mapLot(rows[0]);
}
async function createLot(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_lots (code, name, district, address, total_spaces, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.code, d.name, d.district, d.address || '', d.totalSpaces || 0, d.status || 'OPEN'],
  );
  return getLotById(r.insertId);
}
async function updateLot(id, d) {
  const map = { name: 'name', district: 'district', address: 'address', totalSpaces: 'total_spaces', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_lots SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getLotById(id);
}
async function deleteLot(id) {
  const [r] = await getPool().query('DELETE FROM parking_lots WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车位 ----------------------------- */

async function listSpaces({ lotId, status, type } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (type) { where.push('type = ?'); params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_spaces ${clause} ORDER BY id`, params);
  return rows.map(mapSpace);
}
async function getSpaceById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE id = ?', [id]);
  return mapSpace(rows[0]);
}
async function getSpaceByCode(lotId, code) {
  const [rows] = await getPool().query('SELECT * FROM parking_spaces WHERE lot_id = ? AND code = ?', [lotId, code]);
  return mapSpace(rows[0]);
}
async function createSpace(d) {
  const [r] = await getPool().query(
    'INSERT INTO parking_spaces (lot_id, code, type, status) VALUES (?, ?, ?, ?)',
    [d.lotId, d.code, d.type || 'STANDARD', d.status || 'FREE'],
  );
  return getSpaceById(r.insertId);
}
async function updateSpace(id, d) {
  const map = { type: 'type', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE parking_spaces SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  return getSpaceById(id);
}
async function deleteSpace(id) {
  const [r] = await getPool().query('DELETE FROM parking_spaces WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 车辆 ----------------------------- */

async function listVehicles({ keyword, isMember } = {}) {
  const where = []; const params = [];
  if (keyword) { where.push('(plate_no LIKE ? OR owner_name LIKE ?)'); const k = `%${keyword}%`; params.push(k, k); }
  if (isMember !== undefined) { where.push('is_member = ?'); params.push(isMember ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM vehicles ${clause} ORDER BY id DESC`, params);
  return rows.map(mapVehicle);
}
async function getVehicleById(id) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE id = ?', [id]);
  return mapVehicle(rows[0]);
}
async function getVehicleByPlate(plateNo) {
  const [rows] = await getPool().query('SELECT * FROM vehicles WHERE plate_no = ?', [plateNo]);
  return mapVehicle(rows[0]);
}
async function createVehicle(d) {
  const [r] = await getPool().query(
    'INSERT INTO vehicles (plate_no, owner_name, phone, vehicle_type, is_member) VALUES (?, ?, ?, ?, ?)',
    [d.plateNo, d.ownerName || '', d.phone || '', d.vehicleType || 'SMALL', d.isMember ? 1 : 0],
  );
  return getVehicleById(r.insertId);
}
async function updateVehicle(id, d) {
  const map = { ownerName: 'owner_name', phone: 'phone', vehicleType: 'vehicle_type' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isMember !== undefined) { sets.push('is_member = ?'); params.push(d.isMember ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE vehicles SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getVehicleById(id);
}
async function deleteVehicle(id) {
  const [r] = await getPool().query('DELETE FROM vehicles WHERE id = ?', [id]);
  return r.affectedRows > 0;
}

/* ----------------------------- 停车记录 ----------------------------- */

async function listSessions({ lotId, plateNo, status } = {}) {
  const where = []; const params = [];
  if (lotId !== undefined) { where.push('lot_id = ?'); params.push(lotId); }
  if (plateNo) { where.push('plate_no = ?'); params.push(plateNo); }
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM parking_sessions ${clause} ORDER BY id DESC`, params);
  return rows.map(mapSession);
}
async function getSessionById(id) {
  const [rows] = await getPool().query('SELECT * FROM parking_sessions WHERE id = ?', [id]);
  return mapSession(rows[0]);
}
async function createSession(d) {
  const [r] = await getPool().query(
    `INSERT INTO parking_sessions (lot_id, space_id, plate_no, enter_time, status)
     VALUES (?, ?, ?, ?, ?)`,
    [d.lotId, d.spaceId ?? null, d.plateNo, d.enterTime, d.status || 'PARKED'],
  );
  return getSessionById(r.insertId);
}
async function updateSession(id, d) {
  const map = { spaceId: 'space_id', exitTime: 'exit_time', feeCents: 'fee_cents', status: 'status' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.paid !== undefined) { sets.push('paid = ?'); params.push(d.paid ? 1 : 0); }
  if (sets.length) { params.push(id); await getPool().query(`UPDATE parking_sessions SET ${sets.join(', ')} WHERE id = ?`, params); }
  return getSessionById(id);
}

/* ----------------------------- 费率方案 ----------------------------- */

async function listRatePlans({ vehicleType, isHoliday } = {}) {
  const where = []; const params = [];
  if (vehicleType) { where.push('vehicle_type = ?'); params.push(vehicleType); }
  if (isHoliday !== undefined) { where.push('is_holiday = ?'); params.push(isHoliday ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM rate_plans ${clause} ORDER BY id DESC`, params);
  return rows.map(mapRatePlan);
}
async function getRatePlanById(id) {
  const [rows] = await getPool().query('SELECT * FROM rate_plans WHERE id = ?', [id]);
  return mapRatePlan(rows[0]);
}
async function createRatePlan(d) {
  const [r] = await getPool().query(
    `INSERT INTO rate_plans (name, vehicle_type, is_holiday, free_minutes, daily_cap_cents, member_discount_pct, first_segment_free)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [d.name, d.vehicleType || 'SMALL', d.isHoliday ? 1 : 0, d.freeMinutes || 0,
     d.dailyCapCents || 0, d.memberDiscountPct || 0, d.firstSegmentFree ? 1 : 0],
  );
  const planId = r.insertId;
  if (Array.isArray(d.segments)) {
    for (let i = 0; i < d.segments.length; i += 1) {
      const seg = d.segments[i];
      await getPool().query(
        `INSERT INTO rate_segments (plan_id, start_time, end_time, unit_price_cents, granularity_minutes, min_duration_minutes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [planId, seg.startTime, seg.endTime, seg.unitPriceCents || 0,
         seg.granularityMinutes || 60, seg.minDurationMinutes || 0, i],
      );
    }
  }
  return getRatePlanWithSegments(planId);
}
async function updateRatePlan(id, d) {
  const map = { name: 'name', vehicleType: 'vehicle_type', freeMinutes: 'free_minutes', dailyCapCents: 'daily_cap_cents', memberDiscountPct: 'member_discount_pct' };
  const sets = []; const params = [];
  for (const [k, col] of Object.entries(map)) {
    if (d[k] !== undefined) { sets.push(`${col} = ?`); params.push(d[k]); }
  }
  if (d.isHoliday !== undefined) { sets.push('is_holiday = ?'); params.push(d.isHoliday ? 1 : 0); }
  if (d.firstSegmentFree !== undefined) { sets.push('first_segment_free = ?'); params.push(d.firstSegmentFree ? 1 : 0); }
  if (sets.length) {
    sets.push('updated_at = CURRENT_TIMESTAMP(3)');
    params.push(id);
    await getPool().query(`UPDATE rate_plans SET ${sets.join(', ')} WHERE id = ?`, params);
  }
  if (Array.isArray(d.segments)) {
    await getPool().query('DELETE FROM rate_segments WHERE plan_id = ?', [id]);
    for (let i = 0; i < d.segments.length; i += 1) {
      const seg = d.segments[i];
      await getPool().query(
        `INSERT INTO rate_segments (plan_id, start_time, end_time, unit_price_cents, granularity_minutes, min_duration_minutes, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, seg.startTime, seg.endTime, seg.unitPriceCents || 0,
         seg.granularityMinutes || 60, seg.minDurationMinutes || 0, i],
      );
    }
  }
  return getRatePlanWithSegments(id);
}
async function deleteRatePlan(id) {
  const [r] = await getPool().query('DELETE FROM rate_plans WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function getRatePlanWithSegments(id) {
  const plan = await getRatePlanById(id);
  if (!plan) return null;
  const [rows] = await getPool().query('SELECT * FROM rate_segments WHERE plan_id = ? ORDER BY sort_order, start_time', [id]);
  plan.segments = rows.map(mapRateSegment);
  return plan;
}

/* ----------------------------- 车场-方案绑定 ----------------------------- */

async function listLotBindings(lotId) {
  const [rows] = await getPool().query('SELECT * FROM lot_rate_bindings WHERE lot_id = ? ORDER BY id', [lotId]);
  return rows.map(mapLotBinding);
}
async function createLotBinding(lotId, planId) {
  const [r] = await getPool().query(
    'INSERT INTO lot_rate_bindings (lot_id, plan_id) VALUES (?, ?)',
    [lotId, planId],
  );
  const [rows] = await getPool().query('SELECT * FROM lot_rate_bindings WHERE id = ?', [r.insertId]);
  return mapLotBinding(rows[0]);
}
async function deleteLotBinding(lotId, planId) {
  const [r] = await getPool().query('DELETE FROM lot_rate_bindings WHERE lot_id = ? AND plan_id = ?', [lotId, planId]);
  return r.affectedRows > 0;
}
async function getActivePlan(lotId, vehicleType, isHoliday) {
  const [rows] = await getPool().query(
    `SELECT rp.* FROM rate_plans rp
     INNER JOIN lot_rate_bindings lrb ON lrb.plan_id = rp.id
     WHERE lrb.lot_id = ? AND rp.vehicle_type = ? AND rp.is_holiday = ?
     LIMIT 1`,
    [lotId, vehicleType, isHoliday ? 1 : 0],
  );
  if (!rows.length) return null;
  const plan = mapRatePlan(rows[0]);
  const [segs] = await getPool().query('SELECT * FROM rate_segments WHERE plan_id = ? ORDER BY sort_order, start_time', [plan.id]);
  plan.segments = segs.map(mapRateSegment);
  return plan;
}

/* ----------------------------- 节假日 ----------------------------- */

async function listHolidays({ year } = {}) {
  const where = []; const params = [];
  if (year) { where.push('YEAR(holiday_date) = ?'); params.push(Number(year)); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await getPool().query(`SELECT * FROM holiday_calendar ${clause} ORDER BY holiday_date`, params);
  return rows.map(mapHoliday);
}
async function createHoliday(d) {
  const [r] = await getPool().query(
    'INSERT INTO holiday_calendar (holiday_date, name) VALUES (?, ?)',
    [d.holidayDate, d.name || ''],
  );
  const [rows] = await getPool().query('SELECT * FROM holiday_calendar WHERE id = ?', [r.insertId]);
  return mapHoliday(rows[0]);
}
async function deleteHoliday(id) {
  const [r] = await getPool().query('DELETE FROM holiday_calendar WHERE id = ?', [id]);
  return r.affectedRows > 0;
}
async function getHolidayDatesInRange(startDate, endDate) {
  const [rows] = await getPool().query(
    'SELECT holiday_date FROM holiday_calendar WHERE holiday_date >= ? AND holiday_date <= ? ORDER BY holiday_date',
    [startDate, endDate],
  );
  return rows.map((r) => {
    const d = r.holiday_date;
    if (d instanceof Date) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return String(d).slice(0, 10);
  });
}

/* ----------------------------- 计费快照 ----------------------------- */

async function createBillingSnapshot(d) {
  const [r] = await getPool().query(
    `INSERT INTO billing_snapshots (session_id, plan_id, snapshot_json, calculated_cents, detail_json)
     VALUES (?, ?, ?, ?, ?)`,
    [d.sessionId, d.planId, JSON.stringify(d.snapshotJson), d.calculatedCents, JSON.stringify(d.detailJson)],
  );
  const [rows] = await getPool().query('SELECT * FROM billing_snapshots WHERE id = ?', [r.insertId]);
  return mapBillingSnapshot(rows[0]);
}
async function getBillingSnapshotBySessionId(sessionId) {
  const [rows] = await getPool().query('SELECT * FROM billing_snapshots WHERE session_id = ?', [sessionId]);
  return mapBillingSnapshot(rows[0]);
}

module.exports = {
  mapUser, mapLot, mapSpace, mapVehicle, mapSession,
  mapRatePlan, mapRateSegment, mapLotBinding, mapHoliday, mapBillingSnapshot,
  getUserByUsername, getUserById, listUsers, createUser, updateUser, deleteUser, countUsers,
  listLots, getLotById, getLotByCode, createLot, updateLot, deleteLot,
  listSpaces, getSpaceById, getSpaceByCode, createSpace, updateSpace, deleteSpace,
  listVehicles, getVehicleById, getVehicleByPlate, createVehicle, updateVehicle, deleteVehicle,
  listSessions, getSessionById, createSession, updateSession,
  listRatePlans, getRatePlanById, createRatePlan, updateRatePlan, deleteRatePlan, getRatePlanWithSegments,
  listLotBindings, createLotBinding, deleteLotBinding, getActivePlan,
  listHolidays, createHoliday, deleteHoliday, getHolidayDatesInRange,
  createBillingSnapshot, getBillingSnapshotBySessionId,
};
