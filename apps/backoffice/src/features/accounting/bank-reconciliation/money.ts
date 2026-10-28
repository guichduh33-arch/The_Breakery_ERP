export function decimalCents(value: unknown): bigint {
 let source: string;
 if (typeof value === "number") {
  if (!Number.isFinite(value) || Math.abs(value) > 999999999999.99 || Number(value.toFixed(2)) !== value) throw new Error("Use an amount with at most two decimal places.");
  source = value.toFixed(2);
 } else if (typeof value === "string") source = value.trim();
 else throw new Error("An amount is required.");
 if (!/^[+-]?\d+(?:\.\d{1,2})?$/.test(source)) throw new Error("Use an amount with at most two decimal places.");
 const negative = source.startsWith("-");
 const unsigned = source.replace(/^[+-]/, "");
 const [whole, fraction = ""] = unsigned.split(".");
 const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2,"0"));
 if (amount > 99999999999999n) throw new Error("Amount exceeds the supported limit.");
 return negative ? -amount : amount;
}

export function decimalText(cents: bigint): string {
 const magnitude = cents < 0n ? -cents : cents;
 return `${cents < 0n ? "-" : ""}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2,"0")}`;
}

export function localizedBankAmount(value: unknown, format: 'dot' | 'comma'): string {
 if (typeof value === "number") return decimalText(decimalCents(value));
 if (typeof value !== "string") throw new Error("An amount is required.");
 let source=value.trim().replace(/^(?:IDR|Rp)\s*/i,"").trim();
 let negative=false;
 if (/^\(.*\)$/.test(source)) { negative=true; source=source.slice(1,-1).trim(); }
 if (source.startsWith("-")) { if(negative) throw new Error("Invalid amount sign."); negative=true;source=source.slice(1); }
 else if (source.startsWith("+")) source=source.slice(1);
 const pattern=format==="comma" ? /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/ : /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
 if(!pattern.test(source)) throw new Error("Amount does not match the selected number format.");
 source=format==="comma" ? source.replaceAll(".","").replace(",",".") : source.replaceAll(",","");
 return decimalText(decimalCents((negative?"-":"")+source));
}

export function bankMoney(value: unknown): string {
 if (value === null || value === undefined) return 'Unavailable';
 const cents = decimalCents(value);
 const magnitude = cents < 0n ? -cents : cents;
 return `${cents < 0n ? '−' : ''}Rp ${(magnitude / 100n).toLocaleString('en-US')}.${(magnitude % 100n).toString().padStart(2, '0')}`;
}
