import type { ReactNode } from 'react';
export function SummaryStrip({ items }: { items: { label: string; value: string | number; tone?: string }[] }) {
  return <dl className="hr-summary-strip">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd className={'hr-data hr-summary-value hr-tone-' + (item.tone ?? 'neutral')}>{item.value}</dd></div>)}</dl>;
}
export function PageIntro({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="hr-toolbar"><div><h2 className="text-xl font-semibold">{title}</h2><p className="hr-muted hr-measure">{children}</p></div>{action}</div>;
}
export function StatusTag({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  return <span className={'hr-status-label hr-tone-' + tone}>{children}</span>;
}
