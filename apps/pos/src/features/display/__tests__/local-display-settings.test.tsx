import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => {
  const connection: { connected: boolean; message: unknown } = { connected: true, message: null };
  return {
  connection,
  settings: { displayFooterMessage: '', showcaseProductIds: ['p1'], showReadyOrders: false },
  auth: { isAuthenticated: true, bootstrapStatus: 'ready', cloudValidated: true, isLocked: false },
  orders: vi.fn(), ready: vi.fn(), realtime: vi.fn(), showcase: vi.fn(),
  };
});
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: typeof mocks.auth) => boolean) => selector(mocks.auth) }));
vi.mock('../hooks/useCartBroadcastReceiver', () => ({ useLocalDisplayConnection: () => mocks.connection }));
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({ useOrgDisplaySettings: () => mocks.settings }));
vi.mock('../hooks/useDisplayOrders', () => ({ useDisplayOrders: mocks.orders }));
vi.mock('../hooks/useReadyOrders', () => ({ useReadyOrders: mocks.ready }));
vi.mock('../hooks/useDisplayRealtime', () => ({ useDisplayRealtime: mocks.realtime }));
vi.mock('../hooks/useShowcaseProducts', () => ({ useShowcaseProducts: mocks.showcase }));
vi.mock('../components/BrandedLayout', () => ({ BrandedLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../components/CDBrandPanel', () => ({ CDBrandPanel: () => <div>Brand</div> }));
vi.mock('../components/ShowcasePanel', () => ({ ShowcasePanel: () => <div>Showcase</div> }));
vi.mock('../components/CurrentOrderCard', () => ({ CurrentOrderCard: () => <div>Current order</div> }));
vi.mock('../components/OrderQueueTicker', () => ({ OrderQueueTicker: () => <div>Ready queue</div> }));
vi.mock('../components/CDPaymentPanel', () => ({ CDPaymentPanel: () => <div>Payment</div> }));
vi.mock('../CustomerDisplayView', () => ({ CustomerDisplayView: () => <div>Cart</div> }));
import { LocalCustomerDisplay } from '../LocalCustomerDisplay';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connection.connected = true;
  mocks.connection.message = null;
  mocks.settings.showReadyOrders = false;
  Object.assign(mocks.auth, { isAuthenticated: true, bootstrapStatus: 'ready', cloudValidated: true, isLocked: false });
  mocks.orders.mockReturnValue({ data: [{ id: 'cached-order' }] });
  mocks.ready.mockReturnValue({ data: [{ order_id: 'cached-ready' }] });
  mocks.showcase.mockReturnValue({ data: [{ id: 'p1' }] });
});
describe('écran local — réglage et session PIN', () => {
  it('montre la vitrine avec file éteinte et ne lit pas les commandes', () => {
    render(<LocalCustomerDisplay source="checkout" />);
    expect(screen.getByText('Showcase')).toBeInTheDocument();
    expect(screen.queryByText('Ready queue')).not.toBeInTheDocument();
    expect(mocks.orders).toHaveBeenCalledWith(false);
    expect(mocks.ready).toHaveBeenCalledWith(false);
    expect(mocks.realtime).toHaveBeenCalledWith('checkout', false);
  });
  it('rend la file quand le réglage est allumé', () => {
    mocks.settings.showReadyOrders = true;
    render(<LocalCustomerDisplay source="checkout" />);
    expect(screen.getByText('Ready queue')).toBeInTheDocument();
    expect(screen.queryByText('Showcase')).not.toBeInTheDocument();
    expect(mocks.orders).toHaveBeenCalledWith(true);
    expect(mocks.ready).toHaveBeenCalledWith(true);
  });
  it.each(['anonymous', 'locked', 'unvalidated', 'booting'])('cache la file et son cache avec session %s', (state) => {
    mocks.settings.showReadyOrders = true;
    if (state === 'anonymous') mocks.auth.isAuthenticated = false;
    if (state === 'locked') mocks.auth.isLocked = true;
    if (state === 'unvalidated') mocks.auth.cloudValidated = false;
    if (state === 'booting') mocks.auth.bootstrapStatus = 'loading';
    render(<LocalCustomerDisplay source="checkout" />);
    expect(screen.queryByText('Ready queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Showcase')).not.toBeInTheDocument();
    expect(mocks.orders).toHaveBeenCalledWith(false);
    expect(mocks.ready).toHaveBeenCalledWith(false);
    expect(mocks.realtime).toHaveBeenCalledWith('checkout', false);
  });
  it.each(['cart_update', 'payment_complete'])('donne priorité à %s sur la file', (type) => {
    mocks.settings.showReadyOrders = true;
    mocks.connection.message = type === 'payment_complete' ? { type } : {
      type, totals: {}, cart: { items: [{ id: 'line', product_id: 'p1', quantity: 1, unit_price: 10, modifiers: [] }] },
    };
    render(<LocalCustomerDisplay source="checkout" />);
    expect(screen.getByText(type === 'payment_complete' ? 'Payment' : 'Cart')).toBeInTheDocument();
    expect(screen.queryByText('Ready queue')).not.toBeInTheDocument();
  });
});
