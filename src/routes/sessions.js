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

router.get('/', async (req, res, next) => {
  try {
    const { lotId, plateNo, status } = req.query;
    const filter = { plateNo, status };
    if (lotId !== undefined) filter.lotId = Number(lotId);
    return sendData(res, 200, await store.listSessions(filter));
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    return sendData(res, 200, s);
  } catch (e) { return next(e); }
});

router.post('/enter', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const { lotId, plateNo, spaceId } = req.body || {};
    if (lotId === undefined || !plateNo) return sendError(res, 400, '停车场和车牌号不能为空');
    if (!(await store.getLotById(Number(lotId)))) return sendError(res, 400, '停车场不存在');
    const enterTime = req.body.enterTime || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const s = await store.createSession({ lotId: Number(lotId), plateNo, spaceId: spaceId ?? null, enterTime });
    return sendData(res, 201, s);
  } catch (e) { return next(e); }
});

router.post('/:id/exit', requireRole('ADMIN', 'OPERATOR'), async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const s = await store.getSessionById(id);
    if (!s) return sendError(res, 404, '停车记录不存在');
    if (s.status !== 'PARKED') return sendError(res, 409, '该记录已结束，不能重复出场');

    const exitTime = req.body.exitTime || new Date().toISOString().slice(0, 19).replace('T', ' ');

    const vehicle = await store.getVehicleByPlate(s.plateNo);
    const vehicleType = vehicle ? vehicle.vehicleType : 'SMALL';
    const isMember = vehicle ? vehicle.isMember : false;

    const weekdayPlan = await store.getActivePlan(s.lotId, vehicleType, false);
    const holidayPlan = await store.getActivePlan(s.lotId, vehicleType, true);

    let feeCents = 0;
    let result = null;
    let usedPlan = weekdayPlan;

    if (weekdayPlan) {
      const enterDate = String(s.enterTime).slice(0, 10);
      const exitDate = String(exitTime).slice(0, 10);
      const holidayDates = await store.getHolidayDatesInRange(enterDate, exitDate);
      const holidaySet = new Set(holidayDates);

      result = calculateFee({
        enterTime: s.enterTime,
        exitTime,
        weekdayPlan: planToEngineFormat(weekdayPlan),
        holidayPlan: holidayPlan ? planToEngineFormat(holidayPlan) : null,
        holidays: holidaySet,
        isMember,
      });
      feeCents = result.totalCents;

      const firstDate = dateToYmd(new Date(s.enterTime.replace(' ', 'T')));
      if (holidaySet.has(firstDate) && holidayPlan) {
        usedPlan = holidayPlan;
      }
    }

    const updated = await store.updateSession(id, { exitTime, feeCents, status: 'FINISHED' });

    if (usedPlan) {
      const snapshotPlan = await store.getRatePlanWithSegments(usedPlan.id);
      await store.createBillingSnapshot({
        sessionId: id,
        planId: usedPlan.id,
        snapshotJson: buildSnapshot(snapshotPlan, snapshotPlan.segments),
        calculatedCents: feeCents,
        detailJson: result ? result.breakdown : {},
      });
    }

    return sendData(res, 200, { ...updated, billingBreakdown: result ? result.breakdown : null });
  } catch (e) { return next(e); }
});

module.exports = router;
