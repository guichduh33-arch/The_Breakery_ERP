import { Tabs, TabsContent, TabsList, TabsTrigger } from '@breakery/ui';

// Canonical order-type tabs — active trigger gets the gold-soft chip look.
export const OrderTypes = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96">
    <Tabs defaultValue="dine-in">
      <TabsList>
        <TabsTrigger value="dine-in">Dine-in</TabsTrigger>
        <TabsTrigger value="take-out">Take-out</TabsTrigger>
        <TabsTrigger value="delivery">Delivery</TabsTrigger>
      </TabsList>
      <TabsContent value="dine-in">
        <div className="rounded-md border border-border-subtle p-4">
          <p className="text-sm font-medium text-text-primary">Table 4 — Pak Budi</p>
          <p className="mt-1 text-xs text-text-secondary">
            2 guests · opened 09:12 · server Ayu
          </p>
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-text-secondary">2× Croissant au beurre</span>
            <span className="font-mono text-text-primary">Rp 56.000</span>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="take-out">
        <div className="rounded-md border border-border-subtle p-4 text-sm text-text-secondary">
          Boxed orders ready at the counter.
        </div>
      </TabsContent>
      <TabsContent value="delivery">
        <div className="rounded-md border border-border-subtle p-4 text-sm text-text-secondary">
          GoFood / GrabFood queue.
        </div>
      </TabsContent>
    </Tabs>
  </div>
);

// Second tab active + a disabled trigger.
export const WithDisabledTab = () => (
  <div className="bg-bg-base p-6 rounded-lg w-96">
    <Tabs defaultValue="today">
      <TabsList>
        <TabsTrigger value="today">Today</TabsTrigger>
        <TabsTrigger value="week">This week</TabsTrigger>
        <TabsTrigger value="month" disabled>
          Month
        </TabsTrigger>
      </TabsList>
      <TabsContent value="today">
        <div className="flex items-baseline justify-between rounded-md border border-border-subtle p-4">
          <span className="text-sm text-text-secondary">Sales — 42 orders</span>
          <span className="font-mono text-lg text-text-primary">Rp 3.860.000</span>
        </div>
      </TabsContent>
    </Tabs>
  </div>
);
