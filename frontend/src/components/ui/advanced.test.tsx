import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, Sparkline } from './advanced';
import { DataTable } from './data-table';
import { CurrencyChip, RiskBadge, StatCard } from './primitives';

describe('financial design system', () => {
  it('renders currency, risk, and financial stat semantics', () => {
    render(<><CurrencyChip code="YER" /><RiskBadge level="critical" /><StatCard label="المديونية" value="12,500" currency="YER" tone="money" /></>);
    expect(screen.getAllByText('YER')).toHaveLength(2);
    expect(screen.getByText('حرج')).toHaveClass('critical-glow');
    expect(screen.getByText('12,500').parentElement).toHaveClass('text-gold');
  });

  it('requires the confirmation word for dangerous actions', () => {
    const confirm = vi.fn();
    render(<ConfirmDialog open onClose={() => undefined} title="حذف" description="عملية خطرة" confirmWord="تأكيد" onConfirm={confirm} />);
    const button = screen.getByRole('button', { name: 'تأكيد العملية' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'تأكيد' } });
    fireEvent.click(button); expect(confirm).toHaveBeenCalledOnce();
  });

  it('provides sortable desktop rows and mobile cards', () => {
    render(<DataTable rows={[{ id: '2', name: 'ب' }, { id: '1', name: 'أ' }]} rowKey={(row) => row.id} columns={[{ key: 'name', header: 'الاسم', render: (row) => row.name, sortValue: (row) => row.name }]} />);
    expect(screen.getAllByText('الاسم').length).toBeGreaterThan(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'الاسم' })[0]);
    expect(screen.getAllByText('أ').length).toBeGreaterThan(0);
  });

  it('renders an accessible RTL sparkline', () => {
    render(<Sparkline values={[1, 4, 2]} label="اتجاه التحصيل" />);
    expect(screen.getByRole('img', { name: 'اتجاه التحصيل' })).toBeInTheDocument();
  });
});
