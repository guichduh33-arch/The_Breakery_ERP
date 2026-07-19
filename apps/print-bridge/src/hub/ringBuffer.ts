// apps/print-bridge/src/hub/ringBuffer.ts
// Ring-buffer persistant du hub (spec 006x §4.2) : JSONL append-only sur
// disque, rechargé au boot, compacté quand le fichier dépasse 2× la capacité.
// JSONL plutôt que SQLite : pas de dépendance native à builder sur le PC
// boutique, et le débit du bus (quelques msg/s) ne justifie rien de plus.
// Écritures synchrones : un seul process, messages courts, pas de contention.

import fs from 'node:fs';
import path from 'node:path';
import { parseEnvelope, type HubEnvelope } from './envelope.js';

export interface HubBufferStats {
  count: number;
  oldest_ts: string | null;
  newest_ts: string | null;
}

export class HubRingBuffer {
  private readonly filePath: string;
  private readonly capacity: number;
  private entries: HubEnvelope[] = [];
  /** Lignes écrites dans le fichier depuis la dernière compaction. */
  private fileLines = 0;

  constructor(filePath: string, capacity = 500) {
    this.filePath = filePath;
    this.capacity = capacity;
    this.load();
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return; // pas encore de fichier — buffer vide
    }
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    this.fileLines = lines.length;
    const parsed: HubEnvelope[] = [];
    for (const line of lines) {
      try {
        const env = parseEnvelope(JSON.parse(line));
        if (env !== null) parsed.push(env);
      } catch {
        // ligne corrompue (coupure en pleine écriture) — ignorée
      }
    }
    this.entries = parsed.slice(-this.capacity);
  }

  append(env: HubEnvelope): void {
    this.entries.push(env);
    if (this.entries.length > this.capacity) this.entries.shift();
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(env)}\n`, 'utf8');
      this.fileLines += 1;
      if (this.fileLines > this.capacity * 2) this.compact();
    } catch {
      // disque indisponible : le buffer mémoire continue, la persistance
      // reprendra à la prochaine écriture qui réussit
    }
  }

  private compact(): void {
    const body = this.entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(this.filePath, body === '' ? '' : `${body}\n`, 'utf8');
    this.fileLines = this.entries.length;
  }

  /** Enveloppes strictement plus récentes que `sinceTs` (tout si omis). */
  since(sinceTs?: string): HubEnvelope[] {
    if (sinceTs === undefined) return [...this.entries];
    const cutoff = Date.parse(sinceTs);
    if (Number.isNaN(cutoff)) return [...this.entries];
    return this.entries.filter((e) => Date.parse(e.ts) > cutoff);
  }

  stats(): HubBufferStats {
    return {
      count: this.entries.length,
      oldest_ts: this.entries[0]?.ts ?? null,
      newest_ts: this.entries[this.entries.length - 1]?.ts ?? null,
    };
  }
}
