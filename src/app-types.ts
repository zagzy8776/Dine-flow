export type View = 'customer' | 'kitchen' | 'floor' | 'admin'
export type OrderStatus = 'open_tab' | 'received' | 'preparing' | 'ready' | 'served' | 'cancelled'
export type StaffRole = 'owner' | 'admin' | 'kitchen' | 'waiter'
export type AppMode = 'demo' | 'api'
export type ServiceRequestType = 'waiter' | 'bill' | 'cash_payment'
export type ServiceRequestStatus = 'open' | 'acknowledged' | 'resolved'

export type MenuItem = {
  id: string
  name: string
  category: string
  price: number
  description: string
  available: boolean
  prepMinutes: number
  stockCount?: number
  lowStockThreshold?: number
}

export type EateryTable = {
  id: string
  label: string
  seats: number
  floorX?: number
  floorY?: number
}

export type OrderItem = {
  menuItemId: string
  name: string
  price: number
  quantity: number
  note?: string
}

export type Order = {
  id: string
  tableId: string
  tableLabel: string
  customerName: string
  items: OrderItem[]
  status: OrderStatus
  note?: string
  createdAt: string
  updatedAt: string
  receivedAt?: string
  preparingAt?: string
  readyAt?: string
  servedAt?: string
}

export type ServiceRequest = {
  id: string
  tableId: string
  tableLabel: string
  type: ServiceRequestType
  status: ServiceRequestStatus
  message: string
  createdAt: string
  updatedAt: string
}

export type SplitPayment = {
  id: string
  tableId: string
  payerName: string
  amount: number
  method: string
  itemKeys: string[]
  createdAt: string
}

export type Store = {
  menu: MenuItem[]
  tables: EateryTable[]
  orders: Order[]
  serviceRequests: ServiceRequest[]
  splitPayments: SplitPayment[]
}

export type CartLine = {
  menuItemId: string
  quantity: number
  note: string
}

export type Eatery = {
  id: string
  name: string
  slug: string
}

export type StaffProfile = {
  eateryId: string
  role: StaffRole
}

export type SessionUser = {
  email: string
}

export type BootstrapPayload = {
  eatery: Eatery
  session: SessionUser | null
  staffProfile: StaffProfile | null
  store: Store
}