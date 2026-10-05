import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@breakery/ui';
import type { Employee } from '../model';
import { money } from '../model';
const sections: Record<string, [string, string][]> = {
  Pribadi: [['birthPlace', 'Tempat lahir'], ['birthDate', 'Tanggal lahir'], ['gender', 'Jenis kelamin'], ['maritalStatus', 'Status pernikahan'], ['children', 'Jumlah anak'], ['education', 'Pendidikan terakhir'], ['phone', 'Nomor telepon'], ['email', 'Email'], ['address', 'Alamat']],
  Pekerjaan: [['department', 'Departemen'], ['workLocation', 'Lokasi kerja'], ['manager', 'Atasan'], ['employmentStatus', 'Status karyawan'], ['contractType', 'Jenis kontrak'], ['hireDate', 'Tanggal mulai bekerja'], ['contractEnd', 'Akhir kontrak']],
  'Pajak & BPJS': [['ptkp', 'Status PTKP'], ['hasNpwp', 'Memiliki NPWP'], ['npwp', 'Nomor NPWP'], ['bpjsHealth', 'BPJS Kesehatan'], ['bpjsHealthNumber', 'Nomor BPJS Kesehatan'], ['bpjsEmploymentNumber', 'Nomor BPJS Ketenagakerjaan'], ['bpjsJht', 'JHT'], ['bpjsJp', 'JP'], ['bpjsJkkJkm', 'JKK / JKM']],
  'Kontak darurat': [['emergencyName', 'Nama kontak'], ['emergencyRelationship', 'Hubungan'], ['emergencyPhone', 'Nomor telepon']],
};
const translations: Record<string, string> = { Yes: 'Ya', No: 'Tidak', Active: 'Aktif', Resigned: 'Mengundurkan diri', Permanent: 'Tetap', Probation: 'Masa percobaan', Single: 'Belum menikah', Married: 'Menikah', Divorced: 'Cerai', Widowed: 'Janda / duda', Female: 'Perempuan', Male: 'Laki-laki', 'Prefer not to say': 'Tidak ingin menyebutkan', Other: 'Lainnya' };
export function StaffProfile({ employee }: { employee: Employee | undefined }) {
  const [tab, setTab] = useState('Pribadi');
  if (!employee) return <p>Profil belum tersedia. Hubungi HR.</p>;
  return <div className="hr-stack"><div><h2 className="text-xl font-semibold">{employee.name}</h2><p className="hr-muted">ID {employee.id} · Profil contoh</p></div>
    <div className="hr-tabs">{Object.keys(sections).map(section => <Button key={section} variant={section === tab ? 'ink' : 'secondary'} onClick={() => setTab(section)}>{section}</Button>)}</div>
    <section className="hr-card"><h3 className="text-xl font-semibold">{tab}</h3><dl className="hr-profile-fields">{sections[tab]!.map(([key, label]) => {
      const value = employee.details?.[key]; return <div key={key}><dt className="hr-muted">{label}</dt><dd>{value ? translations[value] ?? value : 'Belum diisi'}</dd></div>;
    })}</dl>{tab === 'Pekerjaan' && <p className="hr-data">Gaji pokok contoh · {money(employee.salary)}</p>}</section>
    <p className="hr-muted">Perubahan data pribadi diajukan kepada HR. Data ini hanya demonstrasi dan bukan catatan resmi.</p><Link to="/staff/documents">Lihat dokumen pribadi →</Link>
  </div>;
}
