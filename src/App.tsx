import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import type { AppMode, CartLine, Eatery, MenuItem, Order, OrderStatus, StaffProfile, StaffRole, Store, View } from './app-types'
import { emptyStore, getInitialTableId, getInitialView, initialStore, loadDemoStore, STORAGE_KEY } from './demo-data'
import {
  bootstrapApp,
  createRealtimeStream,
  createMenuItem as createMenuItemRequest,
  createServiceRequest,
  createSplitPayment,
  createTable as createTableRequest,
  deleteMenuItem as deleteMenuItemRequest,
  fetchTableOrders,
  hasApiMode,
  loginStaff,
  loginStaffWithPin,
  logoutStaff,
  setMenuItemAvailability,
  submitGuestOrder,
  updateServiceRequestStatus,
  updateOrderStatus as updateOrderStatusRequest,
} from './lib/api'

const EATERY_SLUG = String(import.meta.env.VITE_EATERY_SLUG ?? 'dine-flow').trim()
const EATERY_NAME = String(import.meta.env.VITE_EATERY_NAME ?? 'Dine Flow').trim() || 'Dine Flow'

const statusLabels: Record<OrderStatus, string> = {
  open_tab: 'Open tab',
  received: 'Received',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
}

const roleLabels: Record<StaffRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  kitchen: 'Kitchen',
  waiter: 'Waiter',
}

const statusFlow: OrderStatus[] = ['open_tab', 'received', 'preparing', 'ready', 'served']
const staffViewRoles: StaffRole[] = ['owner', 'admin', 'kitchen', 'waiter']
const managementRoles: StaffRole[] = ['owner', 'admin']
const recommendedServicePoints = [
  { label: 'Pickup Counter', seats: 1 },
  { label: 'Delivery Dispatch', seats: 1 },
] as const

type FulfillmentMode = 'dine-in' | 'pickup' | 'delivery'
type PaymentMethod = 'counter' | 'transfer' | 'pos' | 'cash'

type CustomerOrderSummary = {
  id: string
  tableId: string
  tableLabel: string
  fulfillmentMode: FulfillmentMode
  customerName: string
  total: number
  createdAt: string
}

const fulfillmentLabels: Record<FulfillmentMode, string> = {
  'dine-in': 'Dine-in',
  pickup: 'Pickup',
  delivery: 'Delivery',
}

const paymentLabels: Record<PaymentMethod, string> = {
  counter: 'Pay at counter',
  transfer: 'Bank transfer',
  pos: 'POS on delivery / pickup',
  cash: 'Cash',
}

function formatCurrency(value: number) {
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

function getOrderTotal(order: Order) {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

function getStatusClass(status: OrderStatus) {
  if (status === 'open_tab') return 'status-open-tab'
  if (status === 'preparing') return 'status-preparing'
  if (status === 'ready') return 'status-ready'
  return ''
}

function getKdsAgeClass(createdAt: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000))
  if (minutes >= 20) return 'age-danger'
  if (minutes >= 10) return 'age-warning'
  return 'age-ok'
}

function getQrImageUrl(link: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`
}

function buildEscPosPreview(order: Order) {
  const lines = [
    'DINEFLOW KITCHEN TICKET',
    `Table: ${order.tableLabel}`,
    `Order: ${shortOrderId(order.id)}`,
    '------------------------',
    ...order.items.map((item) => `${item.quantity} x ${item.name}`),
    '------------------------',
    `Total: ${formatCurrency(getOrderTotal(order))}`,
  ]
  return lines.join('\n')
}

function shortOrderId(orderId: string | null | undefined) {
  if (!orderId) return 'new'
  if (orderId.startsWith('ORD-')) return orderId
  const lastSegment = orderId.split('-').at(-1) ?? orderId
  return lastSegment.slice(0, 8).toUpperCase()
}

function formatRelativeTime(isoDate: string) {
  const timestamp = new Date(isoDate).getTime()
  if (Number.isNaN(timestamp)) return 'just now'

  const diffMs = Date.now() - timestamp
  const diffMinutes = Math.max(0, Math.round(diffMs / 60000))

  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes} min ago`

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hr ago`

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong.'
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isOffsiteOrderingPoint(label: string) {
  return /(pickup|delivery|dispatch|takeaway|take-away|take away|online|collection)/i.test(label)
}

function isPickupOrderingPoint(label: string) {
  return /(pickup|takeaway|take-away|take away|collection|counter)/i.test(label)
}

function isDeliveryOrderingPoint(label: string) {
  return /(delivery|dispatch|rider|online)/i.test(label)
}

function buildGuestOrderNote(params: {
  fulfillmentMode: FulfillmentMode
  customerNote: string
  offsiteContact: string
  offsiteDetails: string
  paymentMethod: PaymentMethod
}) {
  const noteParts: string[] = []

  noteParts.push(`Order type: ${fulfillmentLabels[params.fulfillmentMode]}`)
  noteParts.push(`Payment method: ${paymentLabels[params.paymentMethod]}`)

  if (params.fulfillmentMode !== 'dine-in') {
    noteParts.push(`${fulfillmentLabels[params.fulfillmentMode]} guest order`)

    if (params.offsiteContact.trim()) {
      noteParts.push(`Contact: ${params.offsiteContact.trim()}`)
    }

    if (params.offsiteDetails.trim()) {
      noteParts.push(
        params.fulfillmentMode === 'delivery'
          ? `Delivery address / landmark: ${params.offsiteDetails.trim()}`
          : `Pickup time / details: ${params.offsiteDetails.trim()}`,
      )
    }
  }

  if (params.customerNote.trim()) {
    noteParts.push(`Customer note: ${params.customerNote.trim()}`)
  }

  return noteParts.join('\n')
}

function buildTableLink(tableId: string) {
  const url = new URL(window.location.href)
  url.pathname = '/'
  url.searchParams.delete('view')
  if (tableId) {
    url.searchParams.set('table', tableId)
  } else {
    url.searchParams.delete('table')
  }
  return url.toString()
}

function getPathForView(view: View) {
  if (view === 'kitchen') return '/kitchen'
  if (view === 'admin') return '/admin'
  return '/'
}

function App() {
  const mode: AppMode = hasApiMode() ? 'api' : 'demo'
  const [store, setStore] = useState<Store>(() => (mode === 'api' ? emptyStore : loadDemoStore()))
  const [eatery, setEatery] = useState<Eatery | null>(null)
  const [sessionEmail, setSessionEmail] = useState('')
  const [staffProfile, setStaffProfile] = useState<StaffProfile | null>(null)
  const [view, setView] = useState<View>(() => getInitialView())
  const [selectedTableId, setSelectedTableId] = useState(() => getInitialTableId(initialStore.tables))
  const [customerName, setCustomerName] = useState('Guest')
  const [fulfillmentMode, setFulfillmentMode] = useState<FulfillmentMode>('dine-in')
  const [customerNote, setCustomerNote] = useState('')
  const [offsiteContact, setOffsiteContact] = useState('')
  const [offsiteDetails, setOffsiteDetails] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('counter')
  const [lastCustomerOrder, setLastCustomerOrder] = useState<CustomerOrderSummary | null>(null)
  const [cart, setCart] = useState<CartLine[]>([])
  const [category, setCategory] = useState('All')
  const [toast, setToast] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(mode === 'api')
  const [isSaving, setIsSaving] = useState(false)
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [pinValue, setPinValue] = useState('')
  const [splitPanelOpen, setSplitPanelOpen] = useState(false)
  const [splitMode, setSplitMode] = useState<'equal' | 'items'>('equal')
  const [splitPeople, setSplitPeople] = useState('2')
  const [splitItemKeys, setSplitItemKeys] = useState<string[]>([])
  const [payerName, setPayerName] = useState('Guest')
  const [menuForm, setMenuForm] = useState({
    name: '',
    category: '',
    price: '',
    description: '',
    prepMinutes: '10',
  })
  const [tableForm, setTableForm] = useState({ label: '', seats: '4' })
  const [publicTableOrders, setPublicTableOrders] = useState<Order[]>([])

  useEffect(() => {
    if (mode !== 'demo') return
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }, [mode, store])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const loadApiData = useCallback(async () => {
    if (mode !== 'api') return

    setIsLoading(true)
    setLoadError('')

    try {
      const payload = await bootstrapApp(EATERY_SLUG)
      setEatery(payload.eatery)
      setSessionEmail(payload.session?.email ?? '')
      setStaffProfile(payload.staffProfile)
      setStore(payload.store)
    } catch (error) {
      setLoadError(getErrorMessage(error))
    } finally {
      setIsLoading(false)
    }
  }, [mode])

  const loadPublicOrders = useCallback(async (tableId: string) => {
    if (mode !== 'api' || !tableId) return

    try {
      const payload = await fetchTableOrders(EATERY_SLUG, tableId)
      setPublicTableOrders(payload.orders)
    } catch {
      setPublicTableOrders([])
    }
  }, [mode])

  useEffect(() => {
    if (mode !== 'api') return undefined
    const timer = window.setTimeout(() => {
      void loadApiData()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [loadApiData, mode])

  useEffect(() => {
    if (mode !== 'api') return undefined
    const timer = window.setInterval(() => {
      void loadApiData()
    }, 15000)
    return () => window.clearInterval(timer)
  }, [loadApiData, mode])

  useEffect(() => {
    if (mode !== 'api') return undefined
    const stream = createRealtimeStream(EATERY_SLUG, () => {
      void loadApiData()
    })
    return () => stream?.close()
  }, [loadApiData, mode])

  const resolvedSelectedTableId = store.tables.some((table) => table.id === selectedTableId)
    ? selectedTableId
    : getInitialTableId(store.tables)

  useEffect(() => {
    if (mode !== 'api') return undefined
    if (!resolvedSelectedTableId) return undefined

    const timer = window.setTimeout(() => {
      void loadPublicOrders(resolvedSelectedTableId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadPublicOrders, mode, resolvedSelectedTableId])

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(store.menu.map((item) => item.category)))],
    [store.menu],
  )
  const activeCategory = categories.includes(category) ? category : 'All'
  const selectedTable = store.tables.find((table) => table.id === resolvedSelectedTableId) ?? store.tables[0]
  const urlTableId = new URLSearchParams(window.location.search).get('table')
  const isTableLocked = Boolean(urlTableId && store.tables.some((table) => table.id === urlTableId))
  const currentEateryName = eatery?.name ?? EATERY_NAME
  const canUseKitchen = mode === 'demo' || Boolean(staffProfile && staffViewRoles.includes(staffProfile.role))
  const canManage = mode === 'demo' || Boolean(staffProfile && managementRoles.includes(staffProfile.role))
  const canAccessAdminWorkspace = mode === 'demo' || sessionEmail.length > 0
  const canViewAdminContent = mode === 'demo' || canManage
  const customerViewTableOptions = useMemo(() => store.tables.filter((table) => !isOffsiteOrderingPoint(table.label)), [store.tables])
  const offsiteOrderingOptions = useMemo(() => store.tables.filter((table) => isOffsiteOrderingPoint(table.label)), [store.tables])
  const pickupOrderingOptions = useMemo(
    () => store.tables.filter((table) => isPickupOrderingPoint(table.label)),
    [store.tables],
  )
  const deliveryOrderingOptions = useMemo(
    () => store.tables.filter((table) => isDeliveryOrderingPoint(table.label)),
    [store.tables],
  )

  const filteredMenu = useMemo(
    () => store.menu.filter((item) => activeCategory === 'All' || item.category === activeCategory),
    [activeCategory, store.menu],
  )

  const cartItems = useMemo(() => {
    return cart
      .map((line) => {
        const menuItem = store.menu.find((item) => item.id === line.menuItemId)
        if (!menuItem) return null
        return { ...line, menuItem, total: menuItem.price * line.quantity }
      })
      .filter((item): item is CartLine & { menuItem: MenuItem; total: number } => item !== null)
  }, [cart, store.menu])

  const cartTotal = useMemo(() => cartItems.reduce((sum, item) => sum + item.total, 0), [cartItems])
  const cartCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.quantity, 0), [cartItems])
  const activeOrders = useMemo(
    () => store.orders.filter((order) => !['served', 'cancelled'].includes(order.status)),
    [store.orders],
  )
  const completedOrders = useMemo(
    () => store.orders.filter((order) => ['served', 'cancelled'].includes(order.status)),
    [store.orders],
  )
  const todayTotal = useMemo(() => store.orders.reduce((sum, order) => sum + getOrderTotal(order), 0), [store.orders])
  const selectedTableOrders = useMemo(() => {
    if (mode === 'demo' || canUseKitchen) {
      return store.orders.filter((order) => order.tableId === resolvedSelectedTableId)
    }

    return resolvedSelectedTableId ? publicTableOrders : []
  }, [canUseKitchen, mode, publicTableOrders, resolvedSelectedTableId, store.orders])
  const openTabOrders = useMemo(
    () => selectedTableOrders.filter((order) => !['served', 'cancelled'].includes(order.status)),
    [selectedTableOrders],
  )
  const openTabTotal = useMemo(() => openTabOrders.reduce((sum, order) => sum + getOrderTotal(order), 0), [openTabOrders])
  const outstandingTableTotal = openTabTotal + cartTotal
  const bestSeller = useMemo(() => {
    const counts = new Map<string, { name: string; quantity: number }>()
    for (const order of store.orders) {
      for (const item of order.items) {
        const current = counts.get(item.name) ?? { name: item.name, quantity: 0 }
        current.quantity += item.quantity
        counts.set(item.name, current)
      }
    }

    return [...counts.values()].sort((left, right) => right.quantity - left.quantity)[0] ?? null
  }, [store.orders])
  const defaultDineInTableId = customerViewTableOptions[0]?.id ?? ''
  const defaultPickupTableId = pickupOrderingOptions[0]?.id ?? offsiteOrderingOptions[0]?.id ?? ''
  const defaultDeliveryTableId = deliveryOrderingOptions[0]?.id ?? offsiteOrderingOptions[0]?.id ?? ''
  const selectedTableLink = selectedTable ? buildTableLink(selectedTable.id) : buildTableLink('')

  useEffect(() => {
    const url = new URL(window.location.href)
    url.pathname = getPathForView(view)
    url.searchParams.delete('view')
    if (resolvedSelectedTableId) {
      url.searchParams.set('table', resolvedSelectedTableId)
    } else {
      url.searchParams.delete('table')
    }

    const queryString = url.searchParams.toString()
    window.history.replaceState(null, '', `${url.pathname}${queryString ? `?${queryString}` : ''}`)
  }, [resolvedSelectedTableId, view])

  function addToCart(menuItemId: string) {
    setCart((current) => {
      const existing = current.find((line) => line.menuItemId === menuItemId)
      if (existing) {
        return current.map((line) =>
          line.menuItemId === menuItemId ? { ...line, quantity: line.quantity + 1 } : line,
        )
      }

      return [...current, { menuItemId, quantity: 1, note: '' }]
    })
  }

  function updateCartLine(menuItemId: string, quantity: number, note?: string) {
    setCart((current) =>
      current
        .map((line) => {
          if (line.menuItemId !== menuItemId) return line
          return { ...line, quantity, note: note ?? line.note }
        })
        .filter((line) => line.quantity > 0),
    )
  }

  async function sendServiceRequest(type: 'waiter' | 'bill' | 'cash_payment') {
    const activeTable = store.tables.find((table) => table.id === resolvedSelectedTableId) ?? selectedTable
    if (!activeTable) {
      setToast('Select a table first.')
      return
    }

    const message = type === 'waiter' ? `${activeTable.label} is requesting a waiter.` : `${activeTable.label} is requesting the bill.`

    if (mode === 'api') {
      try {
        await createServiceRequest({ slug: EATERY_SLUG, tableId: activeTable.id, type, message })
        setToast(type === 'waiter' ? 'Waiter requested.' : 'Bill requested.')
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not send request: ${getErrorMessage(error)}`)
      }
      return
    }

    const now = new Date().toISOString()
    setStore((current) => ({
      ...current,
      serviceRequests: [
        {
          id: `REQ-${Date.now().toString().slice(-6)}`,
          tableId: activeTable.id,
          tableLabel: activeTable.label,
          type,
          status: 'open',
          message,
          createdAt: now,
          updatedAt: now,
        },
        ...current.serviceRequests,
      ],
    }))
    setToast(type === 'waiter' ? 'Waiter requested.' : 'Bill requested.')
  }

  async function refreshAfterMutation() {
    if (mode === 'api') {
      await loadApiData()
      if (resolvedSelectedTableId) {
        await loadPublicOrders(resolvedSelectedTableId)
      }
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const customerNameValue = customerName.trim()
    const contactValue = offsiteContact.trim()
    const detailsValue = offsiteDetails.trim()
    const offsiteOptions = fulfillmentMode === 'delivery' ? deliveryOrderingOptions : pickupOrderingOptions
    const fallbackOffsiteTable = fulfillmentMode === 'delivery' ? defaultDeliveryTableId : defaultPickupTableId
    const activeTable =
      fulfillmentMode === 'dine-in'
        ? store.tables.find((table) => table.id === resolvedSelectedTableId && !isOffsiteOrderingPoint(table.label)) ?? customerViewTableOptions[0]
        : store.tables.find((table) => table.id === resolvedSelectedTableId && offsiteOptions.some((option) => option.id === table.id))
          ?? store.tables.find((table) => table.id === fallbackOffsiteTable)
          ?? offsiteOptions[0]

    if (!activeTable) {
      setToast(
        fulfillmentMode === 'delivery'
          ? 'Please create a Delivery Dispatch service point in Admin before taking delivery orders.'
          : fulfillmentMode === 'pickup'
          ? 'Please create a Pickup Counter service point in Admin before taking pickup orders.'
          : 'Please create or select a dine-in table first.',
      )
      return
    }

    if (cartItems.length === 0) {
      setToast('Add at least one item before submitting.')
      return
    }

    if (fulfillmentMode !== 'dine-in' && !customerNameValue) {
      setToast('Please enter your name for pickup or delivery orders.')
      return
    }

    if (fulfillmentMode !== 'dine-in' && !contactValue) {
      setToast('Please enter a phone number for pickup or delivery orders.')
      return
    }

    if (fulfillmentMode === 'delivery' && !detailsValue) {
      setToast('Please enter your delivery address.')
      return
    }

    const guestOrderNote = buildGuestOrderNote({
      fulfillmentMode,
      customerNote,
      offsiteContact,
      offsiteDetails,
      paymentMethod,
    })

    if (mode === 'api') {
      setIsSaving(true)
      try {
        const result = await submitGuestOrder({
          slug: EATERY_SLUG,
          tableId: activeTable.id,
          customerName: customerNameValue || 'Guest',
          note: guestOrderNote || undefined,
          tabMode: fulfillmentMode === 'dine-in',
          items: cartItems.map(({ menuItem, quantity, note }) => ({
            menuItemId: menuItem.id,
            quantity,
            note: note.trim() || undefined,
          })),
        })

        setCart([])
        setCustomerNote('')
        setOffsiteContact('')
        setOffsiteDetails('')
        setLastCustomerOrder({
          id: result.orderId,
          tableId: activeTable.id,
          tableLabel: activeTable.label,
          fulfillmentMode,
          customerName: customerNameValue || 'Guest',
          total: cartTotal,
          createdAt: new Date().toISOString(),
        })
        setToast(`Order ${shortOrderId(result.orderId)} received.`)
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not submit order: ${getErrorMessage(error)}`)
      } finally {
        setIsSaving(false)
      }

      return
    }

    const now = new Date().toISOString()
    const order: Order = {
      id: `ORD-${Date.now().toString().slice(-6)}`,
      tableId: activeTable.id,
      tableLabel: activeTable.label,
      customerName: customerNameValue || 'Guest',
      items: cartItems.map(({ menuItem, quantity, note }) => ({
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity,
        note: note.trim() || undefined,
      })),
      status: fulfillmentMode === 'dine-in' ? 'open_tab' : 'received',
      note: guestOrderNote || undefined,
      createdAt: now,
      updatedAt: now,
    }

    setStore((current) => ({ ...current, orders: [order, ...current.orders] }))
    setCart([])
    setCustomerNote('')
    setOffsiteContact('')
    setOffsiteDetails('')
    setLastCustomerOrder({
      id: order.id,
      tableId: activeTable.id,
      tableLabel: activeTable.label,
      fulfillmentMode,
      customerName: customerNameValue || 'Guest',
      total: cartTotal,
      createdAt: now,
    })
    setToast(`Order ${order.id} received.`)
  }

  async function advanceOrderStatus(orderId: string, status: OrderStatus) {
    if (mode === 'api') {
      if (!canUseKitchen) return

      try {
        await updateOrderStatusRequest(orderId, EATERY_SLUG, status)
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not update order: ${getErrorMessage(error)}`)
      }

      return
    }

    setStore((current) => ({
      ...current,
      orders: current.orders.map((order) =>
        order.id === orderId ? { ...order, status, updatedAt: new Date().toISOString() } : order,
      ),
    }))
  }

  async function resolveServiceRequest(requestId: string, status: 'acknowledged' | 'resolved') {
    if (mode === 'api') {
      if (!canUseKitchen) return
      try {
        await updateServiceRequestStatus(requestId, { slug: EATERY_SLUG, status })
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not update request: ${getErrorMessage(error)}`)
      }
      return
    }

    setStore((current) => ({
      ...current,
      serviceRequests: current.serviceRequests.map((request) =>
        request.id === requestId ? { ...request, status, updatedAt: new Date().toISOString() } : request,
      ),
    }))
  }

  async function saveSplitPayment() {
    const activeTable = store.tables.find((table) => table.id === resolvedSelectedTableId) ?? selectedTable
    if (!activeTable) return

    const people = Math.max(1, Number(splitPeople) || 1)
    const selectedAmount = splitItemKeys.reduce((sum, key) => {
      const [orderId, itemIndex] = key.split(':')
      const order = openTabOrders.find((candidate) => candidate.id === orderId)
      const item = order?.items[Number(itemIndex)]
      return item ? sum + item.price * item.quantity : sum
    }, 0)
    const amount = splitMode === 'equal' ? outstandingTableTotal / people : selectedAmount

    if (amount <= 0) {
      setToast('Select items or use a valid split amount.')
      return
    }

    if (mode === 'api') {
      try {
        await createSplitPayment({
          slug: EATERY_SLUG,
          tableId: activeTable.id,
          payerName: payerName.trim() || 'Guest',
          amount,
          method: paymentMethod,
          itemKeys: splitMode === 'equal' ? [] : splitItemKeys,
        })
        setToast(`Split payment recorded for ${formatCurrency(amount)}.`)
        setSplitPanelOpen(false)
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not record split payment: ${getErrorMessage(error)}`)
      }
      return
    }

    setStore((current) => ({
      ...current,
      splitPayments: [
        {
          id: `PAY-${Date.now().toString().slice(-6)}`,
          tableId: activeTable.id,
          payerName: payerName.trim() || 'Guest',
          amount,
          method: paymentMethod,
          itemKeys: splitMode === 'equal' ? [] : splitItemKeys,
          createdAt: new Date().toISOString(),
        },
        ...current.splitPayments,
      ],
    }))
    setToast(`Split payment recorded for ${formatCurrency(amount)}.`)
    setSplitPanelOpen(false)
  }

  async function toggleAvailability(menuItemId: string) {
    const item = store.menu.find((menuItem) => menuItem.id === menuItemId)
    if (!item) return

    if (mode === 'api') {
      if (!canManage) return

      try {
        await setMenuItemAvailability(menuItemId, { slug: EATERY_SLUG, available: !item.available })
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not update menu item: ${getErrorMessage(error)}`)
      }

      return
    }

    setStore((current) => ({
      ...current,
      menu: current.menu.map((menuItem) =>
        menuItem.id === menuItemId ? { ...menuItem, available: !menuItem.available } : menuItem,
      ),
    }))
  }

  async function removeMenuItem(menuItemId: string) {
    if (mode === 'api') {
      if (!canManage) return

      try {
        await deleteMenuItemRequest(menuItemId, EATERY_SLUG)
        setCart((current) => current.filter((line) => line.menuItemId !== menuItemId))
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not delete menu item: ${getErrorMessage(error)}`)
      }

      return
    }

    setStore((current) => ({
      ...current,
      menu: current.menu.filter((menuItem) => menuItem.id !== menuItemId),
    }))
    setCart((current) => current.filter((line) => line.menuItemId !== menuItemId))
  }

  async function handleCreateMenuItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedName = menuForm.name.trim()
    const trimmedCategory = menuForm.category.trim()
    const price = Number(menuForm.price)
    const prepMinutes = Number(menuForm.prepMinutes)

    if (!trimmedName || !trimmedCategory || Number.isNaN(price) || price <= 0) {
      setToast('Add a valid name, category and price.')
      return
    }

    if (Number.isNaN(prepMinutes) || prepMinutes <= 0) {
      setToast('Prep time must be greater than zero.')
      return
    }

    if (mode === 'api') {
      if (!canManage) return

      try {
        await createMenuItemRequest({
          slug: EATERY_SLUG,
          name: trimmedName,
          category: trimmedCategory,
          price,
          description: menuForm.description.trim(),
          prepMinutes,
        })

        setMenuForm({ name: '', category: '', price: '', description: '', prepMinutes: '10' })
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not create menu item: ${getErrorMessage(error)}`)
      }

      return
    }

    const createdItem: MenuItem = {
      id: `${slugify(trimmedName) || 'menu-item'}-${Date.now().toString().slice(-5)}`,
      name: trimmedName,
      category: trimmedCategory,
      price,
      description: menuForm.description.trim(),
      available: true,
      prepMinutes,
    }

    setStore((current) => ({ ...current, menu: [...current.menu, createdItem] }))
    setMenuForm({ name: '', category: '', price: '', description: '', prepMinutes: '10' })
    setToast(`${createdItem.name} added to the menu.`)
  }

  async function handleCreateTable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedLabel = tableForm.label.trim()
    const seats = Number(tableForm.seats)
    if (!trimmedLabel || Number.isNaN(seats) || seats <= 0) {
      setToast('Add a valid table label and seat count.')
      return
    }

    if (mode === 'api') {
      if (!canManage) return

      try {
        const result = await createTableRequest({ slug: EATERY_SLUG, label: trimmedLabel, seats })
        setSelectedTableId(result.id)
        setTableForm({ label: '', seats: '4' })
        await refreshAfterMutation()
      } catch (error) {
        setToast(`Could not create table: ${getErrorMessage(error)}`)
      }

      return
    }

    const createdTable = {
      id: `${slugify(trimmedLabel) || 'table'}-${Date.now().toString().slice(-5)}`,
      label: trimmedLabel,
      seats,
    }

    setStore((current) => ({ ...current, tables: [...current.tables, createdTable] }))
    setSelectedTableId(createdTable.id)
    setTableForm({ label: '', seats: '4' })
    setToast(`${createdTable.label} added.`)
  }

  async function signInStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode !== 'api') return

    setIsSaving(true)
    try {
      await loginStaff(EATERY_SLUG, authForm.email.trim(), authForm.password)
      setAuthForm((current) => ({ ...current, password: '' }))
      setToast('Signed in. Loading staff access...')
      await loadApiData()
    } catch (error) {
      setToast(`Could not sign in: ${getErrorMessage(error)}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function signInStaffWithPin() {
    if (mode !== 'api' || pinValue.length !== 4) return
    setIsSaving(true)
    try {
      await loginStaffWithPin(EATERY_SLUG, pinValue)
      setPinValue('')
      setToast('PIN accepted. Loading staff access...')
      await loadApiData()
    } catch (error) {
      setToast(`Could not sign in with PIN: ${getErrorMessage(error)}`)
      setPinValue('')
    } finally {
      setIsSaving(false)
    }
  }

  async function signOutStaff() {
    if (mode !== 'api') return

    try {
      await logoutStaff()
      setStaffProfile(null)
      setSessionEmail('')
      setToast('Signed out.')
      await loadApiData()
    } catch (error) {
      setToast(`Could not sign out: ${getErrorMessage(error)}`)
    }
  }

  function renderCustomerView() {
    const customerSelectableTables =
      fulfillmentMode === 'delivery'
        ? deliveryOrderingOptions
        : fulfillmentMode === 'pickup'
        ? pickupOrderingOptions
        : customerViewTableOptions
    const currentCustomerTable = customerSelectableTables.find((table) => table.id === resolvedSelectedTableId) ?? customerSelectableTables[0]
    const lastOrder = lastCustomerOrder
      ? store.orders.find((order) => order.id === lastCustomerOrder.id) ?? lastCustomerOrder
      : null

    return (
      <section className="content-grid">
        <div className="content-stack">
          {lastOrder ? (
            <section className="panel confirmation-panel">
              <span className="eyebrow">Order confirmation</span>
              <h2>Order received</h2>
              <div className="confirmation-grid">
                <div>
                  <span>Order number</span>
                  <strong>{shortOrderId(lastOrder.id)}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>{'status' in lastOrder ? statusLabels[lastOrder.status] : 'Received'}</strong>
                </div>
                <div>
                  <span>Order type</span>
                  <strong>{fulfillmentLabels[lastCustomerOrder?.fulfillmentMode ?? fulfillmentMode]}</strong>
                </div>
                <div>
                  <span>Total</span>
                  <strong>{formatCurrency('items' in lastOrder ? getOrderTotal(lastOrder) : lastOrder.total)}</strong>
                </div>
              </div>
              <p className="empty">Keep this page open to follow your order status. You can also place another order below.</p>
              {'status' in lastOrder ? (
                <div className="progress-steps">
                  {(['received', 'preparing', 'ready', 'served'] as OrderStatus[]).map((step) => (
                    <div key={step} className={statusFlow.indexOf(lastOrder.status) >= statusFlow.indexOf(step) ? 'complete' : ''}>
                      <span>{statusLabels[step]}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <button type="button" onClick={() => setLastCustomerOrder(null)}>
                Place another order
              </button>
            </section>
          ) : null}

          <section className="panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">Guest ordering</span>
                <h2>Browse the menu</h2>
                <p>
                  {fulfillmentMode === 'delivery'
                    ? 'Order for delivery and share your contact details so the team can reach you.'
                    : fulfillmentMode === 'pickup'
                    ? 'Order ahead and collect your meal when it is ready.'
                    : 'Choose your table, add notes, and send a clean ticket straight to the kitchen.'}
                </p>
              </div>
            </div>

            <div className="guest-mode-toggle">
              <button
                type="button"
                className={fulfillmentMode === 'dine-in' ? 'active' : ''}
                onClick={() => {
                  setFulfillmentMode('dine-in')
                  if (defaultDineInTableId) {
                    setSelectedTableId(defaultDineInTableId)
                  }
                }}
              >
                Dine-in
              </button>
              <button
                type="button"
                className={fulfillmentMode === 'pickup' ? 'active' : ''}
                onClick={() => {
                  setFulfillmentMode('pickup')
                  if (defaultPickupTableId) {
                    setSelectedTableId(defaultPickupTableId)
                  }
                }}
              >
                Pickup
              </button>
              <button
                type="button"
                className={fulfillmentMode === 'delivery' ? 'active' : ''}
                onClick={() => {
                  setFulfillmentMode('delivery')
                  if (defaultDeliveryTableId) {
                    setSelectedTableId(defaultDeliveryTableId)
                  }
                }}
              >
                Delivery
              </button>
            </div>

            <div className="customer-meta-grid">
              {fulfillmentMode === 'dine-in' ? (
                <label>
                  {isTableLocked ? 'Locked table from QR link' : 'Table'}
                  {isTableLocked ? (
                    <input value={currentCustomerTable ? `${currentCustomerTable.label} • ${currentCustomerTable.seats} seats` : ''} readOnly />
                  ) : (
                    <select value={currentCustomerTable?.id ?? ''} onChange={(event) => setSelectedTableId(event.target.value)}>
                      {customerSelectableTables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.label} • {table.seats} seats
                        </option>
                      ))}
                    </select>
                  )}
                </label>
              ) : (
                <>
                  <label>
                    {fulfillmentMode === 'delivery' ? 'Delivery option' : 'Pickup option'}
                    <input value={fulfillmentLabels[fulfillmentMode]} readOnly />
                  </label>

                  <label>
                    Phone number
                    <input
                      value={offsiteContact}
                      onChange={(event) => setOffsiteContact(event.target.value)}
                      placeholder="0800 000 0000"
                      required
                    />
                  </label>

                  <label className="wide-field">
                    {fulfillmentMode === 'delivery' ? 'Delivery address' : 'Preferred pickup time'}
                    <textarea
                      value={offsiteDetails}
                      onChange={(event) => setOffsiteDetails(event.target.value)}
                      placeholder={
                        fulfillmentMode === 'delivery'
                          ? 'Delivery address and nearby landmark'
                          : 'Example: 30 minutes from now, or 7:30 PM'
                      }
                      required={fulfillmentMode === 'delivery'}
                    />
                  </label>
                </>
              )}
            </div>

            {customerSelectableTables.length === 0 ? (
              <div className="panel flat customer-helper-note">
                <strong>
                  {fulfillmentMode === 'delivery'
                    ? 'Delivery is not set up yet.'
                    : fulfillmentMode === 'pickup'
                    ? 'Pickup is not set up yet.'
                    : 'No dine-in tables are available yet.'}
                </strong>
                <p>
                  {fulfillmentMode === 'delivery'
                    ? 'Ask the admin to create a Delivery Dispatch service point.'
                    : fulfillmentMode === 'pickup'
                    ? 'Ask the admin to create a Pickup Counter service point.'
                    : 'Ask the admin to create guest tables in the admin workspace.'}
                </p>
              </div>
            ) : null}

            <div className="category-row">
              {categories.map((categoryName) => (
                <button
                  key={categoryName}
                  type="button"
                  className={categoryName === activeCategory ? 'chip active' : 'chip'}
                  onClick={() => setCategory(categoryName)}
                >
                  {categoryName}
                </button>
              ))}
            </div>

            <div className="menu-list">
              {filteredMenu.map((item) => (
                <article key={item.id} className={`menu-card ${item.available ? '' : 'muted'}`}>
                  <div>
                    <span>
                      {item.category} • {item.prepMinutes} min prep
                    </span>
                    <h3>{item.name}</h3>
                    <p>{item.description}</p>
                  </div>

                  <div className="menu-card-footer">
                    <strong>{formatCurrency(item.price)}</strong>
                    {cart.find((line) => line.menuItemId === item.id) ? (
                      <div className="qty-row menu-qty-row">
                        <button type="button" onClick={() => updateCartLine(item.id, (cart.find((line) => line.menuItemId === item.id)?.quantity ?? 1) - 1)}>
                          −
                        </button>
                        <strong>{cart.find((line) => line.menuItemId === item.id)?.quantity ?? 0}</strong>
                        <button type="button" onClick={() => addToCart(item.id)} disabled={!item.available}>
                          +
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addToCart(item.id)} disabled={!item.available}>
                        {item.available ? 'Add to cart' : 'Unavailable'}
                      </button>
                    )}
                  </div>
                </article>
              ))}

              {filteredMenu.length === 0 ? <p className="empty">No menu items found in this category yet.</p> : null}
            </div>
          </section>

          <details className="panel history-panel">
            <summary>
              {fulfillmentMode === 'dine-in' ? 'Recent orders for this table' : 'Recent orders for this order type'} ({selectedTableOrders.length})
            </summary>
            <div className="history-list">
              {selectedTableOrders.length === 0 ? (
                <p className="empty">
                  {fulfillmentMode === 'dine-in' ? 'This table has no orders yet.' : 'No recent orders for this order type yet.'}
                </p>
              ) : (
                selectedTableOrders.map((order) => (
                  <article key={order.id} className="panel flat order-card">
                    <div className="order-head">
                      <div>
                        <h3>{shortOrderId(order.id)}</h3>
                        <span>
                          {order.customerName} • {formatRelativeTime(order.createdAt)}
                        </span>
                      </div>
                      <span className="status-pill">{statusLabels[order.status]}</span>
                    </div>
                    <ul className="ticket-items">
                      {order.items.map((item) => (
                        <li key={`${order.id}-${item.menuItemId}-${item.name}`}>
                          {item.quantity} × {item.name}
                          {item.note ? <span>Note: {item.note}</span> : null}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))
              )}
            </div>
          </details>
        </div>

        <aside className="panel cart-panel">
          <h2>Your cart</h2>
          {fulfillmentMode === 'dine-in' ? (
            <div className="open-tab-card">
              <span>Open tab running total</span>
              <strong>{formatCurrency(outstandingTableTotal)}</strong>
              <small>{openTabOrders.length} active kitchen ticket(s) for this table</small>
            </div>
          ) : null}
          <form onSubmit={submitOrder}>
            <label>
              {fulfillmentMode === 'dine-in' ? 'Customer name' : 'Customer name required'}
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder={fulfillmentMode === 'dine-in' ? 'Guest' : 'Your name'}
                required={fulfillmentMode !== 'dine-in'}
              />
            </label>

            <div className="cart-lines">
              {cartItems.length === 0 ? (
                <p className="empty">Your cart is empty. Add dishes from the menu.</p>
              ) : (
                cartItems.map(({ menuItem, quantity, note, total }) => (
                  <div key={menuItem.id} className="cart-line">
                    <div className="order-head">
                      <div>
                        <h3>{menuItem.name}</h3>
                        <span>
                          {formatCurrency(menuItem.price)} each • {formatCurrency(total)} total
                        </span>
                      </div>
                    </div>

                    <div className="qty-row">
                      <button type="button" onClick={() => updateCartLine(menuItem.id, quantity - 1)}>
                        −
                      </button>
                      <strong>{quantity}</strong>
                      <button type="button" onClick={() => updateCartLine(menuItem.id, quantity + 1)}>
                        +
                      </button>
                    </div>

                    <label>
                      Item note
                      <input
                        value={note}
                        onChange={(event) => updateCartLine(menuItem.id, quantity, event.target.value)}
                        placeholder="e.g. no onions, extra sauce"
                      />
                    </label>
                  </div>
                ))
              )}
            </div>

            <label>
              {fulfillmentMode === 'dine-in' ? 'General note to kitchen' : 'Order note'}
              <textarea
                value={customerNote}
                onChange={(event) => setCustomerNote(event.target.value)}
                placeholder={
                  fulfillmentMode !== 'dine-in'
                    ? 'Anything the kitchen or dispatch rider should know?'
                    : 'Anything the kitchen should know for this table?'
                }
              />
            </label>

            <label>
              Payment method
              <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                {(Object.keys(paymentLabels) as PaymentMethod[]).map((method) => (
                  <option key={method} value={method}>
                    {paymentLabels[method]}
                  </option>
                ))}
              </select>
            </label>

            <div className="payment-note">
              Payment is not collected in the app yet. The selected payment method helps the team prepare checkout or delivery confirmation.
            </div>

            <div className="total-row">
              <span>Total</span>
              <strong>{formatCurrency(cartTotal)}</strong>
            </div>

            <button className="submit-button" type="submit" disabled={isSaving || cartItems.length === 0 || !currentCustomerTable}>
              {isSaving
                ? 'Sending order...'
                : fulfillmentMode === 'dine-in'
                ? `Send to kitchen${currentCustomerTable ? ` for ${currentCustomerTable.label}` : ''}`
                : `Send ${fulfillmentLabels[fulfillmentMode].toLowerCase()} order`}
            </button>
            {fulfillmentMode === 'dine-in' ? (
              <button type="button" className="secondary-button" onClick={() => setSplitPanelOpen(true)} disabled={outstandingTableTotal <= 0}>
                Split / settle bill
              </button>
            ) : null}
          </form>
        </aside>
        {splitPanelOpen ? (
          <div className="modal-backdrop" role="dialog" aria-modal="true">
            <section className="panel split-modal">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Smart bill splitting</span>
                  <h2>Settle table bill</h2>
                </div>
                <button type="button" onClick={() => setSplitPanelOpen(false)}>Close</button>
              </div>
              <div className="guest-mode-toggle">
                <button type="button" className={splitMode === 'equal' ? 'active' : ''} onClick={() => setSplitMode('equal')}>Split equally</button>
                <button type="button" className={splitMode === 'items' ? 'active' : ''} onClick={() => setSplitMode('items')}>Pay my items</button>
              </div>
              <label>
                Payer name
                <input value={payerName} onChange={(event) => setPayerName(event.target.value)} />
              </label>
              {splitMode === 'equal' ? (
                <label>
                  Number of people
                  <input inputMode="numeric" value={splitPeople} onChange={(event) => setSplitPeople(event.target.value)} />
                </label>
              ) : (
                <div className="split-item-list">
                  {openTabOrders.flatMap((order) => order.items.map((item, index) => ({ order, item, key: `${order.id}:${index}` }))).map(({ order, item, key }) => (
                    <label key={key} className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={splitItemKeys.includes(key)}
                        onChange={(event) => setSplitItemKeys((current) => event.target.checked ? [...current, key] : current.filter((itemKey) => itemKey !== key))}
                      />
                      {item.quantity} × {item.name} from {shortOrderId(order.id)} • {formatCurrency(item.price * item.quantity)}
                    </label>
                  ))}
                </div>
              )}
              <div className="total-row">
                <span>Amount due now</span>
                <strong>{formatCurrency(splitMode === 'equal' ? outstandingTableTotal / Math.max(1, Number(splitPeople) || 1) : splitItemKeys.reduce((sum, key) => {
                  const [orderId, itemIndex] = key.split(':')
                  const order = openTabOrders.find((candidate) => candidate.id === orderId)
                  const item = order?.items[Number(itemIndex)]
                  return item ? sum + item.price * item.quantity : sum
                }, 0))}</strong>
              </div>
              <button type="button" onClick={() => void saveSplitPayment()}>Record split payment</button>
            </section>
          </div>
        ) : null}
        {fulfillmentMode === 'dine-in' ? (
          <div className="customer-fab-stack">
            <button type="button" onClick={() => void sendServiceRequest('waiter')}>Call Waiter</button>
            <button type="button" onClick={() => void sendServiceRequest('bill')}>Request Bill</button>
          </div>
        ) : null}
        {cartCount > 0 ? (
          <button type="button" className="mobile-cart-bar" onClick={() => document.querySelector('.cart-panel')?.scrollIntoView({ behavior: 'smooth' })}>
            View cart • {cartCount} item{cartCount === 1 ? '' : 's'} • {formatCurrency(cartTotal)}
          </button>
        ) : null}
      </section>
    )
  }

  function renderKitchenView() {
    if (!canUseKitchen) {
      return (
        <section className="panel">
          <span className="eyebrow">Kitchen access</span>
          <h2>Staff sign-in required</h2>
          <p>Open the Admin view and sign in with a staff account that has kitchen, admin, owner, or waiter access.</p>
        </section>
      )
    }

    return (
      <section className="content-stack">
        {store.serviceRequests.filter((request) => request.status !== 'resolved').length > 0 ? (
          <section className="panel service-alert-panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">Floor alerts</span>
                <h2>Waiter and bill requests</h2>
              </div>
            </div>
            <div className="service-request-list">
              {store.serviceRequests.filter((request) => request.status !== 'resolved').map((request) => (
                <article key={request.id} className="service-request-card">
                  <strong>{request.tableLabel}</strong>
                  <span>{request.type === 'waiter' ? 'Needs waiter' : 'Wants bill / payment'} • {formatRelativeTime(request.createdAt)}</span>
                  <p>{request.message}</p>
                  <div className="order-actions">
                    {request.status === 'open' ? <button type="button" onClick={() => void resolveServiceRequest(request.id, 'acknowledged')}>Acknowledge</button> : null}
                    <button type="button" onClick={() => void resolveServiceRequest(request.id, 'resolved')}>Resolve</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
        <section className="panel">
          <div className="section-title">
            <div>
              <span className="eyebrow">Kitchen board</span>
              <h2>Active tickets</h2>
              <p>Move tickets from received to served, or cancel when needed.</p>
            </div>
            <strong>{activeOrders.length} active</strong>
          </div>

          <div className="order-board">
            {activeOrders.map((order) => {
              const currentStatusIndex = statusFlow.indexOf(order.status)
              const nextStatus = currentStatusIndex === -1 ? undefined : statusFlow[currentStatusIndex + 1]

              return (
                <article key={order.id} className={`panel order-card ${getStatusClass(order.status)} ${getKdsAgeClass(order.createdAt)}`}>
                  <div className="order-head">
                    <div>
                      <h3>{order.tableLabel}</h3>
                      <span>
                        {shortOrderId(order.id)} • {order.customerName} • {formatRelativeTime(order.createdAt)}
                      </span>
                    </div>
                    <span className="status-pill">{statusLabels[order.status]}</span>
                  </div>

                  <ul className="ticket-items">
                    {order.items.map((item) => (
                      <li key={`${order.id}-${item.menuItemId}-${item.name}`}>
                        {item.quantity} × {item.name}
                        {item.note ? <span>Note: {item.note}</span> : null}
                      </li>
                    ))}
                  </ul>

                  {order.note ? <div className="kitchen-note">Kitchen note: {order.note}</div> : null}

                  <div className="total-row">
                    <span>Total</span>
                    <strong>{formatCurrency(getOrderTotal(order))}</strong>
                  </div>

                  <div className="order-actions">
                    <button type="button" className="secondary-button" onClick={() => window.alert(buildEscPosPreview(order))}>
                      ESC/POS preview
                    </button>
                    {nextStatus ? (
                      <button type="button" onClick={() => void advanceOrderStatus(order.id, nextStatus)}>
                        Mark as {statusLabels[nextStatus]}
                      </button>
                    ) : null}

                    {order.status !== 'cancelled' && order.status !== 'served' ? (
                      <button
                        type="button"
                        className="ghost-danger"
                        onClick={() => void advanceOrderStatus(order.id, 'cancelled')}
                      >
                        Cancel order
                      </button>
                    ) : null}
                  </div>
                </article>
              )
            })}

            {activeOrders.length === 0 ? <p className="empty">No active orders right now.</p> : null}
          </div>
        </section>

        <details className="panel history-panel">
          <summary>Completed and cancelled orders ({completedOrders.length})</summary>
          <div className="history-list">
            {completedOrders.length === 0 ? (
              <p className="empty">No completed history yet.</p>
            ) : (
              completedOrders.map((order) => (
                <article key={order.id} className={`panel flat order-card ${getStatusClass(order.status)}`}>
                  <div className="order-head">
                    <div>
                      <h3>{order.tableLabel}</h3>
                      <span>
                        {shortOrderId(order.id)} • {formatRelativeTime(order.updatedAt)}
                      </span>
                    </div>
                    <span className="status-pill">{statusLabels[order.status]}</span>
                  </div>

                  <ul className="ticket-items">
                    {order.items.map((item) => (
                      <li key={`${order.id}-${item.menuItemId}-${item.name}`}>
                        {item.quantity} × {item.name}
                      </li>
                    ))}
                  </ul>
                </article>
              ))
            )}
          </div>
        </details>
      </section>
    )
  }

  function renderAdminView() {
    if (!canAccessAdminWorkspace) {
      return (
        <section className="panel">
          <span className="eyebrow">Staff access</span>
          <h2>Sign in required</h2>
          <p>Admin tools are separated from customer ordering. Sign in with an owner or admin account to manage menu items, tables, and service points.</p>

          {mode === 'api' ? (
            <div className="auth-grid">
              <form className="admin-form" onSubmit={signInStaff}>
                <label>
                  Email
                  <input
                    type="email"
                    value={authForm.email}
                    onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="owner@dineflow.com"
                  />
                </label>

                <label>
                  Password
                  <input
                    type="password"
                    value={authForm.password}
                    onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                  />
                </label>

                <button type="submit" disabled={isSaving}>
                  {isSaving ? 'Signing in...' : 'Sign in'}
                </button>
              </form>
              <div className="pin-pad-panel">
                <strong>Fast staff PIN</strong>
                <output>{pinValue.padEnd(4, '•')}</output>
                <div className="pin-grid">
                  {'1234567890'.split('').map((digit) => (
                    <button key={digit} type="button" onClick={() => setPinValue((current) => (current + digit).slice(0, 4))}>{digit}</button>
                  ))}
                  <button type="button" onClick={() => setPinValue('')}>Clear</button>
                  <button type="button" onClick={() => void signInStaffWithPin()} disabled={pinValue.length !== 4}>Go</button>
                </div>
              </div>
            </div>
          ) : (
            <p>Demo mode allows direct access so you can test the workflow locally.</p>
          )}
        </section>
      )
    }

    return (
      <section className="content-grid admin-grid">
        <section className="panel">
          <span className="eyebrow">Staff access</span>
          <h2>{mode === 'demo' ? 'Demo mode enabled' : sessionEmail ? 'Staff session' : 'Sign in for management'}</h2>

          {mode === 'demo' ? (
            <p>Demo mode stores data in your browser so you can test menu, tables, and order flow immediately without a backend.</p>
          ) : sessionEmail ? (
            <div className="content-stack">
              <div>
                <strong>{sessionEmail}</strong>
                <p>Role: {staffProfile ? roleLabels[staffProfile.role] : 'No staff role found for this eatery yet.'}</p>
              </div>
              <button type="button" onClick={() => void signOutStaff()}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="auth-grid">
            <form className="admin-form" onSubmit={signInStaff}>
              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="owner@dineflow.com"
                />
              </label>

              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm((current) => ({ ...current, password: event.target.value }))}
                />
              </label>

              <button type="submit" disabled={isSaving}>
                {isSaving ? 'Signing in...' : 'Sign in'}
              </button>

              <p className="empty">Default seeded owner login: owner@dineflow.com / ChangeMe123!</p>
            </form>
            <div className="pin-pad-panel">
              <strong>Fast staff PIN</strong>
              <output>{pinValue.padEnd(4, '•')}</output>
              <div className="pin-grid">
                {'1234567890'.split('').map((digit) => (
                  <button key={digit} type="button" onClick={() => setPinValue((current) => (current + digit).slice(0, 4))}>{digit}</button>
                ))}
                <button type="button" onClick={() => setPinValue('')}>Clear</button>
                <button type="button" onClick={() => void signInStaffWithPin()} disabled={pinValue.length !== 4}>Go</button>
              </div>
              <p className="empty">Add `pin_hash = sha256('dineflow-pin:1234')` for staff in Neon to enable this.</p>
            </div>
            </div>
          )}
        </section>

        <section className="panel">
          <span className="eyebrow">Insights</span>
          <h2>Service overview</h2>
          <div className="table-links">
            <div>
              <strong>{store.orders.length}</strong>
              <span>Total orders tracked</span>
            </div>
            <div>
              <strong>{formatCurrency(todayTotal)}</strong>
              <span>Gross order value</span>
            </div>
            <div>
              <strong>{bestSeller ? bestSeller.name : '—'}</strong>
              <span>{bestSeller ? `${bestSeller.quantity} portions sold` : 'No sales yet'}</span>
            </div>
          </div>
        </section>

        {!canViewAdminContent ? (
          <section className="panel wide">
            <span className="eyebrow">Restricted access</span>
            <h2>Management permission required</h2>
            <p>Your staff account can access kitchen workflows, but only an owner or admin can manage menu items, tables, and off-site order channels.</p>
          </section>
        ) : (
          <>
            <section className="panel">
              <span className="eyebrow">Menu management</span>
              <h2>Add menu item</h2>
              <form className="admin-form" onSubmit={handleCreateMenuItem}>
                <label>
                  Item name
                  <input
                    value={menuForm.name}
                    onChange={(event) => setMenuForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Egusi with pounded yam"
                    disabled={!canManage}
                  />
                </label>

                <label>
                  Category
                  <input
                    value={menuForm.category}
                    onChange={(event) => setMenuForm((current) => ({ ...current, category: event.target.value }))}
                    placeholder="Swallow"
                    disabled={!canManage}
                  />
                </label>

                <label>
                  Price
                  <input
                    inputMode="numeric"
                    value={menuForm.price}
                    onChange={(event) => setMenuForm((current) => ({ ...current, price: event.target.value }))}
                    placeholder="3500"
                    disabled={!canManage}
                  />
                </label>

                <label>
                  Prep time (minutes)
                  <input
                    inputMode="numeric"
                    value={menuForm.prepMinutes}
                    onChange={(event) => setMenuForm((current) => ({ ...current, prepMinutes: event.target.value }))}
                    disabled={!canManage}
                  />
                </label>

                <label>
                  Description
                  <textarea
                    value={menuForm.description}
                    onChange={(event) => setMenuForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="What guests should expect"
                    disabled={!canManage}
                  />
                </label>

                <button type="submit" disabled={!canManage}>
                  Add to menu
                </button>
              </form>
            </section>

            <section className="panel">
              <span className="eyebrow">Table management</span>
              <h2>Create table or service point</h2>
              <form className="admin-form" onSubmit={handleCreateTable}>
                <label>
                  Table / point label
                  <input
                    value={tableForm.label}
                    onChange={(event) => setTableForm((current) => ({ ...current, label: event.target.value }))}
                    placeholder="Patio 2 or Pickup Counter"
                    disabled={!canManage}
                  />
                </label>

                <label>
                  Seats
                  <input
                    inputMode="numeric"
                    value={tableForm.seats}
                    onChange={(event) => setTableForm((current) => ({ ...current, seats: event.target.value }))}
                    disabled={!canManage}
                  />
                </label>

                <button type="submit" disabled={!canManage}>
                  Add table / point
                </button>
              </form>

              <p className="empty">
                Suggestion: create <strong>Pickup Counter</strong> and <strong>Delivery Dispatch</strong> so guests outside the eatery can order without using dine-in tables.
              </p>

              {canManage ? (
                <div className="quick-actions-row">
                  {recommendedServicePoints.map((point) => (
                    <button
                      key={point.label}
                      type="button"
                      onClick={() => setTableForm({ label: point.label, seats: String(point.seats) })}
                    >
                      Use {point.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="panel wide">
              <div className="section-title">
                <div>
                  <span className="eyebrow">Operational assets</span>
                  <h2>Menu and table list</h2>
                </div>
              </div>

              <div className="admin-menu-list">
                {store.menu.map((item) => (
                  <div key={item.id} className="admin-menu-row">
                    <div>
                      <strong>{item.name}</strong>
                      <span>
                        {item.category} • {formatCurrency(item.price)} • {item.prepMinutes} min prep
                      </span>
                      {item.stockCount !== undefined ? (
                        <span className={item.stockCount <= (item.lowStockThreshold ?? 5) ? 'inventory-danger' : ''}>
                          Stock: {item.stockCount} • Alert below {item.lowStockThreshold ?? 5}
                        </span>
                      ) : (
                        <span>Inventory alert: add stock counts in Neon to enable predictive warnings.</span>
                      )}
                    </div>

                    <div className="order-actions">
                      <button type="button" onClick={() => void toggleAvailability(item.id)} disabled={!canManage}>
                        {item.available ? 'Mark unavailable' : 'Mark available'}
                      </button>
                      <button type="button" className="ghost-danger" onClick={() => void removeMenuItem(item.id)} disabled={!canManage}>
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-links">
                {store.tables.map((table) => (
                  <div key={table.id}>
                    <strong>
                      {table.label} • {table.seats} seats
                    </strong>
                    <span>{isOffsiteOrderingPoint(table.label) ? 'Off-site ordering point' : 'Guest ordering link'}</span>
                    <code>{buildTableLink(table.id)}</code>
                    {!isOffsiteOrderingPoint(table.label) ? <img className="qr-code" src={getQrImageUrl(buildTableLink(table.id))} alt={`QR code for ${table.label}`} /> : null}
                  </div>
                ))}
              </div>
            </section>
            <section className="panel wide">
              <span className="eyebrow">Floor plan builder</span>
              <h2>Interactive table layout preview</h2>
              <div className="floor-plan-canvas">
                {store.tables.filter((table) => !isOffsiteOrderingPoint(table.label)).map((table, index) => (
                  <button
                    key={table.id}
                    type="button"
                    className="floor-table"
                    style={{ left: `${table.floorX ?? 8 + (index % 4) * 22}%`, top: `${table.floorY ?? 12 + Math.floor(index / 4) * 28}%` }}
                    onClick={() => setSelectedTableId(table.id)}
                  >
                    {table.label}
                  </button>
                ))}
              </div>
              <p className="empty">This MVP stores/reads floor coordinates when present. Drag-and-save can be added next without changing the database.</p>
            </section>
          </>
        )}
      </section>
    )
  }

  const isCustomerView = view === 'customer'

  return (
    <main className="app-shell">
      {toast ? <div className="toast">{toast}</div> : null}

      {isCustomerView ? (
        <header className="hero-panel public-hero">
          <div className="topbar">
            <div>
              <span className="eyebrow">Welcome to {currentEateryName}</span>
              <h1>{currentEateryName}</h1>
              <p className="lead">A clean ordering experience for dine-in guests, pickup orders, and delivery requests.</p>
            </div>
          </div>

          <div className="hero-grid">
            <div>
              <div className="hero-actions">
                <button
                  type="button"
                  onClick={() => {
                    setFulfillmentMode('dine-in')
                    if (defaultDineInTableId) {
                      setSelectedTableId(defaultDineInTableId)
                    }
                  }}
                >
                  Dine-in ordering
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFulfillmentMode('pickup')
                    if (defaultPickupTableId) {
                      setSelectedTableId(defaultPickupTableId)
                    }
                  }}
                >
                  Pickup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFulfillmentMode('delivery')
                    if (defaultDeliveryTableId) {
                      setSelectedTableId(defaultDeliveryTableId)
                    }
                  }}
                >
                  Delivery
                </button>
              </div>
            </div>

            <div className="stat-card">
              <span>Guest options</span>
              <strong>3</strong>
              <p>
                dine-in, pickup, and delivery ordering for {currentEateryName}
              </p>
            </div>
          </div>

          {loadError ? (
            <div className="panel flat">
              <strong>Could not load ordering data</strong>
              <p>{loadError}</p>
            </div>
          ) : null}
        </header>
      ) : (
        <header className="hero-panel staff-hero">
          <div className="topbar">
            <div>
              <span className="eyebrow">{mode === 'demo' ? 'Staff demo workspace' : 'Staff workspace'}</span>
              <h1>{currentEateryName} staff console</h1>
              <p className="lead">Kitchen operations and management tools are separated from the guest ordering experience.</p>
            </div>

            <div className="view-switcher">
              <button type="button" className={view === 'kitchen' ? 'active' : ''} onClick={() => setView('kitchen')}>
                Kitchen
              </button>
              <button type="button" className={view === 'admin' ? 'active' : ''} onClick={() => setView('admin')}>
                Admin
              </button>
            </div>
          </div>

          <div className="hero-grid">
            <div>
              <div className="hero-actions">
                <button type="button" onClick={() => setView('customer')}>
                  Open customer ordering
                </button>
                <a href={selectedTableLink}>Open current guest link</a>
              </div>
            </div>

            <div className="stat-card">
              <span>Operations snapshot</span>
              <strong>{activeOrders.length}</strong>
              <p>
                active tickets • {store.tables.length} service points • {formatCurrency(todayTotal)} tracked volume
              </p>
            </div>
          </div>

          {loadError ? (
            <div className="panel flat">
              <strong>Could not load staff data</strong>
              <p>{loadError}</p>
            </div>
          ) : null}
        </header>
      )}

      {isLoading ? (
        <section className="panel">
          <h2>Loading data...</h2>
          <p>Please wait while Dine Flow loads tables, menu items, and current tickets.</p>
        </section>
      ) : null}

      {!isLoading && view === 'customer' ? renderCustomerView() : null}
      {!isLoading && view === 'kitchen' ? renderKitchenView() : null}
      {!isLoading && view === 'admin' ? renderAdminView() : null}
    </main>
  )
}

export default App