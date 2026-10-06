export interface OrderItem {
  id: string;
  lazadaOrderItemId: string;
  productName: string;
  variation: string;
  sku: string;
  itemPrice: string;
  currency: string;
  sourceStatus: string;
  digitalDetail: string | null;
  extraAttributes?: string;
}

export interface Order {
  id: string;
  marketplaceOrderId: string;
  productName: string;
  status: 'pending' | 'processing' | 'completed' | 'cancelled';
  paymentStatus: 'unpaid' | 'pending' | 'confirmed' | 'cancelled' | 'unknown';
  lazadaStatuses?: string | string[] | null;
  amount: number | null;
  sourcePrice: string | null;
  currency: string | null;
  createdAt: string;
  sourceCreatedAt: string | null;
  syncedAt: string | null;
  items: OrderItem[];
}

export const orders: Order[] = [
  {
    id: 'order-1001', marketplaceOrderId: '2787170078500594',
    productName: 'Gopay Saldo Top Up oleh Zetas.id', status: 'cancelled', paymentStatus: 'cancelled',
    amount: 60000, sourcePrice: '60000', currency: 'IDR', createdAt: '2026-10-02T13:23:00+07:00',
    sourceCreatedAt: '2026-10-02T13:23:00+07:00', syncedAt: '2026-10-02T13:30:00+07:00',
    items: [{ id: 'item-1001', lazadaOrderItemId: '2787170078500594', productName: 'Gopay Saldo Top Up oleh Zetas.id', variation: 'Saldo Rp60.000', sku: 'GOPAY-60', itemPrice: '60000', currency: 'IDR', sourceStatus: 'cancelled', digitalDetail: null }],
  },
  {
    id: 'order-1002', marketplaceOrderId: '2703386932919466',
    productName: 'PULSA REGULER SEMUA OPERATOR', status: 'pending', paymentStatus: 'confirmed',
    amount: 57000, sourcePrice: '57000', currency: 'IDR', createdAt: '2026-10-02T11:29:00+07:00',
    sourceCreatedAt: '2026-10-02T11:29:00+07:00', syncedAt: '2026-10-02T11:35:00+07:00',
    items: [{ id: 'item-1002', lazadaOrderItemId: '2703386932919466', productName: 'PULSA REGULER SEMUA OPERATOR', variation: 'Pulsa Rp50.000', sku: 'PULSA-50', itemPrice: '57000', currency: 'IDR', sourceStatus: 'pending', digitalDetail: '{"phone":"08XXXXXXXXXX","operator":"Tidak tersedia","nominal":"Rp50.000"}' }],
  },
  {
    id: 'order-1003', marketplaceOrderId: '2703263099525172',
    productName: 'Top Up Diamond Mobile Legends', status: 'processing', paymentStatus: 'pending',
    amount: 85000, sourcePrice: '85000', currency: 'IDR', createdAt: '2026-10-02T03:34:00+07:00',
    sourceCreatedAt: '2026-10-02T03:34:00+07:00', syncedAt: '2026-10-02T03:39:00+07:00',
    items: [{ id: 'item-1003', lazadaOrderItemId: '2703263099525172', productName: 'Top Up Diamond Mobile Legends', variation: 'Weekly Diamond Pass', sku: 'MLBB-WDP', itemPrice: '85000', currency: 'IDR', sourceStatus: 'processing', digitalDetail: '{"userId":"123456789","serverId":"1234"}' }],
  },
  {
    id: 'order-1004', marketplaceOrderId: '2703264306652172',
    productName: 'Top Up Diamond Mobile Legends', status: 'completed', paymentStatus: 'confirmed',
    amount: 100000, sourcePrice: '100000', currency: 'IDR', createdAt: '2026-10-01T15:33:00+07:00',
    sourceCreatedAt: '2026-10-01T15:33:00+07:00', syncedAt: '2026-10-01T15:40:00+07:00',
    items: [{ id: 'item-1004', lazadaOrderItemId: '2703264306652172', productName: 'Top Up Diamond Mobile Legends', variation: 'Twilight Pass', sku: 'MLBB-TP', itemPrice: '100000', currency: 'IDR', sourceStatus: 'completed', digitalDetail: '{"userId":"123456789","serverId":"1234"}' }],
  },
  {
    id: 'order-1005', marketplaceOrderId: '2703264306652190',
    productName: 'Voucher Game Digital', status: 'pending', paymentStatus: 'unpaid',
    amount: 25000, sourcePrice: '25000', currency: 'IDR', createdAt: '2026-09-30T12:11:00+07:00',
    sourceCreatedAt: '2026-09-30T12:11:00+07:00', syncedAt: '2026-09-30T12:15:00+07:00',
    items: [{ id: 'item-1005', lazadaOrderItemId: '2703264306652190', productName: 'Voucher Game Digital', variation: 'Voucher Rp25.000', sku: 'VOUCHER-25', itemPrice: '25000', currency: 'IDR', sourceStatus: 'pending', digitalDetail: '{"code":"ABCD-EFGH-IJKL"}' }],
  },
];

export const summary = {
  totalOrders: 28,
  pendingOrders: 7,
  processingOrders: 4,
  completedOrders: 12,
  cancelledOrders: 5,
  totalRevenue: 1847500,
  recentOrders: orders.slice(0, 3),
};
