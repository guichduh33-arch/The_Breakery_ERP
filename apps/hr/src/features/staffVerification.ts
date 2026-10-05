export interface DemoChecks { face: boolean; gps: boolean; network: boolean; online: boolean }
export function canAcceptDemoPunch(checks: DemoChecks): boolean { return checks.face && checks.gps && checks.network && checks.online; }
export const staffExampleSlip = { base: '3500000', meal: '390000', bonus: '200000', deduction: '150000', net: '3940000' };
