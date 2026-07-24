import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('mobile money input consumers', () => {
  it('wires bill amount and payment create/edit inputs to the money contract', () => {
    // Given / When
    const addBill = source('../screens/AddBillScreen.tsx');
    const billDetail = source('../screens/BillDetailScreen.tsx');

    // Then
    expect(addBill).toContain('parseMoneyInput(amount)');
    expect(addBill).toContain('{...moneyInputProps}');
    expect(billDetail).toContain('parseMoneyInput(payAmount)');
    expect(billDetail).toContain('parseMoneyInput(editAmount)');
    expect(billDetail.match(/\{\.\.\.moneyInputProps\}/g)).toHaveLength(2);
    expect(addBill).not.toContain('placeholder="0.00"');
    expect(billDetail).not.toContain('placeholder="0.00"');
  });

  it('uses money parsing only for fixed shares and preserves decimal percentage parsing', () => {
    // Given / When
    const shareBill = source('../components/ShareBillModal.tsx');

    // Then
    expect(shareBill).toContain("splitType === 'fixed' ? getMoneyInputPlaceholder()");
    expect(shareBill).toContain("splitType === 'fixed' ? getMoneyInputKeyboardType()");
    expect(shareBill).toContain('parseMoneyInput(splitValue)');
    expect(shareBill).toContain('Number.parseFloat(splitValue)');
  });

  it('wires payment amount filters and editing to scale-aware input props and parsing', () => {
    // Given / When
    const paymentHistory = source('../features/payments/PaymentHistoryContainer.tsx');

    // Then
    expect(paymentHistory).toContain('parseMoneyInput(minAmountDraft)');
    expect(paymentHistory).toContain('parseMoneyInput(maxAmountDraft)');
    expect(paymentHistory).toContain('parseMoneyInput(editAmount)');
    expect(paymentHistory.match(/\{\.\.\.moneyInputProps\}/g)).toHaveLength(3);
  });

  it('keeps SaaS plan pricing explicitly in USD', () => {
    // Given / When
    const billing = source('../features/billing/BillingContainer.tsx');

    // Then
    expect(billing).toContain("currency: 'USD'");
  });
});
