import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Bill, PaymentWithBill } from '../api/client';

// Format date for display
function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Format frequency for display
function formatFrequency(bill: Bill): string {
  const frequencyConfig = bill.frequency_config ? JSON.parse(bill.frequency_config) : {};

  switch (bill.frequency) {
    case 'weekly':
      return 'Weekly';
    case 'bi-weekly':
    case 'biweekly':
      return 'Bi-weekly';
    case 'quarterly':
      return 'Quarterly';
    case 'yearly':
      return 'Yearly';
    case 'monthly':
      if (bill.frequency_type === 'specific_dates' && frequencyConfig.dates) {
        return `Monthly (${frequencyConfig.dates.join(', ')})`;
      }
      return 'Monthly';
    case 'custom':
      if (bill.frequency_type === 'multiple_weekly' && frequencyConfig.days) {
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const days = frequencyConfig.days.map((d: number) => dayNames[d]).join(', ');
        return `Weekly (${days})`;
      }
      return 'Custom';
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
export function exportBillsToCSV(bills: Bill[], filename?: string): void {
  const headers = ['Name', 'Type', 'Amount', 'Next Due', 'Frequency', 'Account', 'Auto-pay', 'Archived'];

  const rows = bills.map(bill => [
    escapeCSV(bill.name),
    escapeCSV(bill.type === 'deposit' ? 'Deposit' : 'Expense'),
    escapeCSV(bill.varies ? `Varies (~$${(bill.avg_amount || 0).toFixed(2)})` : `$${(bill.amount || 0).toFixed(2)}`),
    escapeCSV(formatDate(bill.next_due)),
    escapeCSV(formatFrequency(bill)),
    escapeCSV(bill.account || ''),
    escapeCSV(bill.auto_payment ? 'Yes' : 'No'),
    escapeCSV(bill.archived ? 'Yes' : 'No'),
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  downloadFile(csvContent, filename || `bills-${getDateForFilename()}.csv`, 'text/csv');
}

// Export bills to PDF
export function exportBillsToPDF(bills: Bill[], filename?: string): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(18);
  doc.text('Bills Report', 14, 22);

  // Date
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);

  // Summary
  const totalExpenses = bills
    .filter(b => b.type === 'expense' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);
  const totalDeposits = bills
    .filter(b => b.type === 'deposit' && !b.archived)
    .reduce((sum, b) => sum + (b.varies ? (b.avg_amount || 0) : (b.amount || 0)), 0);

  doc.setTextColor(0);
  doc.text(`Total Monthly Expenses: $${totalExpenses.toFixed(2)}`, 14, 38);
  doc.text(`Total Monthly Income: $${totalDeposits.toFixed(2)}`, 14, 44);

  // Table
  autoTable(doc, {
    startY: 52,
    head: [['Name', 'Type', 'Amount', 'Next Due', 'Frequency', 'Account']],
    body: bills.map(bill => [
      bill.name,
      bill.type === 'deposit' ? 'Deposit' : 'Expense',
      bill.varies ? `~$${(bill.avg_amount || 0).toFixed(2)}` : `$${(bill.amount || 0).toFixed(2)}`,
      formatDate(bill.next_due),
      formatFrequency(bill),
      bill.account || '-',
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
  dateRange?: { from?: Date; to?: Date },
  filename?: string
): void {
  const headers = ['Bill Name', 'Payment Date', 'Amount'];

  const rows = payments.map(payment => [
    escapeCSV(payment.bill_name),
    escapeCSV(formatDate(payment.payment_date)),
    escapeCSV(`$${payment.amount.toFixed(2)}`),
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');

  // Build filename with date range if provided
  let exportFilename = filename;
  if (!exportFilename) {
    if (dateRange?.from || dateRange?.to) {
      const from = dateRange.from ? dateRange.from.toISOString().split('T')[0] : 'start';
      const to = dateRange.to ? dateRange.to.toISOString().split('T')[0] : 'end';
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
  dateRange?: { from?: Date; to?: Date },
  filename?: string
): void {
  const doc = new jsPDF();

  // Title
  doc.setFontSize(18);
  doc.text('Payments Report', 14, 22);

  // Date range
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (dateRange?.from || dateRange?.to) {
    const from = dateRange.from ? dateRange.from.toLocaleDateString() : 'Beginning';
    const to = dateRange.to ? dateRange.to.toLocaleDateString() : 'Present';
    doc.text(`Period: ${from} - ${to}`, 14, 30);
  } else {
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30);
  }

  // Summary
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  doc.setTextColor(0);
  doc.text(`Total Payments: ${payments.length}`, 14, 38);
  doc.text(`Total Amount: $${totalAmount.toFixed(2)}`, 14, 44);

  // Table
  autoTable(doc, {
    startY: 52,
    head: [['Bill Name', 'Payment Date', 'Amount']],
    body: payments.map(payment => [
      payment.bill_name,
      formatDate(payment.payment_date),
      `$${payment.amount.toFixed(2)}`,
    ]),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [16, 185, 129] }, // Emerald green (#10B981)
    alternateRowStyles: { fillColor: [240, 253, 244] }, // Light emerald
    foot: [['', 'Total:', `$${totalAmount.toFixed(2)}`]],
    footStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold' },
  });

  // Build filename with date range if provided
  let exportFilename = filename;
  if (!exportFilename) {
    if (dateRange?.from || dateRange?.to) {
      const from = dateRange.from ? dateRange.from.toISOString().split('T')[0] : 'start';
      const to = dateRange.to ? dateRange.to.toISOString().split('T')[0] : 'end';
      exportFilename = `payments-${from}-to-${to}.pdf`;
    } else {
      exportFilename = `payments-${getDateForFilename()}.pdf`;
    }
  }

  doc.save(exportFilename);
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
