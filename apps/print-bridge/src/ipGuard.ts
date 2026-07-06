// Anti-SSRF (spec D7) : le scan et les probes n'acceptent QUE des cibles LAN privées.

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PREFIX_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateIpv4(ip: string): boolean {
  const m = IPV4_RE.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if (a > 255 || b > 255 || c > 255 || d > 255) return false;
  return isPrivateOctets(a, b);
}

export function isPrivatePrefix(prefix: string): boolean {
  const m = PREFIX_RE.exec(prefix);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number) as [number, number, number];
  if (a > 255 || b > 255 || c > 255) return false;
  return isPrivateOctets(a, b);
}

function isPrivateOctets(a: number, b: number): boolean {
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
