import { describe, expect, it } from 'vitest';
import { renderLandingPreview, verifyLandingSchema } from './landing-pages.js';

describe('renderLandingPreview', () => {
  it('renders a responsive landing from the stored schema and brand kit', () => {
    const html = renderLandingPreview({
      name: 'Autumn launch',
      schema: {
        headline: 'A warmer season',
        subheadline: 'A campaign for thoughtful brands.',
        cta: 'See the collection',
        sections: [{ heading: 'Crafted locally', body: 'Small runs, lasting impact.' }],
      },
      brandKit: {
        brandName: 'North & Pine',
        tagline: 'Made slowly',
        colors: ['#123456', '#fedcba', '#f7f7f7'],
      },
    });

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('North &amp; Pine');
    expect(html).toContain('A warmer season');
    expect(html).toContain('--primary:#123456');
    expect(html).toContain('@media(max-width:760px)');
  });

  it('escapes generated content and rejects unsafe color values', () => {
    const html = renderLandingPreview({
      name: '<script>alert(1)</script>',
      schema: {
        headline: '<img src=x onerror=alert(1)>',
        subheadline: '"quoted" & unsafe',
        cta: '<Click>',
        sections: [{ heading: '<b>Heading</b>', body: '<script>bad()</script>' }],
      },
      brandKit: {
        brandName: '<svg onload=alert(1)>',
        tagline: '',
        colors: ['red;}</style><script>alert(1)</script>'],
      },
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('--primary:#4c1d95');
  });

  it('only marks complete landing content as ready to publish', () => {
    expect(verifyLandingSchema({
      headline: 'A complete campaign',
      subheadline: 'A useful supporting message.',
      cta: 'Discover more',
      sections: [{ heading: 'Benefit', body: 'A concrete reason to choose the offer.' }],
    }).status).toBe('ready');

    const incomplete = verifyLandingSchema({
      headline: 'Draft',
      subheadline: '',
      cta: '',
      sections: [],
    });
    expect(incomplete.status).toBe('needs_attention');
    expect(incomplete.checks.subheadline).toBe(false);
    expect(incomplete.checks.callToAction).toBe(false);
    expect(incomplete.checks.sections).toBe(false);

    const leakedInternalId = verifyLandingSchema({
      headline: '1aaa9fed-501b-4557-9047-dfe6cf2c596b',
      subheadline: 'A useful supporting message.',
      cta: 'Discover more',
      sections: [{ heading: 'Benefit', body: 'A concrete customer benefit.' }],
    });
    expect(leakedInternalId.status).toBe('needs_attention');
    expect(leakedInternalId.checks.headline).toBe(false);
  });
});
