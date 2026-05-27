export type View = 'customer' | 'kitchen' | 'admin'
export type OrderStatus = 'received' | 'preparing' | 'ready' | 'served' | 'cancelled'
export type StaffRole = 'owner' | 'admin' | 'kitchen' | 'waiter'
export type AppMode = 'demo' | 'api'

export type MenuItem = {
  id: string
  name: string
  category: string
  price: number
  description: string
  available: boolean
  prepMinutes: number
}

export type EateryTable = {
  id: string
  label: string
  seats: number
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
}

export type Store = {
  menu: MenuItem[]
  tables: EateryTable[]
  orders: Order[]
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