import http from 'node:http'
import { createHash, scryptSync, timingSafeEqual } from 'node:crypto'
import { neon } from '@neondatabase/serverless'

const PORT = Number(process.env.PORT || 4000)
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim()
const FRONTEND_ORIGIN = String(process.env.FRONTEND_ORIGIN || '').trim()
const SESSION_COOKIE_NAME = 'dineflow_session'
const ORDER_STATUSES = new Set(['received', 'preparing', 'ready', 'served', 'cancelled'])

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the Render backend.')
}

const sql = neon(DATABASE_URL)

function getCorsHeaders(origin) {
  const allowOrigin = FRONTEND_ORIGIN && origin === FRONTEND_ORIGIN ? origin : FRONTEND_ORIGIN || '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': allowOrigin === '*' ? 'false' : 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    Vary: 'Origin',
  }
}

function sendJson(response, status, payload, origin = '') {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...getCorsHeaders(origin),
  })
  response.end(body)
}

function parseCookies(cookieHeader = '') {
  const cookies = {}
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (!rawKey) continue
    cookies[rawKey] = decodeURIComponent(rawValue.join('='))
  }
  return cookies
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []

    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })
    request.on('error', reject)
  })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function verifyPassword(password, passwordHash) {
  const [algorithm, salt, derived] = String(passwordHash || '').split(':')
  if (algorithm !== 'scrypt' || !salt || !derived) return false

  const expected = Buffer.from(derived, 'hex')
  const actual = scryptSync(password, salt, expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function buildSetCookie(token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  if (!token) {
    return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  }

  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 7}${secure}`
}

async function getEateryBySlug(slug) {
  const rows = await sql`
    select id, name, slug
    from eateries
    where slug = ${slug}
    limit 1
  `

  return rows[0] ?? null
}

function mapOrderRow(row) {
  const items = Array.isArray(row.items) ? row.items : typeof row.items === 'string' ? JSON.parse(row.items) : []
  return {
    id: row.id,
    tableId: row.table_id,
    tableLabel: row.table_label,
    customerName: row.customer_name,
    status: row.status,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      menuItemId: item.menu_item_id,
      name: item.item_name,
      price: Number(item.unit_price),
      quantity: Number(item.quantity),
      note: item.note ?? undefined,
    })),
  }
}

async function getOrdersForEatery(eateryId) {
  const rows = await sql`
    select
      o.id,
      o.table_id,
      t.label as table_label,
      o.customer_name,
      o.status,
      o.note,
      o.created_at,
      o.updated_at,
      coalesce(
        json_agg(
          json_build_object(
            'menu_item_id', oi.menu_item_id,
            'item_name', oi.item_name,
            'unit_price', oi.unit_price,
            'quantity', oi.quantity,
            'note', oi.note
          )
          order by oi.created_at asc
        ) filter (where oi.id is not null),
        '[]'::json
      ) as items
    from orders o
    join eatery_tables t on t.id = o.table_id
    left join order_items oi on oi.order_id = o.id
    where o.eatery_id = ${eateryId}
    group by o.id, t.label
    order by o.created_at desc
    limit 150
  `

  return rows.map(mapOrderRow)
}

async function getOrdersForTable(eateryId, tableId) {
  const rows = await sql`
    select
      o.id,
      o.table_id,
      t.label as table_label,
      o.customer_name,
      o.status,
      o.note,
      o.created_at,
      o.updated_at,
      coalesce(
        json_agg(
          json_build_object(
            'menu_item_id', oi.menu_item_id,
            'item_name', oi.item_name,
            'unit_price', oi.unit_price,
            'quantity', oi.quantity,
            'note', oi.note
          )
          order by oi.created_at asc
        ) filter (where oi.id is not null),
        '[]'::json
      ) as items
    from orders o
    join eatery_tables t on t.id = o.table_id
    left join order_items oi on oi.order_id = o.id
    where o.eatery_id = ${eateryId}
      and o.table_id = ${tableId}
    group by o.id, t.label
    order by o.created_at desc
    limit 20
  `

  return rows.map(mapOrderRow)
}

async function getMenuForEatery(eateryId) {
  const rows = await sql`
    select id, name, category, description, price, available, prep_minutes
    from menu_items
    where eatery_id = ${eateryId}
    order by category asc, name asc
  `

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description ?? '',
    price: Number(row.price),
    available: row.available,
    prepMinutes: row.prep_minutes,
  }))
}

async function getTablesForEatery(eateryId) {
  const rows = await sql`
    select id, label, seats
    from eatery_tables
    where eatery_id = ${eateryId}
      and active = true
    order by label asc
  `

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    seats: row.seats,
  }))
}

async function getSessionContext(request) {
  const cookies = parseCookies(request.headers.cookie || '')
  const token = cookies[SESSION_COOKIE_NAME]
  if (!token) return null

  const tokenHash = sha256(token)
  const rows = await sql`
    select
      ss.id,
      ss.expires_at,
      sm.id as staff_member_id,
      sm.role,
      sm.eatery_id,
      sm.email
    from staff_sessions ss
    join staff_members sm on sm.id = ss.staff_member_id
    where ss.token_hash = ${tokenHash}
      and ss.expires_at > now()
      and sm.active = true
    limit 1
  `

  return rows[0] ?? null
}

async function requireStaff(request, response, slug, roles, origin) {
  const eatery = await getEateryBySlug(slug)
  if (!eatery) {
    sendJson(response, 404, { error: 'Eatery not found.' }, origin)
    return null
  }

  const session = await getSessionContext(request)
  if (!session || session.eatery_id !== eatery.id) {
    sendJson(response, 401, { error: 'Staff sign-in required.' }, origin)
    return null
  }

  if (roles.length > 0 && !roles.includes(session.role)) {
    sendJson(response, 403, { error: 'You do not have permission to perform this action.' }, origin)
    return null
  }

  return { eatery, session }
}

async function handleBootstrap(request, response, url, origin) {
  const slug = String(url.searchParams.get('slug') || '').trim()
  if (!slug) {
    sendJson(response, 400, { error: 'slug is required.' }, origin)
    return
  }

  const eatery = await getEateryBySlug(slug)
  if (!eatery) {
    sendJson(response, 404, { error: `No eatery found for slug "${slug}".` }, origin)
    return
  }

  const session = await getSessionContext(request)
  const [menu, tables, orders] = await Promise.all([
    getMenuForEatery(eatery.id),
    getTablesForEatery(eatery.id),
    session && session.eatery_id === eatery.id ? getOrdersForEatery(eatery.id) : Promise.resolve([]),
  ])

  sendJson(
    response,
    200,
    {
      eatery,
      session: session ? { email: session.email } : null,
      staffProfile: session && session.eatery_id === eatery.id ? { eateryId: session.eatery_id, role: session.role } : null,
      store: { menu, tables, orders },
    },
    origin,
  )
}

async function handleTableOrders(response, url, origin) {
  const slug = String(url.searchParams.get('slug') || '').trim()
  const tableId = String(url.searchParams.get('tableId') || '').trim()

  if (!slug || !tableId) {
    sendJson(response, 400, { error: 'slug and tableId are required.' }, origin)
    return
  }

  const eatery = await getEateryBySlug(slug)
  if (!eatery) {
    sendJson(response, 404, { error: 'Eatery not found.' }, origin)
    return
  }

  const orders = await getOrdersForTable(eatery.id, tableId)
  sendJson(response, 200, { orders }, origin)
}

async function handleLogin(request, response, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const email = String(body?.email || '').trim().toLowerCase()
  const password = String(body?.password || '')

  if (!slug || !email || !password) {
    sendJson(response, 400, { error: 'slug, email and password are required.' }, origin)
    return
  }

  const eatery = await getEateryBySlug(slug)
  if (!eatery) {
    sendJson(response, 404, { error: 'Eatery not found.' }, origin)
    return
  }

  const rows = await sql`
    select id, eatery_id, email, password_hash, role
    from staff_members
    where eatery_id = ${eatery.id}
      and lower(email) = ${email}
      and active = true
    limit 1
  `

  const staffMember = rows[0]
  if (!staffMember || !verifyPassword(password, staffMember.password_hash)) {
    sendJson(response, 401, { error: 'Invalid email or password.' }, origin)
    return
  }

  const rawToken = `${Date.now()}-${Math.random()}-${staffMember.id}`
  const sessionToken = sha256(rawToken)
  const tokenHash = sha256(sessionToken)

  await sql`
    insert into staff_sessions (staff_member_id, token_hash, expires_at)
    values (${staffMember.id}, ${tokenHash}, now() + interval '7 days')
  `

  response.setHeader('Set-Cookie', buildSetCookie(sessionToken))
  sendJson(response, 200, { ok: true, message: 'Signed in.' }, origin)
}

async function handleLogout(request, response, origin) {
  const cookies = parseCookies(request.headers.cookie || '')
  const token = cookies[SESSION_COOKIE_NAME]
  if (token) {
    const tokenHash = sha256(token)
    await sql`delete from staff_sessions where token_hash = ${tokenHash}`
  }

  response.setHeader('Set-Cookie', buildSetCookie(''))
  sendJson(response, 200, { ok: true }, origin)
}

async function handleCreateOrder(request, response, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const tableId = String(body?.tableId || '').trim()
  const customerName = String(body?.customerName || 'Guest').trim() || 'Guest'
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  const items = Array.isArray(body?.items) ? body.items : []

  if (!slug || !tableId || items.length === 0) {
    sendJson(response, 400, { error: 'slug, tableId and at least one item are required.' }, origin)
    return
  }

  const eatery = await getEateryBySlug(slug)
  if (!eatery) {
    sendJson(response, 404, { error: 'Eatery not found.' }, origin)
    return
  }

  const tableRows = await sql`
    select id
    from eatery_tables
    where id = ${tableId}
      and eatery_id = ${eatery.id}
      and active = true
    limit 1
  `

  if (tableRows.length === 0) {
    sendJson(response, 400, { error: 'Selected table is invalid.' }, origin)
    return
  }

  const menuItemIds = items.map((item) => String(item.menuItemId || '').trim()).filter(Boolean)
  const menuRows = menuItemIds.length
    ? await sql`
        select id, name, price, available
        from menu_items
        where eatery_id = ${eatery.id}
          and id = any(${menuItemIds})
      `
    : []

  const menuMap = new Map(menuRows.map((row) => [row.id, row]))
  for (const item of items) {
    const menuRow = menuMap.get(String(item.menuItemId || ''))
    const quantity = Number(item.quantity)
    if (!menuRow || !menuRow.available || Number.isNaN(quantity) || quantity <= 0) {
      sendJson(response, 400, { error: 'One or more selected menu items are invalid or unavailable.' }, origin)
      return
    }
  }

  const orderRows = await sql`
    insert into orders (eatery_id, table_id, customer_name, status, note)
    values (${eatery.id}, ${tableId}, ${customerName}, 'received', ${note || null})
    returning id
  `

  const orderId = orderRows[0].id
  for (const item of items) {
    const menuRow = menuMap.get(String(item.menuItemId))
    await sql`
      insert into order_items (order_id, menu_item_id, item_name, unit_price, quantity, note)
      values (
        ${orderId},
        ${menuRow.id},
        ${menuRow.name},
        ${menuRow.price},
        ${Number(item.quantity)},
        ${typeof item.note === 'string' && item.note.trim() ? item.note.trim() : null}
      )
    `
  }

  sendJson(response, 201, { orderId }, origin)
}

async function handleUpdateOrderStatus(request, response, orderId, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const status = String(body?.status || '').trim()

  if (!slug || !ORDER_STATUSES.has(status)) {
    sendJson(response, 400, { error: 'Valid slug and status are required.' }, origin)
    return
  }

  const context = await requireStaff(request, response, slug, ['owner', 'admin', 'kitchen', 'waiter'], origin)
  if (!context) return

  await sql`
    update orders
    set status = ${status}, updated_at = now()
    where id = ${orderId}
      and eatery_id = ${context.eatery.id}
  `

  sendJson(response, 200, { ok: true }, origin)
}

async function handleCreateMenuItem(request, response, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const context = await requireStaff(request, response, slug, ['owner', 'admin'], origin)
  if (!context) return

  const name = String(body?.name || '').trim()
  const category = String(body?.category || '').trim()
  const description = String(body?.description || '').trim()
  const price = Number(body?.price)
  const prepMinutes = Number(body?.prepMinutes)

  if (!name || !category || Number.isNaN(price) || price <= 0 || Number.isNaN(prepMinutes) || prepMinutes <= 0) {
    sendJson(response, 400, { error: 'Invalid menu item payload.' }, origin)
    return
  }

  const rows = await sql`
    insert into menu_items (eatery_id, name, category, description, price, prep_minutes, available)
    values (${context.eatery.id}, ${name}, ${category}, ${description || null}, ${price}, ${prepMinutes}, true)
    returning id
  `

  sendJson(response, 201, { ok: true, id: rows[0].id }, origin)
}

async function handleSetMenuAvailability(request, response, menuItemId, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const available = Boolean(body?.available)
  const context = await requireStaff(request, response, slug, ['owner', 'admin'], origin)
  if (!context) return

  await sql`
    update menu_items
    set available = ${available}, updated_at = now()
    where id = ${menuItemId}
      and eatery_id = ${context.eatery.id}
  `

  sendJson(response, 200, { ok: true }, origin)
}

async function handleDeleteMenuItem(request, response, menuItemId, url, origin) {
  const slug = String(url.searchParams.get('slug') || '').trim()
  const context = await requireStaff(request, response, slug, ['owner', 'admin'], origin)
  if (!context) return

  await sql`
    delete from menu_items
    where id = ${menuItemId}
      and eatery_id = ${context.eatery.id}
  `

  sendJson(response, 200, { ok: true }, origin)
}

async function handleCreateTable(request, response, origin) {
  const body = await readBody(request)
  const slug = String(body?.slug || '').trim()
  const context = await requireStaff(request, response, slug, ['owner', 'admin'], origin)
  if (!context) return

  const label = String(body?.label || '').trim()
  const seats = Number(body?.seats)
  if (!label || Number.isNaN(seats) || seats <= 0) {
    sendJson(response, 400, { error: 'Invalid table payload.' }, origin)
    return
  }

  const rows = await sql`
    insert into eatery_tables (eatery_id, label, seats, active)
    values (${context.eatery.id}, ${label}, ${seats}, true)
    returning id
  `

  sendJson(response, 201, { ok: true, id: rows[0].id }, origin)
}

const server = http.createServer(async (request, response) => {
  const origin = String(request.headers.origin || '')

  if (request.method === 'OPTIONS') {
    response.writeHead(204, getCorsHeaders(origin))
    response.end()
    return
  }

  if (!request.url) {
    sendJson(response, 404, { error: 'Not found.' }, origin)
    return
  }

  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)

  try {
    if (request.method === 'GET' && url.pathname === '/healthz') {
      sendJson(response, 200, { ok: true }, origin)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      await handleBootstrap(request, response, url, origin)
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/table-orders') {
      await handleTableOrders(response, url, origin)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/staff/login') {
      await handleLogin(request, response, origin)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/staff/logout') {
      await handleLogout(request, response, origin)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/orders') {
      await handleCreateOrder(request, response, origin)
      return
    }

    if (request.method === 'PATCH' && /^\/api\/orders\/[^/]+\/status$/.test(url.pathname)) {
      const orderId = url.pathname.split('/')[3]
      await handleUpdateOrderStatus(request, response, orderId, origin)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/menu-items') {
      await handleCreateMenuItem(request, response, origin)
      return
    }

    if (request.method === 'PATCH' && /^\/api\/menu-items\/[^/]+\/availability$/.test(url.pathname)) {
      const menuItemId = url.pathname.split('/')[3]
      await handleSetMenuAvailability(request, response, menuItemId, origin)
      return
    }

    if (request.method === 'DELETE' && /^\/api\/menu-items\/[^/]+$/.test(url.pathname)) {
      const menuItemId = url.pathname.split('/')[3]
      await handleDeleteMenuItem(request, response, menuItemId, url, origin)
      return
    }

    if (request.method === 'POST' && url.pathname === '/api/tables') {
      await handleCreateTable(request, response, origin)
      return
    }

    sendJson(response, 404, { error: 'Not found.' }, origin)
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Internal server error.' }, origin)
  }
})

server.listen(PORT, () => {
  console.log(`DineFlow API listening on port ${PORT}`)
})