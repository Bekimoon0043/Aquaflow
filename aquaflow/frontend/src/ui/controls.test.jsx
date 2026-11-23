import {describe,it,expect} from 'vitest';
import {scrubValue} from './index';
describe('engineering numeric scrubbing',()=>{it('supports fine/coarse steps and clamps',()=>{expect(scrubValue(5,10,{step:.1,shift:true})).toBe(5.1);expect(scrubValue(5,10,{step:.1,ctrl:true,max:10})).toBe(10);expect(scrubValue(5,-100,{min:0})).toBe(0);});});
