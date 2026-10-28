export function bankDate(raw: unknown, style: 'iso' | 'dmy' | 'mdy', date1904 = false): string {
 let y: number, m: number, d: number;
 if (typeof raw === "number") {
  if(!Number.isFinite(raw)) throw new Error("Invalid Excel date.");
  const day=Math.floor(raw);
  if(date1904 ? day<0 : day<1 || day===60) throw new Error("Invalid Excel date.");
  const serialDays=date1904 ? day : day-(day>60?1:0);
  const base=date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,31);
  const value=new Date(base+serialDays*86400000);
  y=value.getUTCFullYear();m=value.getUTCMonth()+1;d=value.getUTCDate();
 } else if(typeof raw==="string") {
  const value=raw.trim();
  const iso=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(iso){y=Number(iso[1]);m=Number(iso[2]);d=Number(iso[3]);}
  else {
   const local=/^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})$/.exec(value);
   if(!local || style==="iso") throw new Error("Date does not match the selected format.");
   y=Number(local[4]);m=Number(style==="dmy"?local[3]:local[1]);d=Number(style==="dmy"?local[1]:local[3]);
  }
 } else throw new Error("A date is required.");
 if(!Number.isInteger(y)||y<1900||y>9999||!Number.isInteger(m)||!Number.isInteger(d)) throw new Error("Invalid date.");
 const value=new Date(Date.UTC(y,m-1,d));
 if(value.getUTCFullYear()!==y||value.getUTCMonth()+1!==m||value.getUTCDate()!==d)throw new Error("Invalid date.");
 return `${y.toString().padStart(4,"0")}-${m.toString().padStart(2,"0")}-${d.toString().padStart(2,"0")}`;
}
