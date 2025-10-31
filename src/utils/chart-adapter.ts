// Adapter registration helper for chartjs-adapter-date-fns
// This file exports a function to register the adapter with a Chart.js instance

import { _adapters } from 'chart.js';
import {
  toDate,
  parse,
  parseISO,
  isValid,
  format,
  addYears,
  addQuarters,
  addMonths,
  addWeeks,
  addDays,
  addHours,
  addMinutes,
  addSeconds,
  addMilliseconds,
  differenceInYears,
  differenceInQuarters,
  differenceInMonths,
  differenceInWeeks,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  differenceInMilliseconds,
  startOfYear,
  startOfQuarter,
  startOfMonth,
  startOfWeek,
  startOfDay,
  startOfHour,
  startOfMinute,
  startOfSecond,
  endOfYear,
  endOfQuarter,
  endOfMonth,
  endOfWeek,
  endOfDay,
  endOfHour,
  endOfMinute,
  endOfSecond
} from 'date-fns';

const FORMATS = {
  datetime: 'MMM d, yyyy, h:mm:ss aaaa',
  millisecond: 'h:mm:ss.SSS aaaa',
  second: 'h:mm:ss aaaa',
  minute: 'h:mm aaaa',
  hour: 'ha',
  day: 'MMM d',
  week: 'PP',
  month: 'MMM yyyy',
  quarter: 'qqq - yyyy',
  year: 'yyyy'
};

// Type definition for the adapter context
interface DateAdapterContext {
  options?: Record<string, unknown>;
}

export function registerDateAdapter() {
  _adapters._date.override({
    formats: function () {
      return FORMATS;
    },

    parse: function (this: DateAdapterContext, value: unknown, fmt?: string) {
      if (value === null || typeof value === 'undefined') {
        return null;
      }
      const type = typeof value;
      let dateValue: Date;
      if (type === 'number' || value instanceof Date) {
        dateValue = toDate(value as Date | number);
      } else if (type === 'string') {
        if (typeof fmt === 'string') {
          dateValue = parse(value as string, fmt, new Date(), this.options);
        } else {
          dateValue = parseISO(value as string, this.options);
        }
      } else {
        return null;
      }
      return isValid(dateValue) ? dateValue.getTime() : null;
    },

    format: function (this: DateAdapterContext, time: number, fmt: string) {
      return format(time, fmt, this.options);
    },

    add: function (time: number, amount: number, unit: string) {
      switch (unit) {
        case 'millisecond':
          return addMilliseconds(time, amount).getTime();
        case 'second':
          return addSeconds(time, amount).getTime();
        case 'minute':
          return addMinutes(time, amount).getTime();
        case 'hour':
          return addHours(time, amount).getTime();
        case 'day':
          return addDays(time, amount).getTime();
        case 'week':
          return addWeeks(time, amount).getTime();
        case 'month':
          return addMonths(time, amount).getTime();
        case 'quarter':
          return addQuarters(time, amount).getTime();
        case 'year':
          return addYears(time, amount).getTime();
        default:
          return time;
      }
    },

    diff: function (max: number, min: number, unit: string) {
      switch (unit) {
        case 'millisecond':
          return differenceInMilliseconds(max, min);
        case 'second':
          return differenceInSeconds(max, min);
        case 'minute':
          return differenceInMinutes(max, min);
        case 'hour':
          return differenceInHours(max, min);
        case 'day':
          return differenceInDays(max, min);
        case 'week':
          return differenceInWeeks(max, min);
        case 'month':
          return differenceInMonths(max, min);
        case 'quarter':
          return differenceInQuarters(max, min);
        case 'year':
          return differenceInYears(max, min);
        default:
          return 0;
      }
    },

    startOf: function (time: number, unit: string) {
      switch (unit) {
        case 'second':
          return startOfSecond(time).getTime();
        case 'minute':
          return startOfMinute(time).getTime();
        case 'hour':
          return startOfHour(time).getTime();
        case 'day':
          return startOfDay(time).getTime();
        case 'week':
          return startOfWeek(time).getTime();
        case 'month':
          return startOfMonth(time).getTime();
        case 'quarter':
          return startOfQuarter(time).getTime();
        case 'year':
          return startOfYear(time).getTime();
        default:
          return time;
      }
    },

    endOf: function (time: number, unit: string) {
      switch (unit) {
        case 'second':
          return endOfSecond(time).getTime();
        case 'minute':
          return endOfMinute(time).getTime();
        case 'hour':
          return endOfHour(time).getTime();
        case 'day':
          return endOfDay(time).getTime();
        case 'week':
          return endOfWeek(time).getTime();
        case 'month':
          return endOfMonth(time).getTime();
        case 'quarter':
          return endOfQuarter(time).getTime();
        case 'year':
          return endOfYear(time).getTime();
        default:
          return time;
      }
    }
  });
}

// Auto-register on import to ensure adapter is available
registerDateAdapter();
