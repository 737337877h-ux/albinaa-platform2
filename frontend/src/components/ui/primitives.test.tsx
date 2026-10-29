import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, Card, CardHeader, Empty, ErrorNote, Money, Skeleton } from '@/components/ui/primitives';

describe('Badge', () => {
  it('renders children text', () => {
    render(<Badge>YER</Badge>);
    expect(screen.getByText('YER')).toBeInTheDocument();
  });

  it('renders with neutral tone by default', () => {
    render(<Badge>اختبار</Badge>);
    const span = screen.getByText('اختبار');
    expect(span.className).toContain('bg-concrete-100');
  });

  it('renders with pine tone', () => {
    render(<Badge tone="pine"> pine </Badge>);
    expect(screen.getByText('pine').className).toContain('bg-pine-50');
  });
});

describe('Card', () => {
  it('renders children', () => {
    render(<Card><p>محتوى البطاقة</p></Card>);
    expect(screen.getByText('محتوى البطاقة')).toBeInTheDocument();
  });
});

describe('CardHeader', () => {
  it('renders title', () => {
    render(<CardHeader title="العنوان" />);
    expect(screen.getByText('العنوان')).toBeInTheDocument();
  });

  it('renders action when provided', () => {
    render(<CardHeader title="العنوان" action={<button>إجراء</button>} />);
    expect(screen.getByRole('button', { name: 'إجراء' })).toBeInTheDocument();
  });
});

describe('Empty', () => {
  it('renders title and optional hint', () => {
    render(<Empty title="لا بيانات" hint="أضف بعض البيانات" />);
    expect(screen.getByText('لا بيانات')).toBeInTheDocument();
    expect(screen.getByText('أضف بعض البيانات')).toBeInTheDocument();
  });
});

describe('ErrorNote', () => {
  it('renders error message with alert role', () => {
    render(<ErrorNote message="حدث خطأ" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('حدث خطأ');
  });
});

describe('Money', () => {
  it('renders formatted amount with currency', () => {
    render(<Money value={1234567} currency="YER" />);
    expect(screen.getByText(/YER$/)).toBeInTheDocument();
  });

  it('renders zero when value is null', () => {
    render(<Money value={null} />);
    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('renders zero when value is undefined', () => {
    render(<Money value={undefined} />);
    expect(screen.getByText(/0/)).toBeInTheDocument();
  });

  it('renders with signed label for positive', () => {
    render(<Money value={500} currency="YER" signed />);
    expect(screen.getByText(/مدين/)).toBeInTheDocument();
  });

  it('renders with signed label for negative', () => {
    render(<Money value={-500} currency="YER" signed />);
    expect(screen.getByText(/دائن/)).toBeInTheDocument();
  });
});

describe('Skeleton', () => {
  it('renders the branded shimmer skeleton', () => {
    const { container } = render(<Skeleton className="h-10" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('skeleton-shimmer');
    expect(el.className).toContain('h-10');
  });
});
