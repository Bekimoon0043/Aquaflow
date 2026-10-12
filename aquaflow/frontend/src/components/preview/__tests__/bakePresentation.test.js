import { describe, it, expect, vi } from 'vitest';
import { FountainScene } from '../FountainScene_v6';
import { planBake } from '../../../video/bakedTimeline';

function harness() {
  const scene = Object.create(FountainScene.prototype);
  Object.assign(scene, {
    _initialized:true, canvas:{clientWidth:800,clientHeight:600}, _pr:1.5,
    clock:{elapsedTime:0,getDelta:vi.fn()},
    renderer:{setPixelRatio:vi.fn(),info:{autoReset:false,reset:vi.fn()}},
    composer:{setPixelRatio:vi.fn()},
    _reviewGroup:{visible:true}, _editor:{root:{visible:false}},
    _gradePass:{uniforms:{uGrain:{value:0.02}}}, _reflection:{interval:2},
    resize:vi.fn(), _update:vi.fn(), _updateCamera:vi.fn(), setSignals:vi.fn(), _renderFrame:vi.fn(),
  });
  return scene;
}
describe('clean presentation bake', () => {
  it('renders without guides or grain, then restores the live preview', async () => {
    const scene=harness();
    const encoder={addFrame:vi.fn(async()=>{
      expect(scene._reviewGroup.visible).toBe(false);
      expect(scene._gradePass.uniforms.uGrain.value).toBe(0);
      expect(scene._reflection.interval).toBe(1);
    })};
    await scene.bakeVideo({plan:planBake({durationS:1/30,fps:30,prerollS:0}),encoder});
    expect(encoder.addFrame).toHaveBeenCalledTimes(1);
    expect(scene._reviewGroup.visible).toBe(true);
    expect(scene._editor.root.visible).toBe(false);
    expect(scene._gradePass.uniforms.uGrain.value).toBe(0.02);
    expect(scene._reflection.interval).toBe(2);
    expect(scene.resize).toHaveBeenLastCalledWith(800,600);
    expect(scene._pr).toBe(1.5);
  });
  it('restores settings even when encoding fails', async () => {
    const scene=harness();
    await expect(scene.bakeVideo({plan:planBake({durationS:1/30,fps:30,prerollS:0}),encoder:{addFrame:async()=>{throw new Error('encoder failed');}}})).rejects.toThrow('encoder failed');
    expect(scene._baking).toBe(false);
    expect(scene._reviewGroup.visible).toBe(true);
    expect(scene._reflection.interval).toBe(2);
  });
});
