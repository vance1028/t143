'use strict';

const express = require('express');
const store = require('../data/store');
const { calculateFee, buildSnapshot, dateToYmd } = require('../billing/engine');
const { authRequired, requireRole } = require('../auth');
const { sendData, sendError, parseId } = require('../utils/http');

const router = express.Router();
router.use(authRequired);

function planToEngineFormat(plan) {
  return {
    freeMinutes: plan.freeMinutes,
    dailyCapCents: plan.dailyCapCents,
    memberDiscountPct: plan.memberDiscountPct,
    firstSegmentFree: plan.firstSegmentFree,
    segments: (plan.segments || []).map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      unitPriceCents: s.unitPriceCents,
      granularityMinutes: s.granularityMinutes,
      minDurationMinutes: s.minDurationMinutes,
    })),
  };
}

router.get('/plans', async (req, res, next) => {
  try {
    const { vehicleType, isHoliday } = req.query;
    const filter = { vehicleType };
    if (isHoliday !== undefined) filter.isHoliday = isHoliday === 'true' || isHoliday === '1';
    return sendData(res, 200, await store.listRatePlans(filter));
  } catch (e) { return next(e); }
});

router.get('/plans/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const plan = await store.getRatePlanWithSegments(id);
    if (!plan) return sendError(res, 404, '费率方案不存在');
    return sendData(res, 200, plan);
  } catch (e) { return next(e); }
});

router.post('/plans', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { name, vehicleType, isHoliday, freeMinutes, dailyCapCents, memberDiscountPct, firstSegmentFree, segments } = req.body || {};
    if (!name) return sendError(res, 400, '方案名称不能为空');
    if (!Array.isArray(segments) || segments.length === 0) return sendError(res, 400, '至少需要一个时段');
    const plan = await store.createRatePlan({
      name, vehicleType, isHoliday, freeMinutes, dailyCapCents, memberDiscountPct, firstSegmentFree, segments,
    });
    return sendData(res, 201, plan);
  } catch (e) { return next(e); }
});

router.put('/plans/:id', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.getRatePlanById(id))) return sendError(res, 404, '费率方案不存在');
    const plan = await store.updateRatePlan(id, req.body || {});
    return sendData(res, 200, plan);
  } catch (e) { return next(e); }
});

router.delete('/plans/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.deleteRatePlan(id))) return sendError(res, 404, '费率方案不存在');
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

router.get('/lots/:lotId/bindings', async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    if (!(await store.getLotById(lotId))) return sendError(res, 404, '停车场不存在');
    const bindings = await store.listLotBindings(lotId);
    const result = [];
    for (const b of bindings) {
      const plan = await store.getRatePlanWithSegments(b.planId);
      result.push({ ...b, plan });
    }
    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.post('/lots/:lotId/bindings', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const { planId } = req.body || {};
    if (!planId) return sendError(res, 400, 'planId 不能为空');
    if (!(await store.getLotById(lotId))) return sendError(res, 404, '停车场不存在');
    if (!(await store.getRatePlanById(planId))) return sendError(res, 404, '费率方案不存在');
    const existing = await store.listLotBindings(lotId);
    if (existing.some((b) => b.planId === Number(planId))) return sendError(res, 409, '该方案已绑定到此停车场');
    const binding = await store.createLotBinding(lotId, planId);
    return sendData(res, 201, binding);
  } catch (e) { return next(e); }
});

router.delete('/lots/:lotId/bindings/:planId', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const lotId = parseId(req.params.lotId);
    const planId = parseId(req.params.planId);
    if (!(await store.deleteLotBinding(lotId, planId))) return sendError(res, 404, '绑定关系不存在');
    return sendData(res, 200, { lotId, planId });
  } catch (e) { return next(e); }
});

router.get('/holidays', async (req, res, next) => {
  try {
    const { year } = req.query;
    return sendData(res, 200, await store.listHolidays({ year }));
  } catch (e) { return next(e); }
});

router.post('/holidays', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { holidayDate, name } = req.body || {};
    if (!holidayDate) return sendError(res, 400, '节假日日期不能为空');
    const h = await store.createHoliday({ holidayDate, name });
    return sendData(res, 201, h);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return sendError(res, 409, '该日期已存在');
    return next(e);
  }
});

router.delete('/holidays/:id', requireRole('ADMIN'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    if (!(await store.deleteHoliday(id))) return sendError(res, 404, '节假日不存在');
    return sendData(res, 200, { id });
  } catch (e) { return next(e); }
});

router.post('/simulate', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { enterTime, exitTime, vehicleType, isMember, planId, lotId } = req.body || {};
    if (!enterTime || !exitTime) return sendError(res, 400, '入场时间和出场时间不能为空');
    if (!planId) return sendError(res, 400, 'planId 不能为空');

    const plan = await store.getRatePlanWithSegments(planId);
    if (!plan) return sendError(res, 404, '费率方案不存在');

    const enterDate = String(enterTime).slice(0, 10);
    const exitDate = String(exitTime).slice(0, 10);
    const holidayDates = await store.getHolidayDatesInRange(enterDate, exitDate);
    const holidaySet = new Set(holidayDates);

    const vType = vehicleType || plan.vehicleType;
    let weekdayPlan = planToEngineFormat(plan);
    let holidayPlan = null;

    if (plan.isHoliday) {
      holidayPlan = weekdayPlan;
      if (lotId) {
        const wdPlan = await store.getActivePlan(Number(lotId), vType, false);
        if (wdPlan) weekdayPlan = planToEngineFormat(wdPlan);
      }
    } else {
      if (lotId) {
        const hPlan = await store.getActivePlan(Number(lotId), vType, true);
        if (hPlan) holidayPlan = planToEngineFormat(hPlan);
      }
    }

    const result = calculateFee({
      enterTime,
      exitTime,
      weekdayPlan,
      holidayPlan,
      holidays: holidaySet,
      isMember: !!isMember,
    });

    return sendData(res, 200, result);
  } catch (e) { return next(e); }
});

router.get('/snapshots/:sessionId', async (req, res, next) => {
  try {
    const sessionId = parseId(req.params.sessionId);
    const snapshot = await store.getBillingSnapshotBySessionId(sessionId);
    if (!snapshot) return sendError(res, 404, '计费快照不存在');
    return sendData(res, 200, snapshot);
  } catch (e) { return next(e); }
});

module.exports = router;
