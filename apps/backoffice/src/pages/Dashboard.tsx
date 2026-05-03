// apps/backoffice/src/pages/Dashboard.tsx
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">Welcome back. KPIs and reports arrive in a future session.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {["Today's sales", 'Orders today', 'Active sessions'].map((label) => (
          <div key={label} className="bg-bg-elevated rounded-lg border border-border-subtle p-6">
            <div className="text-xs uppercase tracking-widest text-text-secondary">{label}</div>
            <div className="font-mono text-2xl mt-2 text-text-disabled">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}
