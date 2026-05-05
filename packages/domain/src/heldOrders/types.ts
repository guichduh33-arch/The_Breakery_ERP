import type { CartItem } from '../types/cart.js';

export interface HeldOrder {
  id: string;
  heldAt: string;
  cart: {
    items: CartItem[];
    customerId: string | null;
    loyaltyPointsToRedeem: number;
    orderType: 'dine_in' | 'take_out';
    tableNumber: string | null;
  };
  notes?: string;
}
