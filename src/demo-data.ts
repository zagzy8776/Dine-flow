import type { EateryTable, Store, View } from './app-types'

export const STORAGE_KEY = 'dineflow-store'

export const emptyStore: Store = {
  menu: [],
  tables: [],
  orders: [],
}

export const initialStore: Store = {
  menu: [
    {
      id: 'jollof-rice',
      name: 'Smoky Jollof Rice',
      category: 'Rice Meals',
      price: 3500,
      description: 'Party-style jollof served with plantain and coleslaw.',
      available: true,
      prepMinutes: 18,
    },
    {
      id: 'fried-rice-chicken',
      name: 'Fried Rice & Chicken',
      category: 'Rice Meals',
      price: 4200,
      description: 'Vegetable fried rice with spicy grilled chicken.',
      available: true,
      prepMinutes: 20,
    },
    {
      id: 'amala-ewedu',
      name: 'Amala, Ewedu & Gbegiri',
      category: 'Swallow',
      price: 3000,
      description: 'Soft amala with assorted meat and rich Yoruba soup mix.',
      available: true,
      prepMinutes: 12,
    },
    {
      id: 'pepper-soup',
      name: 'Catfish Pepper Soup',
      category: 'Soups',
      price: 5200,
      description: 'Fresh catfish in hot pepper soup spices.',
      available: true,
      prepMinutes: 25,
    },
    {
      id: 'shawarma',
      name: 'Chicken Shawarma',
      category: 'Quick Bites',
      price: 2800,
      description: 'Loaded wrap with chicken, sausage and creamy sauce.',
      available: true,
      prepMinutes: 10,
    },
    {
      id: 'zobo',
      name: 'Chilled Zobo',
      category: 'Drinks',
      price: 900,
      description: 'Cold hibiscus drink with ginger and pineapple.',
      available: true,
      prepMinutes: 2,
    },
  ],
  tables: [
    { id: 'table-1', label: 'Table 1', seats: 2 },
    { id: 'table-2', label: 'Table 2', seats: 4 },
    { id: 'table-3', label: 'Table 3', seats: 4 },
    { id: 'vip-1', label: 'VIP 1', seats: 6 },
    { id: 'pickup-counter', label: 'Pickup Counter', seats: 1 },
    { id: 'delivery-dispatch', label: 'Delivery Dispatch', seats: 1 },
  ],
  orders: [
    {
      id: 'ORD-1001',
      tableId: 'table-2',
      tableLabel: 'Table 2',
      customerName: 'Demo Customer',
      items: [
        { menuItemId: 'jollof-rice', name: 'Smoky Jollof Rice', price: 3500, quantity: 2 },
        { menuItemId: 'zobo', name: 'Chilled Zobo', price: 900, quantity: 2 },
      ],
      status: 'preparing',
      note: 'Less pepper on one plate.',
      createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
      updatedAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    },
  ],
}

export function loadDemoStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialStore

    const parsed = JSON.parse(raw) as Partial<Store>
    if (!parsed || !Array.isArray(parsed.menu) || !Array.isArray(parsed.tables) || !Array.isArray(parsed.orders)) {
      return initialStore
    }

    return parsed as Store
  } catch {
    return initialStore
  }
}

export function getInitialView(): View {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (normalizedPath === '/kitchen') return 'kitchen'
  if (normalizedPath === '/admin') return 'admin'

  const queryValue = new URLSearchParams(window.location.search).get('view')
  if (queryValue === 'customer' || queryValue === 'kitchen' || queryValue === 'admin') {
    return queryValue
  }

  return 'customer'
}

export function getInitialTableId(tables: EateryTable[]) {
  const queryValue = new URLSearchParams(window.location.search).get('table')
  if (queryValue && tables.some((table) => table.id === queryValue)) return queryValue
  return tables[0]?.id ?? ''
}