import { expect, it } from 'vitest';
import { canAcceptDemoPunch } from '../features/staffVerification';
it('requires face, location, bakery network and server availability together', () => {
 const ready={face:true,gps:true,network:true,online:true}; expect(canAcceptDemoPunch(ready)).toBe(true);
 for(const key of ['face','gps','network','online']) expect(canAcceptDemoPunch({...ready,[key]:false})).toBe(false);
});
