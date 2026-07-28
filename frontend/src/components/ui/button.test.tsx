import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/primitives';

describe('Button', () => {
  it('renders children text', () => {
    render(<Button>اضغط هنا</Button>);
    expect(screen.getByRole('button', { name: 'اضغط هنا' })).toBeInTheDocument();
  });

  it('applies primary variant by default', () => {
    render(<Button>اختبار</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('bg-pine-700');
  });

  it('applies secondary variant', () => {
    render(<Button variant="secondary">ثانوي</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('border-concrete-200');
  });

  it('disables when loading', () => {
    render(<Button loading>تحميل</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('disables when disabled prop is set', () => {
    render(<Button disabled>معطّل</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
