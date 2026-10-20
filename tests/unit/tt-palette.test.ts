import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TT_PALETTE } from '../../src/lib/tt-palette';
import {
  relativeLuminance,
  parseHex,
  contrastRatio,
} from '../../src/app/engine/visuals/tt-contrast';

/**
 * src/lib/tt-palette.ts must equal the `@theme` tokens it mirrors.
 *
 * The contrast maths and the gradient presets run on these numbers, not on the
 * CSS — so a palette change made in global.css alone would leave the scrim
 * protecting digits of a colour that no longer exists.
 */

const css = readFileSync(join(process.cwd(), 'src', 'styles', 'global.css'), 'utf8');
const theme = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const token = (name: string) =>
  new RegExp(`--color-tt-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(theme)?.[1]?.toLowerCase();

describe('TT_PALETTE mirrors the @theme tokens', () => {
  it.each(Object.entries(TT_PALETTE))('%s matches --color-tt-%s', (name, hex) => {
    expect(token(name), `--color-tt-${name} not found in @theme`).toBe(hex);
  });

  it('keeps the digits legible on the bare chassis', () => {
    const digit = parseHex(TT_PALETTE.digit)!;
    const chassis = parseHex(TT_PALETTE.void)!;
    expect(
      contrastRatio(relativeLuminance(...digit), relativeLuminance(...chassis)),
    ).toBeGreaterThan(4.5);
  });
});
