import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptRequestList } from './receipt-request-list';
import { receiptMethod } from '@/lib/receipt-request-display';

afterEach(cleanup);
const items = [
  { requestNo: '11', requestSerial: 'serial11', status: 'pending_approval', recipientName: 'العميل التجريبي الثالث', platformCustomerCode: '90004', collectorName: 'المحصل الثاني', collectorNo: '2', amount: 210000, currencyCode: 'YER', description: 'لكم حوالة رقم 333 من الأخ يوسف', attachment: { fileName: 'eleven.jpg', previewPath: '/receipts/eleven' } },
  { requestNo: '10', requestSerial: 'serial10', status: 'rejected', recipientName: 'عميل نقدي', platformCustomerCode: '20011', collectorName: 'المحصل الأول', collectorNo: '1', amount: 500, currencyCode: 'SAR', paymentMethod: 'cash', attachment: { fileName: 'ten.jpg', previewPath: '/receipts/ten' } },
];
describe('receipt request cards', () => {
  it('shows customer, account, amount and collector explicitly', () => {
    render(<ReceiptRequestList items={items} onPreview={vi.fn()} />);
    for (const text of ['العميل التجريبي الثالث', '90004', 'المحصل الثاني', '210,000']) expect(screen.getByText(text, { exact: text !== '210,000' })).toBeTruthy();
  });
  it('searches by customer code', () => {
    render(<ReceiptRequestList items={items} onPreview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('البحث في طلبات القبض'), { target: { value: '20011' } });
    expect(screen.queryByText('العميل التجريبي الثالث')).toBeNull();
    expect(screen.getByText('عميل نقدي')).toBeTruthy();
  });
  it('combines status and method filters', () => {
    render(<ReceiptRequestList items={items} onPreview={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('طريقة التحصيل'), { target: { value: 'cash' } });
    expect(screen.queryByText('العميل التجريبي الثالث')).toBeNull();
    fireEvent.change(screen.getByLabelText('حالة الطلب'), { target: { value: 'pending_approval' } });
    expect(screen.queryByText('عميل نقدي')).toBeNull();
    expect(screen.getByText(/لا توجد طلبات مطابقة/)).toBeTruthy();
  });
  it('previews the exact selected request, not another receipt', () => {
    const preview = vi.fn();
    render(<ReceiptRequestList items={items} onPreview={preview} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'معاينة الإيصال' })[1]);
    expect(preview).toHaveBeenCalledWith(items[1]);
  });
  it('does not guess missing payment information', () => {
    expect(receiptMethod({ description: 'تحصيل من التطبيق' }).key).toBe('unknown');
    expect(receiptMethod(items[0])).toMatchObject({ key: 'bank', inferred: true });
    expect(receiptMethod(items[1])).toMatchObject({ key: 'cash', inferred: false });
    expect(receiptMethod({ description: 'لكم إيداع عبر محفظة جيب' }).key).toBe('wallet');
    expect(receiptMethod({ paymentMethod: 'bank_transfer', description: 'لكم إيداع عبر جيب' })).toMatchObject({ key: 'wallet', inferred: true });
  });
});
