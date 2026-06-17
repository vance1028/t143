'use strict';

const MINS_PER_DAY = 1440;

function parseDateTime(v) {
  if (v instanceof Date) return v;
  const s = String(v).replace('T', ' ');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`无法解析日期时间: ${v}`);
  return d;
}

function dateToYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseHm(hm) {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function addMinutes(d, mins) {
  return new Date(d.getTime() + mins * 60000);
}

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function diffMinutes(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 60000);
}

function ceilDiv(a, b) {
  if (b <= 0) throw new Error('granularity 必须 > 0');
  return Math.floor((a + b - 1) / b);
}

function selectPlan(weekdayPlan, holidayPlan, holidays, dateStr) {
  if (holidayPlan && holidays.has(dateStr)) return holidayPlan;
  return weekdayPlan;
}

function splitRangeByDay(start, end) {
  const days = [];
  let cur = start;
  while (cur < end) {
    const dayStart = startOfDay(cur);
    const dayEnd = addMinutes(dayStart, MINS_PER_DAY);
    const segEnd = dayEnd < end ? dayEnd : end;
    days.push({ date: dateToYmd(cur), start: cur, end: segEnd });
    cur = dayEnd;
  }
  return days;
}

function calcSegmentFee(minutes, unitPriceCents, granularityMinutes, minDurationMinutes) {
  if (minutes <= 0) return { billedMinutes: 0, units: 0, feeCents: 0 };
  const effective = Math.max(minutes, minDurationMinutes);
  const units = ceilDiv(effective, granularityMinutes);
  const billedMinutes = units * granularityMinutes;
  return { billedMinutes, units, feeCents: units * unitPriceCents };
}

function splitByTimeSegments(dayStart, dayEnd, segments) {
  const dayStartMin = diffMinutes(startOfDay(dayStart), dayStart);
  const dayEndMin = diffMinutes(startOfDay(dayStart), dayEnd);
  const results = [];
  for (const seg of segments) {
    const segStartMin = parseHm(seg.startTime);
    const segEndMin = parseHm(seg.endTime);
    const overlapStart = Math.max(dayStartMin, segStartMin);
    const overlapEnd = Math.min(dayEndMin, segEndMin);
    if (overlapStart < overlapEnd) {
      results.push({
        segment: seg,
        startMin: overlapStart,
        endMin: overlapEnd,
        durationMinutes: overlapEnd - overlapStart,
      });
    }
  }
  return results;
}

function calculateFee({
  enterTime,
  exitTime,
  weekdayPlan,
  holidayPlan,
  holidays,
  isMember,
}) {
  const enter = parseDateTime(enterTime);
  const exit = parseDateTime(exitTime);
  const holidaySet = holidays instanceof Set ? holidays : new Set(holidays);

  if (exit <= enter) {
    return { totalCents: 0, breakdown: { days: [], freeMinutesDeducted: 0, memberDiscountCents: 0, firstSegmentDeductionCents: 0, rawTotal: 0, finalTotal: 0 } };
  }

  const weekday = weekdayPlan;
  const planForFirstDay = selectPlan(weekday, holidayPlan, holidaySet, dateToYmd(enter));
  const freeMinutes = planForFirstDay.freeMinutes || 0;

  const billableStart = addMinutes(enter, freeMinutes);
  const totalDuration = diffMinutes(enter, exit);
  const actualFree = Math.min(freeMinutes, totalDuration);

  if (billableStart >= exit) {
    return {
      totalCents: 0,
      breakdown: {
        days: [],
        freeMinutesDeducted: actualFree,
        memberDiscountCents: 0,
        firstSegmentDeductionCents: 0,
        rawTotal: 0,
        finalTotal: 0,
      },
    };
  }

  const dayRanges = splitRangeByDay(billableStart, exit);
  const dayResults = [];
  let firstSegKey = null;

  for (const dr of dayRanges) {
    const plan = selectPlan(weekday, holidayPlan, holidaySet, dr.date);
    const sortedSegs = [...plan.segments].sort((a, b) => parseHm(a.startTime) - parseHm(b.startTime));
    const segSplits = splitByTimeSegments(dr.start, dr.end, sortedSegs);

    const segResults = [];
    let daySubtotal = 0;

    for (const ss of segSplits) {
      const { billedMinutes, units, feeCents } = calcSegmentFee(
        ss.durationMinutes,
        ss.segment.unitPriceCents,
        ss.segment.granularityMinutes,
        ss.segment.minDurationMinutes,
      );
      const segKey = `${dr.date}|${ss.segment.startTime}-${ss.segment.endTime}`;
      if (firstSegKey === null) firstSegKey = segKey;

      segResults.push({
        startTime: ss.segment.startTime,
        endTime: ss.segment.endTime,
        durationMinutes: ss.durationMinutes,
        billedMinutes,
        units,
        unitPriceCents: ss.segment.unitPriceCents,
        feeCents,
        isFirstSegment: segKey === firstSegKey,
      });
      daySubtotal += feeCents;
    }

    const dailyCap = plan.dailyCapCents || 0;
    const capped = dailyCap > 0 ? Math.min(daySubtotal, dailyCap) : daySubtotal;

    dayResults.push({
      date: dr.date,
      isHoliday: holidaySet.has(dr.date),
      segments: segResults,
      daySubtotal,
      dailyCap,
      dayTotal: capped,
    });
  }

  let rawTotal = 0;
  for (const dr of dayResults) rawTotal += dr.dayTotal;

  let firstSegmentDeductionCents = 0;
  const planForDeduction = selectPlan(weekday, holidayPlan, holidaySet, dateToYmd(billableStart));
  if (planForDeduction.firstSegmentFree) {
    const firstDay = dayResults[0];
    if (firstDay && firstDay.segments.length > 0 && firstDay.segments[0].isFirstSegment) {
      firstSegmentDeductionCents = firstDay.segments[0].feeCents;
      if (firstDay.dailyCap > 0 && firstDay.daySubtotal > firstDay.dailyCap) {
        firstSegmentDeductionCents = 0;
      } else {
        rawTotal -= firstSegmentDeductionCents;
        firstDay.dayTotal = Math.max(0, firstDay.dayTotal - firstSegmentDeductionCents);
      }
    }
  }

  let memberDiscountCents = 0;
  if (isMember && planForDeduction.memberDiscountPct > 0) {
    memberDiscountCents = Math.floor(rawTotal * planForDeduction.memberDiscountPct / 100);
    rawTotal -= memberDiscountCents;
  }

  const finalTotal = Math.max(0, rawTotal);

  return {
    totalCents: finalTotal,
    breakdown: {
      days: dayResults,
      freeMinutesDeducted: actualFree,
      memberDiscountCents,
      firstSegmentDeductionCents,
      rawTotal: finalTotal + memberDiscountCents + firstSegmentDeductionCents,
      finalTotal,
    },
  };
}

function buildSnapshot(plan, segments) {
  return {
    name: plan.name,
    vehicleType: plan.vehicleType,
    isHoliday: !!plan.isHoliday,
    freeMinutes: plan.freeMinutes,
    dailyCapCents: plan.dailyCapCents,
    memberDiscountPct: plan.memberDiscountPct,
    firstSegmentFree: !!plan.firstSegmentFree,
    segments: segments.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
      unitPriceCents: s.unitPriceCents,
      granularityMinutes: s.granularityMinutes,
      minDurationMinutes: s.minDurationMinutes,
    })),
  };
}

module.exports = { calculateFee, buildSnapshot, parseDateTime, dateToYmd };
