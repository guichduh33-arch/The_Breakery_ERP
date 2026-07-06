import { describe, it, expect, vi, beforeEach } from 'vitest';

const executed: string[] = [];
const instances: { iface: string; calls: string[] }[] = [];

vi.mock('node-thermal-printer', () => {
  class ThermalPrinter {
    calls: string[] = [];
    constructor(cfg: { interface: string }) {
      instances.push({ iface: cfg.interface, calls: this.calls });
    }
    println(t: string): void { this.calls.push(`println:${t}`); }
    alignCenter(): void { this.calls.push('alignCenter'); }
    alignLeft(): void { this.calls.push('alignLeft'); }
    bold(): void { this.calls.push('bold'); }
    setTextSize(): void { this.calls.push('setTextSize'); }
    setTextNormal(): void { this.calls.push('setTextNormal'); }
    newLine(): void { this.calls.push('newLine'); }
    drawLine(): void { this.calls.push('drawLine'); }
    leftRight(): void { this.calls.push('leftRight'); }
    cut(): void { this.calls.push('cut'); }
    openCashDrawer(): void { this.calls.push('openCashDrawer'); }
    execute(): Promise<void> {
      executed.push(instances[instances.length - 1]!.iface);
      return Promise.resolve();
    }
  }
  return { ThermalPrinter, PrinterTypes: { EPSON: 'epson' }, printer: ThermalPrinter };
});

import { sendToPrinter, kickDrawer } from '../transport.js';

beforeEach(() => { executed.length = 0; instances.length = 0; });

describe('sendToPrinter', () => {
  it('targets tcp://ip:port, runs the render, executes', async () => {
    await sendToPrinter({ ip_address: '192.168.1.60', port: 9100 }, (p) => p.println('hello'));
    expect(instances[0]!.iface).toBe('tcp://192.168.1.60:9100');
    expect(instances[0]!.calls).toContain('println:hello');
    expect(executed).toEqual(['tcp://192.168.1.60:9100']);
  });
});

describe('kickDrawer', () => {
  it('sends openCashDrawer then executes', async () => {
    await kickDrawer({ ip_address: '10.0.0.5', port: 9100 });
    expect(instances[0]!.calls).toContain('openCashDrawer');
    expect(executed).toHaveLength(1);
  });
});
