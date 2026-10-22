import type { Bill, Payment } from '../../types';
import {
  calendarDateKey,
  summarizeCashFlowWindow,
  type CashFlowRange,
} from '../cashFlowProjection';
import type {
  AnalyticsBreakdownItem,
  AnalyticsCashFlowPoint,
  AnalyticsMonthlyPoint,
  AnalyticsRange,
  AnalyticsYearPoint,
} from './models';

function shareBreakdown(values: Map<string, number>): AnalyticsBreakdownItem[] {
  const total = [...values.values()].reduce((sum, value) => sum + value, 0);
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, amount], index) => ({
      id: label,
      label,
      amount,
      sharePercent: total > 0 ? (amount / total) * 100 : 0,
      color: ['#006C4C', '#F36C00', '#587A6D', '#8A6F45', '#496A8B'][index % 5],
    }));
}

function monthKeys(start: string, end: string): string[] {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  const keys: string[] = [];
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return keys;
}

function monthEndKey(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, '0')}`;
}

function recordedByYear(payments: Payment[], bills: Bill[]) {
  const billById = new Map(bills.map((bill) => [bill.id, bill]));
  const totals = new Map<number, { income: number; expenses: number }>();
  payments.forEach((payment) => {
    const date = calendarDateKey(payment.payment_date);
    if (!date) return;
    const year = Number(date.slice(0, 4));
    const bill = billById.get(payment.bill_id);
    const direction = payment.bill_type ?? payment.original_bill_type ?? bill?.type;
    const deposit = direction === 'deposit' || Boolean(payment.is_received_payment);
    const bucket = totals.get(year) ?? { income: 0, expenses: 0 };
    if (deposit) bucket.income += payment.amount;
    else bucket.expenses += payment.amount;
    totals.set(year, bucket);
  });
  return totals;
}

function labeled(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function buildAnalyticsModel(input: {
  bills: Bill[];
  payments: Payment[];
  range: AnalyticsRange;
  year: number;
  today: Date;
  locale: string;
  uncategorizedLabel: string;
  noAccountLabel: string;
}) {
  const range: CashFlowRange = input.range;
  const snapshot = summarizeCashFlowWindow({
    bills: input.bills,
    payments: input.payments,
    range,
    today: input.today,
    year: input.year,
  });
  const todayKey = [
    input.today.getFullYear(),
    String(input.today.getMonth() + 1).padStart(2, '0'),
    String(input.today.getDate()).padStart(2, '0'),
  ].join('-');
  const byMonth = new Map<string, { income: number; expenses: number }>();
  const categories = new Map<string, number>();
  const accounts = new Map<string, number>();
  snapshot.events.forEach((event) => {
    const month = byMonth.get(event.date.slice(0, 7)) ?? { income: 0, expenses: 0 };
    month.income += event.income;
    month.expenses += event.expenses;
    byMonth.set(event.date.slice(0, 7), month);
    if (event.expenses > 0) {
      const category = labeled(event.category, input.uncategorizedLabel);
      const account = labeled(event.account, input.noAccountLabel);
      categories.set(category, (categories.get(category) ?? 0) + event.expenses);
      accounts.set(account, (accounts.get(account) ?? 0) + event.expenses);
    }
  });

  const monthly: AnalyticsMonthlyPoint[] = monthKeys(snapshot.window.start, snapshot.window.end).map((key) => {
    const [year, month] = key.split('-').map(Number);
    const point = byMonth.get(key) ?? { income: 0, expenses: 0 };
    return {
      key,
      label: new Intl.DateTimeFormat(input.locale, { month: 'short' }).format(new Date(year, month - 1, 1)),
      income: point.income,
      expenses: point.expenses,
      net: point.income - point.expenses,
    };
  });

  const history = recordedByYear(input.payments, input.bills);
  const yearly: AnalyticsYearPoint[] = [input.year - 2, input.year - 1, input.year].map((value) => {
    const point = history.get(value) ?? { income: 0, expenses: 0 };
    return { year: value, income: point.income, expenses: point.expenses, net: point.income - point.expenses };
  });

  let balance = 0;
  const cashFlow: AnalyticsCashFlowPoint[] = monthly.map((point) => {
    const openingBalance = balance;
    balance += point.income - point.expenses;
    return {
      key: point.key,
      label: point.label,
      openingBalance,
      income: point.income,
      expenses: point.expenses,
      endingBalance: balance,
      forecast: monthEndKey(point.key) >= todayKey,
    };
  });

  const selected = history.get(input.year) ?? { income: 0, expenses: 0 };
  const previous = history.get(input.year - 1) ?? { income: 0, expenses: 0 };
  const recordedNet = selected.income - selected.expenses;
  const net = snapshot.net;
  return {
    annual: {
      year: input.range === 'year' ? input.year : input.today.getFullYear(),
      income: snapshot.income,
      expenses: snapshot.expenses,
      net,
      savingsRate: snapshot.income > 0 ? (net / snapshot.income) * 100 : 0,
    },
    yearOverYear: {
      currentYear: input.year,
      previousYear: input.year - 1,
      incomeChangePercent: previous.income > 0 ? ((selected.income - previous.income) / previous.income) * 100 : 0,
      expenseChangePercent: previous.expenses > 0 ? ((selected.expenses - previous.expenses) / previous.expenses) * 100 : 0,
      netChange: recordedNet - (previous.income - previous.expenses),
    },
    categories: shareBreakdown(categories),
    accounts: shareBreakdown(accounts),
    monthly,
    yearly,
    cashFlow,
  };
}
