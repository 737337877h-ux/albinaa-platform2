import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import OracleTestRequestsPage from './page';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/lib/auth', () => ({ useCan: () => () => true }));
vi.mock('@/components/app-shell', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ reset: vi.fn(), mutate: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('opens the request form and adds distinct lines on local HTTP without randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
  render(<OracleTestRequestsPage />);
  expect(screen.getByRole('heading', { name: 'عمليات ONYX' })).toBeInTheDocument();
  const initialInputs = screen.getAllByRole('spinbutton').length;
  fireEvent.click(screen.getByRole('button', { name: 'إضافة صنف' }));
  fireEvent.click(screen.getByRole('button', { name: 'إضافة صنف' }));
  expect(screen.getAllByRole('spinbutton')).toHaveLength(initialInputs + 2);
  expect(screen.getByRole('button', { name: 'حفظ مسودة' })).toBeDisabled();
});
