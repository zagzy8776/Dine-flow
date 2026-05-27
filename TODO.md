# DineFlow - Production Reassessment TODO

- [ ] Replace truncated `src/App.tsx` with full production-ready React/Supabase UI:
  - [ ] Customer ordering screen (menu, cart, submit guest order)
  - [ ] Kitchen board (received/preparing/ready/served, status update, optional cancel)
  - [ ] Admin dashboard (staff auth panel, menu CRUD, table CRUD, availability toggles)
  - [ ] Supabase auth handlers + role-based gating (staff_members.role)
  - [ ] Supabase realtime updates for orders/menu/items/tables
  - [ ] Demo/local helpers + local persistence
  - [ ] Data mappers for Supabase row -> internal store types
  - [ ] Export default App

- [ ] Rewrite `database/schema.sql` to match app expectations:
  - [ ] Add `staff_members`
  - [ ] Add RLS policies for guests/staff/admin
  - [ ] Implement `submit_guest_order` RPC
  - [ ] Ensure `updated_at` behavior + triggers where needed
  - [ ] Confirm/adjust indexes and foreign keys
  - [ ] Update demo seed data

- [ ] Update `.env.example`, `README.md`, and CSS:
  - [ ] `.env.example` variables used by `App.tsx`
  - [ ] README “Next engineering step” / setup guidance for auth + realtime + roles
  - [ ] CSS tweaks if any UI sections need styling

- [ ] Validate build:
  - [ ] `npm install` if needed (tsc missing in prior run)
  - [ ] `npm run typecheck`
  - [ ] `npm run lint`
  - [ ] `npm run build`
