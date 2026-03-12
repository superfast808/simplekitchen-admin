# Partner Portal - WooCommerce Food Ordering Manager

## Overview
A partner portal for managing food orders from a WooCommerce store. It imports orders and products from WooCommerce, tracks ingredients, handles manual stock entries for local shops, and plans delivery routes using OpenStreetMap.

## Architecture
- **Frontend**: React + TypeScript + Vite, TailwindCSS, shadcn/ui components
- **Backend**: Express.js API server
- **Database**: PostgreSQL via Drizzle ORM
- **External APIs**: WooCommerce REST API v3, OpenStreetMap Nominatim (geocoding), Leaflet (maps)

## Key Features
1. **Orders View** - Weekly view of all orders (WooCommerce + manual), with product columns, bold TOTAL row at bottom, XLSX export, and printable address labels PDF (L7173/J8173 format, 99.1×57mm, 10 per A4 page)
2. **Products** - Import products from WooCommerce (with category sync), manage ingredient lists per product
3. **Product Totals** - Date-filterable summary of products ordered (online + manual/shop quantities)
4. **Ingredient Summary** - Calculates total ingredient quantities needed based on orders
5. **Manual Stock** - Input quantities for items sold in local shops or non-website orders
6. **Delivery Routes** - Planned delivery route starting from Unit 33 depot (Glasgow G45 9EE), showing only delivery customers on map with nearest-neighbor optimization; customer breakdown shows delivery/collection counts
7. **Weekly Stats** - Dashboard-style page with 8 stat cards: meals sold, revenue, avg order value, delivery stops, new/returning customers, top/worst sellers. Week navigation with chevrons, current week visible until Saturday noon then auto-shows previous week
8. **Subscriptions** - Send weekly meal preference emails to subscription customers; customers use a public link to select meals (up to their sub qty) from WooCommerce "Week N" categorised products; add-ons (non-£7.50 "Week N" products) shown separately; selections auto-create orders; admin overview shows who's chosen/waiting; override email for testing
9. **Settings** - Configurable auto-sync interval, sync enable/disable, order window (default: Sat noon to Wed midnight), logo upload (branding), user management (add/delete users), **week rotation** (set Week 1 reference date; week number 1-6 auto-advances every Saturday noon)

## Data Model
- `products` - Products with optional WooCommerce ID, name, price, image, category (synced from WooCommerce categories, e.g. "Week 1")
- `ingredients` - Per-product ingredients with quantity per unit and unit
- `orders` - Orders (WooCommerce or manual) with customer, address, geocoordinates, fulfillmentType (delivery/collection)
- `order_items` - Line items per order
- `manual_quantities` - Manual stock entries per product
- `settings` - Key-value store for app configuration (sync interval, order window, logo, etc.)
- `users` - Portal users with hashed passwords (UUID primary key)
- `subscription_invites` - Weekly meal preference invitations sent to subscription customers (token-based, tracks status)
- `subscription_selections` - Selected meals per invite (linked to invites, creates order on submit)

## Authentication
- Session-based auth using `express-session` with `SESSION_SECRET` env var
- Passwords hashed with `bcrypt`
- Default admin user seeded on startup (username: `admin`, password: `admin`) if no users exist
- Auth middleware protects all `/api/*` routes except `/api/auth/*`
- Login page shown when not authenticated; logout button in header
- User management (add/delete) available in Settings page

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Session encryption secret
- `WC_STORE_URL` - WooCommerce store URL
- `WC_CONSUMER_KEY` - WooCommerce API consumer key
- `WC_CONSUMER_SECRET` - WooCommerce API consumer secret
- `SMTP_HOST` - SMTP server hostname
- `SMTP_PORT` - SMTP port (587 or 465)
- `SMTP_USER` - SMTP username
- `SMTP_PASS` - SMTP password
- `SMTP_FROM_EMAIL` - From address for outgoing emails

## File Structure
- `shared/schema.ts` - Drizzle schema + Zod validators + TypeScript types
- `server/db.ts` - Database connection
- `server/storage.ts` - Data access layer (DatabaseStorage class)
- `server/woocommerce.ts` - WooCommerce API client
- `server/routes.ts` - Express API routes
- `client/src/pages/` - Page components (orders, products, product-totals, ingredients, manual-stock, delivery-routes, settings)
- `client/src/components/` - Shared components (app-sidebar, date-filter, order-source-filter, theme-provider, theme-toggle)

## Delivery/Collection Detection
- Uses WooCommerce `shipping_lines[0].method_id`: `flat_rate` = Delivery, `free_shipping` = Collection
- Stored in `orders.fulfillment_type` column, populated during sync
- Shown as badge on Orders page and used in Delivery Routes page breakdown

## Date Filtering
- Default date window: most recent Saturday → following Wednesday (order window), UK/London timezone
- All pages use shared `DateFilter`/`useDateFilter` components with Sat–Wed/Month/Custom modes
- Navigation arrows step by 7 days (one week)

## Order Source Filtering
- Reusable `OrderSourceFilter` component with checkboxes: Website, Tuesday, Manual + All/None buttons
- Used on Orders (client-side filter), Product Totals (server-side), Ingredients (server-side)
- Backend endpoints accept `?source=website,tuesday,manual` query param for server-side filtering
- Categories: Website = WooCommerce synced (!isManual), Tuesday = isTuesday flag, Manual = isManual && !isTuesday
- Tuesday orders: `isTuesday` boolean on orders table, set via toggle in manual order dialogs and auto-set by Tuesday recurring order generator

## Auto-Sync
- Runs every N minutes (configurable via Settings page, default 60)
- Syncs last 4 weeks of orders from WooCommerce on each run
- Initial sync runs 5 seconds after server start
- Order window: Saturday 12:00 PM to Wednesday midnight (configurable)

## NPM Packages
- `xlsx` - XLSX export for orders table
- `pdfkit` - PDF generation for printable address labels
- `date-fns` - Date formatting and manipulation
- `leaflet` / `react-leaflet` - Map rendering for delivery routes
- `drizzle-orm` / `drizzle-zod` - ORM and validation
- `bcrypt` - Password hashing
- `express-session` - Session management
- `multer` - File upload handling (logo)
- Currency: GBP (£) throughout
