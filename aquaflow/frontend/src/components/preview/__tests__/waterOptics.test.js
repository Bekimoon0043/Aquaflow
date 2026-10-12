import { describe, it, expect } from 'vitest';
import { emitterOpacityScale } from '../waterOptics';
describe('GPU water optical density', () => {
  it('does not turn a lone spray head into a solid white cloud', () => {
    const spray={weight:65,life:1.2};
    expect(emitterOpacityScale(spray,131072)).toBeLessThan(0.003);
  });
  it('keeps optical coverage constant when quality doubles the particle pool', () => {
    const jet={weight:280,life:2};
    expect(4096*emitterOpacityScale(jet,4096)).toBeCloseTo(8192*emitterOpacityScale(jet,8192));
  });
  it('never amplifies sparse particles or empty layouts', () => {
    expect(emitterOpacityScale({weight:280,life:2},100)).toBe(1);
    expect(emitterOpacityScale({weight:280,life:2},0)).toBe(0);
  });
});
