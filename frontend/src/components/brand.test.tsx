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
  it('renders an img element for logo', () => {
    render(<BrandLogo />);
    const img = screen.getByAltText('شعار البناء الراقي');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/logo.svg');
  });

  it('accepts custom className', () => {
    render(<BrandLogo className="h-12 w-12" />);
    const img = screen.getByAltText('شعار البناء الراقي');
    expect(img.className).toContain('h-12');
  });
});
