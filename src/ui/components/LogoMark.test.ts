import { describe, expect, it } from 'vitest';
import { LogoMark, MonoLogo } from './LogoMark';

interface Node { type: string; props: Record<string, unknown> }

/** Every element of a rendered tree, the root first. */
function elements(vnode: unknown): Node[] {
  const node = vnode as { type: string; props: { children?: unknown } };
  const children = node.props.children === undefined ? [] : [node.props.children].flat();
  return [{ type: node.type, props: node.props as Record<string, unknown> }, ...children.flatMap(elements)];
}

describe('the one-colour logo for print', () => {
  const tree = elements(MonoLogo({ size: 16 }));
  const root = tree[0];
  const drawn = tree.slice(1);

  it('is a square svg in the logo box, hidden from assistive technology: the text beside it names it', () => {
    expect(root.type).toBe('svg');
    expect(root.props).toMatchObject({ width: 16, height: 16, viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    expect(root.props.role).toBeUndefined();
    expect(root.props['aria-label']).toBeUndefined();
  });

  it('draws with strokes only: no fills, no gradients, no definitions, no clipping', () => {
    expect(tree.map((node) => node.type)).toEqual(['svg', 'rect', 'circle', 'path', 'path', 'path']);
    expect(root.props).toMatchObject({ fill: 'none', stroke: 'currentColor' });
    for (const node of drawn) {
      expect(node.props.fill).toBeUndefined();   // none of its own: the svg's `none` applies
      expect(node.props.stroke).toBeUndefined(); // one colour, set once on the svg
      expect(Number(node.props['stroke-width'])).toBeGreaterThan(0);
    }
    expect(JSON.stringify(tree)).not.toMatch(/url\(|Gradient|clip|defs|opacity/);
  });

  it('is the shape of the small mark: the M at its thick width on the waves (whose ends stop on the outline of the tile), the sun, and the horizon as a line', () => {
    const byType = (type: string) => drawn.filter((node) => node.type === type);
    expect(byType('circle')[0].props).toMatchObject({ cx: '50', cy: '20', r: '7.5' });
    const paths = byType('path').map((node) => ({ d: node.props.d, width: node.props['stroke-width'] }));
    expect(paths).toContainEqual({ d: 'M24 77 L24 32 L50 57 L76 32 L76 77', width: '12' });
    expect(paths).toContainEqual({ d: 'M2.6 78 Q13.8 72 25 78 T50 78 T75 78 T97.4 78', width: '3.5' });
    expect(paths.some(({ d }) => /^M\S+ 60 H\S+$/.test(String(d)))).toBe(true);
  });

  it('is what LogoMark gives for the mono mode, at the size asked for', () => {
    const vnode = LogoMark({ size: 16, mode: 'mono' }) as unknown as { type: unknown; props: { size: number } };
    expect(vnode.type).toBe(MonoLogo);
    expect(vnode.props.size).toBe(16);
  });
});
