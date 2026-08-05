import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataState, PermissionNotice } from '@/components/ui/data-state';

describe('DataState', () => {
  it('shows skeleton when loading', () => {
    const { container } = render(
      <DataState isLoading isError={false} isEmpty={false} emptyTitle="">
        <div>محتوى</div>
      </DataState>,
    );
    expect(container.firstChild).toHaveClass('rounded-lg');
    expect((container.firstChild as HTMLElement).className).toContain('skeleton-shimmer');
    expect(screen.queryByText('محتوى')).not.toBeInTheDocument();
  });

  it('shows error message when isError', () => {
    render(
      <DataState isLoading={false} isError isEmpty={false} emptyTitle="" error={{ message: 'فشل الشبكة' }}>
        <div>محتوى</div>
      </DataState>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('محتوى')).not.toBeInTheDocument();
  });

  it('shows retry button when onRetry provided and error', () => {
    const onRetry = vi.fn();
    render(
      <DataState isLoading={false} isError isEmpty={false} emptyTitle="" onRetry={onRetry}>
        <div>محتوى</div>
      </DataState>,
    );
    const btn = screen.getByRole('button', { name: 'إعادة المحاولة' });
    expect(btn).toBeInTheDocument();
    btn.click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows empty state when isEmpty', () => {
    render(
      <DataState isLoading={false} isError={false} isEmpty emptyTitle="لا نتائج">
        <div>محتوى</div>
      </DataState>,
    );
    expect(screen.getByText('لا نتائج')).toBeInTheDocument();
    expect(screen.queryByText('محتوى')).not.toBeInTheDocument();
  });

  it('renders children when not loading, not error, not empty', () => {
    render(
      <DataState isLoading={false} isError={false} isEmpty={false} emptyTitle="">
        <div>محتوى الصفحة</div>
      </DataState>,
    );
    expect(screen.getByText('محتوى الصفحة')).toBeInTheDocument();
  });
});

describe('PermissionNotice', () => {
  it('renders the notice message', () => {
    render(<PermissionNotice message="لا تملك صلاحية الوصول" />);
    expect(screen.getByText('لا تملك صلاحية الوصول')).toBeInTheDocument();
  });
});
