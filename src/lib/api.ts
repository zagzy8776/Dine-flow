import type { BootstrapPayload, Order, OrderStatus, ServiceRequestType } from '../app-types'

export const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL ?? '').trim()

type RequestOptions = {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const base = API_BASE_URL.replace(/\/$/, '')
  const url = new URL(`${base}${path}`)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

async function requestJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : `Request failed with status ${response.status}.`

    throw new Error(message)
  }

  return payload as T
}

export function hasApiMode() {
  return API_BASE_URL.length > 0
}

export async function bootstrapApp(slug: string) {
  return requestJson<BootstrapPayload>('/api/bootstrap', { query: { slug } })
}

export async function fetchTableOrders(slug: string, tableId: string) {
  return requestJson<{ orders: Order[] }>('/api/table-orders', { query: { slug, tableId } })
}

export async function loginStaff(slug: string, email: string, password: string) {
  return requestJson<{ ok: true; message: string }>('/api/staff/login', {
    method: 'POST',
    body: { slug, email, password },
  })
}

export async function loginStaffWithPin(slug: string, pin: string) {
  return requestJson<{ ok: true; message: string }>('/api/staff/pin-login', {
    method: 'POST',
    body: { slug, pin },
  })
}

export async function logoutStaff() {
  return requestJson<{ ok: true }>('/api/staff/logout', {
    method: 'POST',
  })
}

export async function submitGuestOrder(payload: {
  slug: string
  tableId: string
  customerName: string
  note?: string
  tabMode?: boolean
  items: Array<{ menuItemId: string; quantity: number; note?: string }>
}) {
  return requestJson<{ orderId: string }>('/api/orders', {
    method: 'POST',
    body: payload,
  })
}

export async function createServiceRequest(payload: {
  slug: string
  tableId: string
  type: ServiceRequestType
  message?: string
}) {
  return requestJson<{ ok: true; id: string }>('/api/service-requests', {
    method: 'POST',
    body: payload,
  })
}

export async function updateServiceRequestStatus(requestId: string, payload: { slug: string; status: 'acknowledged' | 'resolved' }) {
  return requestJson<{ ok: true }>(`/api/service-requests/${requestId}/status`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function createSplitPayment(payload: {
  slug: string
  tableId: string
  payerName: string
  amount: number
  method: string
  itemKeys: string[]
}) {
  return requestJson<{ ok: true; id: string }>('/api/split-payments', {
    method: 'POST',
    body: payload,
  })
}

export function createRealtimeStream(slug: string, onMessage: () => void) {
  if (!API_BASE_URL || typeof EventSource === 'undefined') return null
  const stream = new EventSource(buildUrl('/api/events', { slug }), { withCredentials: true })
  stream.addEventListener('message', () => onMessage())
  stream.addEventListener('dineflow-update', () => onMessage())
  return stream
}

export async function updateOrderStatus(orderId: string, slug: string, status: OrderStatus) {
  return requestJson<{ ok: true }>(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    body: { slug, status },
  })
}

export async function createMenuItem(payload: {
  slug: string
  name: string
  category: string
  price: number
  description: string
  prepMinutes: number
}) {
  return requestJson<{ ok: true; id: string }>('/api/menu-items', {
    method: 'POST',
    body: payload,
  })
}

export async function setMenuItemAvailability(menuItemId: string, payload: { slug: string; available: boolean }) {
  return requestJson<{ ok: true }>(`/api/menu-items/${menuItemId}/availability`, {
    method: 'PATCH',
    body: payload,
  })
}

export async function deleteMenuItem(menuItemId: string, slug: string) {
  return requestJson<{ ok: true }>(`/api/menu-items/${menuItemId}`, {
    method: 'DELETE',
    query: { slug },
  })
}

export async function createTable(payload: { slug: string; label: string; seats: number }) {
  return requestJson<{ ok: true; id: string }>('/api/tables', {
    method: 'POST',
    body: payload,
  })
}