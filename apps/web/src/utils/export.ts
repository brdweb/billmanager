import type { TFunction } from 'i18next';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Bill, PaymentWithBill } from '../api/client';
import { formatDateForAPI } from './date';
import { formatCurrency, getLocale } from '../lib/currency';

// Format date for display
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(getLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format frequency for display
function formatFrequency(bill: Bill, t: TFunction): string {
  let frequencyConfig: { dates?: number[]; days?: number[] } = {};
  try { frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {}; } catch { /* ignore malformed config */ }

  switch (bill.frequency) {
    case 'weekly':
      return t('common.frequency.weekly');
    case 'bi-weekly':
    case 'biweekly':
      return t('common.frequency.biweekly');
    case 'quarterly':
      return t('common.frequency.quarterly');
    case 'yearly':
      return t('common.frequency.yearly');
    case 'monthly':
      if (bill.frequency_type === 'specific_dates' && frequencyConfig.dates) {
        return t('common.frequency.monthlyOnDates', { dates: frequencyConfig.dates.join(', ') });
      }
      return t('common.frequency.monthly');
    case 'custom':
      if (bill.frequency_type === 'multiple_weekly' && frequencyConfig.days) {
        const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
        const days = frequencyConfig.days.map((d: number) => t(`common.weekdaysShort.${dayKeys[d]}`)).join(', ');
        return t('common.frequency.customWeekly', { days });
      }
      return t('common.frequency.custom');
    default:
      return bill.frequency;
  }
}

// Get current date formatted for filenames
function getDateForFilename(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Escape CSV values (handle commas, quotes, newlines)
function escapeCSV(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Export bills to CSV
export function exportBillsToCSV(bills: Bill[], t: TFunction, filename?: string): void {
  const headers = [
    t('common.table.name'),
    t('common.table.type'),
    t('common.table.amount'),
    t('export.nextDue'),
    t('common.table.frequency'),
    t('export.account'),
    t('export.category'),
    t('export.notes'),
    t('common.autoPay'),
    t('common.archived'),
  ];

  const rows = bills.map(bill => [
    escapeCSV(bill.name),
    escapeCSV(bill.type === 'deposit' ? t('common.billType.deposit') : t('common.billType.expense')),
    escapeCSV(bill.varies ? `${t('common.varies')} (~${formatCurrency(bill.avg_amount || 0)})` : formatCurrency(bill.amount || 0)),
    escapeCSV(formatDate(bill.next_due)),
    escapeCSV(formatFrequency(bill, t)),
    escapeCSV(bill.account || ''),
    escapeCSV(bill.category || ''),
    escapeCSV(bill.notes || ''),
    escapeCSV(bill.auto_payment ? t('export.yes') : t('export.no')),
    escapeCSV(bill.archived ? t('export.yes') : t('export.no')),
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  downloadFile(csvContent, filename || `bills-${getDateForFilename()}.csv`, 'text/csv');
}

// Export bills to PDF
export function exportBillsToPDF(bills: Bill[], t: TFunction, filename?: string): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(18);
  doc.text(t('export.billsReportTitle'), 14, 22);

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`${t('export.generatedPrefix')} ${new Date().toLocaleDateString(getLocale())}`, 14, 30);

  // Summary
  const totalExpenses = bills
    .filter(b => b.type === 'expense' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);
  const totalDeposits = bills
    .filter(b => b.type === 'deposit' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);

  doc.setTextColor(0);
  doc.text(`${t('export.totalMonthlyExpenses')} ${formatCurrency(totalExpenses)}`, 14, 38);
  doc.text(`${t('export.totalMonthlyIncome')} ${formatCurrency(totalDeposits)}`, 14, 44);

  // Table
  autoTable(doc, {
    startY: 52,
    head: [[t('common.table.name'), t('common.table.type'), t('common.table.amount'), t('export.nextDue'), t('common.table.frequency'), t('export.account'), t('export.category')]],
    body: bills.map(bill => [
      bill.name,
      bill.type === 'deposit' ? t('common.billType.deposit') : t('common.billType.expense'),
      bill.varies ? `~${formatCurrency(bill.avg_amount || 0)}` : formatCurrency(bill.amount || 0),
      formatDate(bill.next_due),
      formatFrequency(bill, t),
      bill.account || '-',
      bill.category || '-',
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] }, // Emerald green (#10B981)
    alternateRowStyles: { fillColor: [240, 253, 244] }, // Light emerald
  });

  doc.save(filename || `bills-${getDateForFilename()}.pdf`);
}

// Export payments to CSV
export function exportPaymentsToCSV(
  payments: PaymentWithBill[],
  t: TFunction,
  dateRange?: { from?: Date; to?: Date },
  filename?: string
): void {
  const headers = [t('export.billName'), t('export.paymentDate'), t('common.table.amount')];

  const rows = payments.map(payment => [
    escapeCSV(payment.bill_name),
    escapeCSV(formatDate(payment.payment_date)),
    escapeCSV(formatCurrency(payment.amount)),
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

  // Build filename with date range if provided
  let exportFilename = filename;
  if (!exportFilename) {
    if (dateRange?.from || dateRange?.to) {
      const from = dateRange.from ? formatDateForAPI(dateRange.from) : 'start';
      const to = dateRange.to ? formatDateForAPI(dateRange.to) : 'end';
      exportFilename = `payments-${from}-to-${to}.csv`;
    } else {
      exportFilename = `payments-${getDateForFilename()}.csv`;
    }
  }

  downloadFile(csvContent, exportFilename, 'text/csv');
}

// Export payments to PDF
export function exportPaymentsToPDF(
  payments: PaymentWithBill[],
  t: TFunction,
  dateRange?: { from?: Date; to?: Date },
  filename?: string
): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(18);
  doc.text(t('export.paymentsReportTitle'), 14, 22);

  // Date range
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (dateRange?.from || dateRange?.to) {
    const from = dateRange.from ? dateRange.from.toLocaleDateString(getLocale()) : t('export.beginning');
    const to = dateRange.to ? dateRange.to.toLocaleDateString(getLocale()) : t('export.present');
    doc.text(`${t('export.periodPrefix')} ${from} - ${to}`, 14, 30);
  } else {
    doc.text(`${t('export.generatedPrefix')} ${new Date().toLocaleDateString(getLocale())}`, 14, 30);
  }

  // Summary
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  doc.setTextColor(0);
  doc.text(`${t('export.totalPayments')} ${payments.length}`, 14, 38);
  doc.text(`${t('export.totalAmount')} ${formatCurrency(totalAmount)}`, 14, 44);

  // Table
  autoTable(doc, {
    startY: 52,
    head: [[t('export.billName'), t('export.paymentDate'), t('common.table.amount')]],
    body: payments.map(payment => [
      payment.bill_name,
      formatDate(payment.payment_date),
      formatCurrency(payment.amount),
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] }, // Emerald green (#10B981)
    alternateRowStyles: { fillColor: [240, 253, 244] }, // Light emerald
    foot: [['', t('export.total'), formatCurrency(totalAmount)]],
    footStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
  });

  // Build filename with date range if provided
  let exportFilename = filename;
  if (!exportFilename) {
    if (dateRange?.from || dateRange?.to) {
      const from = dateRange.from ? formatDateForAPI(dateRange.from) : 'start';
      const to = dateRange.to ? formatDateForAPI(dateRange.to) : 'end';
      exportFilename = `payments-${from}-to-${to}.pdf`;
    } else {
      exportFilename = `payments-${getDateForFilename()}.pdf`;
    }
  }

  doc.save(exportFilename);
}

// Print payments as clean data-only PDF (no colors)
export function printPayments(
  payments: PaymentWithBill[],
  t: TFunction,
  dateRange?: { from?: Date; to?: Date }
): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(16);
  doc.text(t('export.paymentHistoryTitle'), 14, 20);

  // Date range
  doc.setFontSize(9);
  if (dateRange?.from || dateRange?.to) {
    const from = dateRange.from ? dateRange.from.toLocaleDateString(getLocale()) : t('export.beginning');
    const to = dateRange.to ? dateRange.to.toLocaleDateString(getLocale()) : t('export.present');
    doc.text(`${t('export.periodPrefix')} ${from} - ${to}`, 14, 27);
  } else {
    doc.text(`${t('export.generatedPrefix')} ${new Date().toLocaleDateString(getLocale())}`, 14, 27);
  }

  // Summary
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  doc.text(`${t('export.totalPayments')} ${payments.length}`, 14, 33);
  doc.text(`${t('export.totalAmount')} ${formatCurrency(totalAmount)}`, 14, 38);

  // Clean table with no colors
  autoTable(doc, {
    startY: 44,
    head: [[t('export.billName'), t('export.paymentDate'), t('common.table.amount')]],
    body: payments.map(payment => [
      payment.bill_name,
      formatDate(payment.payment_date),
      formatCurrency(payment.amount),
    ]),
    styles: {
      fontSize: 9,
      textColor: [0, 0, 0], // Black text
      lineColor: [0, 0, 0], // Black borders
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [255, 255, 255], // White background
      textColor: [0, 0, 0], // Black text
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255] // White background (no alternating colors)
    },
    foot: [['', t('export.total'), formatCurrency(totalAmount)]],
    footStyles: {
      fillColor: [255, 255, 255], // White background
      textColor: [0, 0, 0], // Black text
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
  });

  // Open print dialog
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}

// Print bills as clean data-only PDF (no colors)
export function printBills(bills: Bill[], t: TFunction): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(16);
  doc.text(t('export.billsReportTitle'), 14, 20);

  // Date
  doc.setFontSize(9);
  doc.text(`${t('export.generatedPrefix')} ${new Date().toLocaleDateString(getLocale())}`, 14, 27);

  // Summary
  const totalExpenses = bills
    .filter(b => b.type === 'expense' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);
  const totalDeposits = bills
    .filter(b => b.type === 'deposit' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);

  doc.text(`${t('export.totalMonthlyExpenses')} ${formatCurrency(totalExpenses)}`, 14, 33);
  doc.text(`${t('export.totalMonthlyIncome')} ${formatCurrency(totalDeposits)}`, 14, 38);

  // Clean table with no colors
  autoTable(doc, {
    startY: 44,
    head: [[t('common.table.name'), t('common.table.type'), t('common.table.amount'), t('export.nextDue'), t('common.table.frequency'), t('export.account')]],
    body: bills.map(bill => [
      bill.name,
      bill.type === 'deposit' ? t('common.billType.deposit') : t('common.billType.expense'),
      bill.varies ? `~${formatCurrency(bill.avg_amount || 0)}` : formatCurrency(bill.amount || 0),
      formatDate(bill.next_due),
      formatFrequency(bill, t),
      bill.account || '-',
    ]),
    styles: {
      fontSize: 9,
      textColor: [0, 0, 0], // Black text
      lineColor: [0, 0, 0], // Black borders
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [255, 255, 255], // White background
      textColor: [0, 0, 0], // Black text
      fontStyle: 'bold',
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255] // White background (no alternating colors)
    },
  });

  // Open print dialog
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}

// Helper to trigger file download
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
