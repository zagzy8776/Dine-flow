import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import type { AppMode, CartLine, Eatery, MenuItem, Order, OrderStatus, StaffProfile, StaffRole, Store, View } from './app-types'
import { emptyStore, getInitialTableId, getInitialView, initialStore, loadDemoStore, STORAGE_KEY } from './demo-data'
import {
  bootstrapApp,
  createMenuItem as createMenuItemRequest,
  createTable as createTableRequest,
  deleteMenuItem as deleteMenuItemRequest,
  fetchTableOrders,
  hasApiMode,
  loginStaff,
  logoutStaff,
  setMenuItemAvailability,
  submitGuestOrder,
  updateOrderStatus as updateOrderStatusRequest,
} from './lib/api'

const EATERY_SLUG = String(import.meta.env.VITE_EATERY_SLUG ?? 'dine-flow').trim()
const EATERY_NAME = String(import.meta.env.VITE_EATERY_NAME ?? 'Dine Flow').trim() || 'Dine Flow'

const statusLabels: Record<OrderStatus, string> = {
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

const statusFlow: OrderStatus[] = ['received', 'preparing', 'ready', 'served']
const staffViewRoles: StaffRole[] = ['owner', 'admin', 'kitchen', 'waiter']
const managementRoles: StaffRole[] = ['owner', 'admin']
const recommendedServicePoints = [
  { label: 'Pickup Counter', seats: 1 },
  { label: 'Delivery Dispatch', seats: 1 },
] as const

type FulfillmentMode = 'dine-in' | 'offsite'

function formatCurrency(value: number) {
  return `₦${new Intl.NumberFormat('en-NG').format(value)}`
}

function getOrderTotal(order: Order) {
  return order.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
}

function getStatusClass(status: OrderStatus) {
  if (status === 'preparing') return 'status-preparing'
  if (status === 'ready') return 'status-ready'
  return ''
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

function buildGuestOrderNote(params: {
  fulfillmentMode: FulfillmentMode
  customerNote: string
  offsiteContact: string
  offsiteDetails: string
}) {
  const noteParts: string[] = []

  if (params.fulfillmentMode === 'offsite') {
    noteParts.push('Off-site guest order')

    if (params.offsiteContact.trim()) {
      noteParts.push(`Contact: ${params.offsiteContact.trim()}`)
    }

    if (params.offsiteDetails.trim()) {
      noteParts.push(`Pickup / delivery details: ${params.offsiteDetails.trim()}`)
    }
  }

  if (params.customerNote.trim()) {
    noteParts.push(params.fulfillmentMode === 'offsite' ? `Customer note: ${params.customerNote.trim()}` : params.customerNote.trim())
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
  const [cart, setCart] = useState<CartLine[]>([])
  const [category, setCategory] = useState('All')
  const [toast, setToast] = useState('')
  const [loadError, setLoadError] = useState('')
  const [isLoading, setIsLoading] = useState(mode === 'api')
  const [isSaving, setIsSaving] = useState(false)
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
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
  const currentEateryName = eatery?.name ?? EATERY_NAME
  const canUseKitchen = mode === 'demo' || Boolean(staffProfile && staffViewRoles.includes(staffProfile.role))
  const canManage = mode === 'demo' || Boolean(staffProfile && managementRoles.includes(staffProfile.role))
  const canAccessAdminWorkspace = mode === 'demo' || sessionEmail.length > 0
  const canViewAdminContent = mode === 'demo' || canManage
  const customerViewTableOptions = useMemo(() => store.tables.filter((table) => !isOffsiteOrderingPoint(table.label)), [store.tables])
  const offsiteOrderingOptions = useMemo(() => store.tables.filter((table) => isOffsiteOrderingPoint(table.label)), [store.tables])

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
  const defaultOffsiteTableId = offsiteOrderingOptions[0]?.id ?? ''
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

    const activeTable =
      fulfillmentMode === 'offsite'
        ? store.tables.find((table) => table.id === resolvedSelectedTableId && isOffsiteOrderingPoint(table.label)) ?? offsiteOrderingOptions[0]
        : store.tables.find((table) => table.id === resolvedSelectedTableId && !isOffsiteOrderingPoint(table.label)) ?? customerViewTableOptions[0]

    if (!activeTable) {
      setToast(
        fulfillmentMode === 'offsite'
          ? 'Please create a Pickup Counter or Delivery Dispatch point in Admin before taking off-site orders.'
          : 'Please create or select a dine-in table first.',
      )
      return
    }

    if (cartItems.length === 0) {
      setToast('Add at least one item before submitting.')
      return
    }

    const guestOrderNote = buildGuestOrderNote({
      fulfillmentMode,
      customerNote,
      offsiteContact,
      offsiteDetails,
    })

    if (mode === 'api') {
      setIsSaving(true)
      try {
        const result = await submitGuestOrder({
          slug: EATERY_SLUG,
          tableId: activeTable.id,
          customerName: customerName.trim() || 'Guest',
          note: guestOrderNote || undefined,
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
        setToast(`Order ${shortOrderId(result.orderId)} sent to kitchen for ${activeTable.label}.`)
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
      customerName: customerName.trim() || 'Guest',
      items: cartItems.map(({ menuItem, quantity, note }) => ({
        menuItemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        quantity,
        note: note.trim() || undefined,
      })),
      status: 'received',
      note: guestOrderNote || undefined,
      createdAt: now,
      updatedAt: now,
    }

    setStore((current) => ({ ...current, orders: [order, ...current.orders] }))
    setCart([])
    setCustomerNote('')
    setOffsiteContact('')
    setOffsiteDetails('')
    setToast(`Order ${order.id} sent to kitchen for ${activeTable.label}.`)
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
    const customerSelectableTables = fulfillmentMode === 'offsite' ? offsiteOrderingOptions : customerViewTableOptions
    const currentCustomerTable = customerSelectableTables.find((table) => table.id === resolvedSelectedTableId) ?? customerSelectableTables[0]

    return (
      <section className="content-grid">
        <div className="content-stack">
          <section className="panel">
            <div className="section-title">
              <div>
                <span className="eyebrow">Guest ordering</span>
                <h2>Browse the menu</h2>
                <p>
                  {fulfillmentMode === 'offsite'
                    ? 'Order for pickup or delivery without being physically inside the eatery.'
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
                className={fulfillmentMode === 'offsite' ? 'active' : ''}
                onClick={() => {
                  setFulfillmentMode('offsite')
                  if (defaultOffsiteTableId) {
                    setSelectedTableId(defaultOffsiteTableId)
                  }
                }}
              >
                Pickup / delivery
              </button>
            </div>

            <div className="customer-meta-grid">
              {fulfillmentMode === 'dine-in' ? (
                <label>
                  Table
                  <select value={currentCustomerTable?.id ?? ''} onChange={(event) => setSelectedTableId(event.target.value)}>
                    {customerSelectableTables.map((table) => (
                      <option key={table.id} value={table.id}>
                        {table.label} • {table.seats} seats
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label>
                    Service point
                    <select value={currentCustomerTable?.id ?? ''} onChange={(event) => setSelectedTableId(event.target.value)}>
                      {customerSelectableTables.map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Phone or contact
                    <input
                      value={offsiteContact}
                      onChange={(event) => setOffsiteContact(event.target.value)}
                      placeholder="0800 000 0000"
                    />
                  </label>

                  <label className="wide-field">
                    Address or pickup details
                    <textarea
                      value={offsiteDetails}
                      onChange={(event) => setOffsiteDetails(event.target.value)}
                      placeholder="Delivery address, landmark, or preferred pickup time"
                    />
                  </label>
                </>
              )}
            </div>

            {customerSelectableTables.length === 0 ? (
              <div className="panel flat customer-helper-note">
                <strong>
                  {fulfillmentMode === 'offsite' ? 'No off-site order point is set up yet.' : 'No dine-in tables are available yet.'}
                </strong>
                <p>
                  {fulfillmentMode === 'offsite'
                    ? 'Ask the admin to create a Pickup Counter or Delivery Dispatch point so guests outside the restaurant can order.'
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
                    <button type="button" onClick={() => addToCart(item.id)} disabled={!item.available}>
                      {item.available ? 'Add to cart' : 'Unavailable'}
                    </button>
                  </div>
                </article>
              ))}

              {filteredMenu.length === 0 ? <p className="empty">No menu items found in this category yet.</p> : null}
            </div>
          </section>

          <details className="panel history-panel">
            <summary>
              {fulfillmentMode === 'offsite' ? 'Recent orders for this service point' : 'Recent orders for this table'} ({selectedTableOrders.length})
            </summary>
            <div className="history-list">
              {selectedTableOrders.length === 0 ? (
                <p className="empty">
                  {fulfillmentMode === 'offsite' ? 'This pickup / delivery point has no orders yet.' : 'This table has no orders yet.'}
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
          <form onSubmit={submitOrder}>
            <label>
              Customer name
              <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Guest" />
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
              {fulfillmentMode === 'offsite' ? 'Order note' : 'General note to kitchen'}
              <textarea
                value={customerNote}
                onChange={(event) => setCustomerNote(event.target.value)}
                placeholder={
                  fulfillmentMode === 'offsite'
                    ? 'Anything the kitchen or dispatch rider should know?'
                    : 'Anything the kitchen should know for this table?'
                }
              />
            </label>

            <div className="payment-note">
              Payment is not collected in the app. Your team can complete payment with the existing POS, cashier flow, or delivery confirmation process.
            </div>

            <div className="total-row">
              <span>Total</span>
              <strong>{formatCurrency(cartTotal)}</strong>
            </div>

            <button className="submit-button" type="submit" disabled={isSaving || cartItems.length === 0 || !currentCustomerTable}>
              {isSaving
                ? 'Sending order...'
                : `Send order${currentCustomerTable ? ` for ${currentCustomerTable.label}` : ''}`}
            </button>
          </form>
        </aside>
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
                <article key={order.id} className={`panel order-card ${getStatusClass(order.status)}`}>
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
                  </div>
                ))}
              </div>
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
                    setFulfillmentMode('offsite')
                    if (defaultOffsiteTableId) {
                      setSelectedTableId(defaultOffsiteTableId)
                    }
                  }}
                >
                  Order from outside
                </button>
              </div>
            </div>

            <div className="stat-card">
              <span>Guest options</span>
              <strong>{customerViewTableOptions.length + offsiteOrderingOptions.length}</strong>
              <p>
                dine-in tables and service points available for {currentEateryName}
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