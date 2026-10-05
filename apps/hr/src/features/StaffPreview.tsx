import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input, Select } from '@breakery/ui';
import { money } from '../model';
import { StatusTag } from './PageElements';
import { canAcceptDemoPunch, staffExampleSlip as slip } from './staffVerification';
const tabs = ['Beranda', 'Absensi', 'Jadwal', 'Permintaan', 'Akun'];
const steps = ['Masuk', 'Mulai istirahat', 'Selesai istirahat', 'Pulang'];
const history = [
 {date:'04 Okt',shift:'Libur',time:'—',status:'Hari libur'},
 {date:'03 Okt',shift:'06:30–14:30',time:'06:28 / 14:32',status:'Lengkap'},
 {date:'02 Okt',shift:'06:30–14:30',time:'06:36 / 14:31',status:'Terlambat 6 menit'},
 {date:'01 Okt',shift:'06:30–14:30',time:'06:29 / —',status:'Perlu koreksi'},
];
export function StaffPreview() {
 const [tab,setTab]=useState('Beranda'); const [step,setStep]=useState(0);
 const [checks,setChecks]=useState({face:true,gps:true,network:true,online:true});
 const [feedback,setFeedback]=useState(''); const [attempt,setAttempt]=useState(false);
 const [events,setEvents]=useState<string[]>([]); const [read,setRead]=useState(false);
 const [requests,setRequests]=useState([{type:'Cuti',date:'2026-10-08',reason:'Acara keluarga',status:'Menunggu persetujuan'}, {type:'Koreksi absensi',date:'2026-10-01',reason:'Lupa absen pulang',status:'Disetujui · contoh'}]);
 const switchTab=(next:string)=>{setTab(next);setFeedback('');window.scrollTo({top:0,behavior:'auto'});};
 const punch=()=>{if (!canAcceptDemoPunch(checks)) {setAttempt(true);setFeedback('Belum diterima. Periksa wajah, lokasi, jaringan bakery dan koneksi. Anda dapat mengajukan koreksi ke HR.');return;} setEvents([...events,steps[step]+' · 05 Okt 2026 · '+['06:28','10:30','11:30','14:30'][step]+' WITA']);setStep(step+1);setAttempt(false);setFeedback('Absensi contoh diterima. Tiga pemeriksaan berhasil dalam simulasi.');};
 return <div className="hr-staff-preview hr-stack">
  <header className="hr-phone-header"><div><h1>Breakery Staff</h1><p>Dewi Lestari · Cashier</p></div><span className="hr-phone-avatar" aria-label="Profil Dewi Lestari">DL</span></header><details className="hr-phone-demo"><summary>Mode demo · data fiktif</summary><p>Kamera, GPS dan IP tidak diakses. Semua verifikasi disimulasikan. Data hilang saat dimuat ulang.</p></details>
  <div role="status" aria-live="polite">{feedback}</div>
  {tab==='Beranda' && <>
   <section className="hr-card hr-stack hr-phone-shift"><h2>Selamat pagi, Dewi</h2><p>Senin, 05 Oktober 2026 · WITA</p><div><StatusTag tone={step ? 'success':'warning'}>{step===0?'Belum masuk':step===2?'Sedang istirahat':step===4?'Sudah pulang':'Sedang bekerja'}</StatusTag></div><h3 className="text-xl font-semibold">Shift hari ini</h3><p className="hr-data hr-phone-hours">06:30–14:30</p><p>Morning · The Breakery · Istirahat 10:30–11:30</p><Button className="hr-phone-primary" variant="ink" onClick={()=>switchTab('Absensi')}>Buka absensi</Button></section>
   <section className="hr-card"><h2>Yang perlu Anda lihat</h2><div className="hr-agenda-row"><strong>Koreksi 01 Oktober disetujui</strong><p>Keputusan HR contoh. Periksa riwayat Anda.</p><Button variant="secondary" onClick={()=>switchTab('Permintaan')}>Lihat permintaan</Button></div><div className="hr-agenda-row"><strong>Slip gaji September tersedia</strong><p>Take home pay contoh: {money(slip.net)}</p><Button variant="secondary" onClick={()=>switchTab('Akun')}>Lihat slip gaji</Button></div></section>
   <section className="hr-card"><h2>Pengumuman</h2><strong>Jadwal minggu ini sudah tersedia</strong><p>Silakan periksa shift dan waktu istirahat. Pengumuman demonstrasi.</p><Button variant="secondary" disabled={read} onClick={()=>setRead(true)}>{read?'Sudah dibaca':'Tandai sudah dibaca'}</Button></section>
  </>}
  {tab==='Absensi' && <>
   <section className="hr-card hr-stack"><h2>Absensi hari ini</h2><p>05 Okt 2026 · Shift 06:30–14:30 · Jam contoh, bukan waktu server.</p><dl className="hr-definition-rows"><div><dt>Wajah</dt><dd><StatusTag tone={checks.face?'success':'danger'}>{checks.face?'Cocok · liveness simulasi':'Verifikasi gagal · simulasi'}</StatusTag></dd></div><div><dt>Lokasi GPS</dt><dd><StatusTag tone={checks.gps?'success':'danger'}>{checks.gps?'Di area bakery · simulasi':'Di luar area · simulasi'}</StatusTag></dd></div><div><dt>Jaringan</dt><dd><StatusTag tone={checks.network?'success':'danger'}>{checks.network?'IP bakery diizinkan · simulasi':'IP tidak diizinkan · simulasi'}</StatusTag></dd></div></dl>
    <div className="hr-stack">{steps.map((label,index)=><Button key={label} variant={index===step?'ink':'secondary'} disabled={index!==step} onClick={punch}>{index<step?'Tercatat: ':''}{label}</Button>)}</div>
    {attempt && <p role="alert">Percobaan belum valid. Tidak dihitung sebagai kehadiran atau ketidakhadiran otomatis.</p>}
    <details><summary>Kontrol skenario demo</summary><div className="hr-stack">{[['face','Wajah cocok'],['gps','Berada di bakery'],['network','IP bakery'],['online','Server dapat dihubungi']].map(([key,label])=><label key={key}><input type="checkbox" checked={checks[key as keyof typeof checks]} onChange={event=>setChecks({...checks,[key!]:event.target.checked})}/> {label}</label>)}</div><p>Hanya tombol simulasi. Produksi memerlukan pemeriksaan server dan penyedia biometrik yang disetujui.</p></details>
   </section>
   <section className="hr-card"><h2>Riwayat absensi</h2>{events.map(event=><p key={event} className="hr-agenda-row hr-data">{event} · Diterima dalam demo</p>)}{history.map(row=><div className="hr-agenda-row" key={row.date}><strong>{row.date} 2026 · {row.status}</strong><p>Jadwal: {row.shift} · Aktual: {row.time}</p>{row.status==='Perlu koreksi' && <Button variant="secondary" onClick={()=>switchTab('Permintaan')}>Ajukan koreksi</Button>}</div>)}</section>
  </>}
  {tab==='Jadwal' && <section className="hr-card"><h2>Jadwal saya</h2><p>05–11 Oktober 2026 · Jadwal diterbitkan dalam contoh ini.</p>{['Senin 05','Selasa 06','Rabu 07','Kamis 08','Jumat 09','Sabtu 10','Minggu 11'].map((day,index)=><div className="hr-agenda-row" key={day}><strong>{day}</strong><p className="hr-data">{index===6?'Libur':'06:30–14:30'}</p><p>{index===6?'Hari istirahat':'Morning · Istirahat 10:30–11:30'}</p>{index===3 && <StatusTag tone="warning">Cuti diminta · belum disetujui</StatusTag>}</div>)}<Button variant="secondary" onClick={()=>switchTab('Permintaan')}>Ajukan perubahan shift</Button><p className="hr-muted">Libur berikutnya: Minggu, 11 Oktober.</p></section>}
  {tab==='Permintaan' && <>
   <section className="hr-card"><h2>Permintaan saya</h2>{requests.map((row,index)=><div className="hr-agenda-row" key={index}><strong>{row.type} · {row.date}</strong><p>{row.reason}</p><StatusTag tone={row.status.startsWith('Disetujui')?'success':row.status==='Dibatalkan'?'neutral':'warning'}>{row.status}</StatusTag>{row.status==='Menunggu persetujuan' && <Button variant="secondary" onClick={()=>setRequests(requests.map((r,i)=>i===index?{...r,status:'Dibatalkan'}:r))}>Batalkan permintaan</Button>}</div>)}</section>
   <form className="hr-card hr-form" onSubmit={event=>{event.preventDefault();const data=new FormData(event.currentTarget);const field=(key:string)=>{const value=data.get(key);return typeof value==='string'?value:'';};setRequests([...requests,{type:field('type'),date:field('date'),reason:field('reason'),status:'Menunggu persetujuan'}]);event.currentTarget.reset();setFeedback('Permintaan contoh dibuat. Tidak dikirim ke HR nyata.');}}><h2>Ajukan permintaan</h2><label>Jenis<Select name="type">{['Cuti','Izin','Sakit','Koreksi absensi','Lembur','Perubahan shift','Kasbon','Reimbursement','Penjelasan slip gaji'].map(type=><option key={type}>{type}</option>)}</Select></label><label>Tanggal<Input name="date" type="date" required defaultValue="2026-10-08"/></label><label>Alasan<Input name="reason" required maxLength={500}/></label><p className="hr-muted">Pratinjau permintaan umum. Lampiran, jumlah kasbon dan jam lembur tersedia melalui formulir detail.</p><Button variant="ink">Simpan permintaan contoh</Button><Link to="/staff/requests">Buka formulir detail →</Link></form>
  </>}
  {tab==='Akun' && <>
   <section className="hr-card"><h2>Slip gaji September 2026</h2><StatusTag tone="success">Contoh diterbitkan · bukan pembayaran nyata</StatusTag><h3 className="hr-section-title">PENDAPATAN</h3>{[['Gaji pokok',slip.base],['Uang makan',slip.meal],['Bonus',slip.bonus]].map(([label,amount])=><div className="hr-toolbar hr-agenda-row" key={label}><span>{label}</span><span className="hr-data">{money(amount!)}</span></div>)}<h3 className="hr-section-title">POTONGAN</h3><div className="hr-toolbar hr-agenda-row"><span>Kasbon</span><span className="hr-data">{money(slip.deduction)}</span></div><h3 className="hr-section-title">TAKE HOME PAY · CONTOH</h3><p className="hr-data text-2xl">{money(slip.net)}</p><p className="hr-muted">Jumlah contoh. BPJS, pajak dan batas potongan belum dihitung.</p><Button variant="secondary" onClick={()=>switchTab('Permintaan')}>Minta penjelasan</Button></section>
   <section className="hr-card"><h2>THR</h2><p>Belum ada kampanye yang diterbitkan. Tidak ada hak atau pembayaran yang dihitung dalam demo.</p></section>
   <section className="hr-card"><h2>Cuti dan dokumen</h2><p>Saldo cuti contoh: 12 hari · bukan hak resmi.</p><div className="hr-stack"><Link to="/staff/leave">Lihat saldo cuti →</Link><Link to="/staff/profile">Profil dan data pribadi →</Link><Link to="/staff/documents">Dokumen saya →</Link><Link to="/staff/announcements">Semua pengumuman →</Link><Link to="/staff/calendar">Kalender →</Link></div></section>
  </>}
  <nav className="hr-preview-bottom" aria-label="Menu utama staf">{tabs.map(item=><Button key={item} variant={tab===item?'ink':'secondary'} aria-current={tab===item?'page':undefined} onClick={()=>switchTab(item)}><svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={navPaths[item]} /></svg><span>{item}</span></Button>)}</nav>
 </div>;
}

const navPaths: Record<string,string> = { Beranda: 'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7', Absensi: 'M8 3H4v4M16 3h4v4M4 17v4h4M20 17v4h-4M8 12l3 3 5-6', Jadwal: 'M4 5h16v16H4zM8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 18h2', Permintaan: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5', Akun: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2' };
