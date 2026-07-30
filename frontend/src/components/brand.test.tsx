import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo, BrickMark } from '@/components/brand';

describe('BrickMark', () => {
  it('renders an SVG element', () => {
    const { container } = render(<BrickMark />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('accepts custom className', () => {
    const { container } = render(<BrickMark className="h-10 w-10" />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal).toContain('h-10');
  });
});

describe('BrandLogo', () => {
  it('renders an inline SVG (no img to avoid hydration mismatch)', () => {
    const { container } = render(<BrandLogo />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('accepts custom className', () => {
    const { container } = render(<BrandLogo className="h-12 w-12" />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal).toContain('h-12');
  });
});
