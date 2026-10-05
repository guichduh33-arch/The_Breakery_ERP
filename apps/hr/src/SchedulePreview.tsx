import { Button } from '@breakery/ui';
interface Props {
  staff: boolean;
  published: boolean;
  setPublished: (value: boolean) => void;
}
export function SchedulePreview({ staff, published, setPublished }: Props) {
  return (
    <div className="hr-stack">
      <p>{staff ? 'Jadwal contoh · 5–11 Oktober 2026' : 'Sample week · 5–11 October 2026'}</p>
      {!staff && (
        <Button variant="ink" onClick={() => setPublished(!published)}>
          {published ? 'Unpublish demo schedule' : 'Publish demo schedule'}
        </Button>
      )}
      <p>
        {published
          ? staff
            ? 'Jadwal dipublikasikan'
            : 'Published'
          : staff
            ? 'Contoh jadwal — belum dipublikasikan'
            : 'Draft schedule'}
      </p>
      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => (
        <div className="hr-card flex justify-between gap-3" key={day}>
          <span>{staff ? ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][i] : day}</span>
          <span className="hr-data">06:30–14:30</span>
        </div>
      ))}
      <div className="hr-card">{staff ? 'Minggu · Libur' : 'Sunday · Day off'}</div>
    </div>
  );
}
