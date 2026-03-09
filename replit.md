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
2. **Products** - Import products from WooCommerce, manage ingredient lists per product
3. **Product Totals** - Date-filterable summary of products ordered (online + manual/shop quantities)
4. **Ingredient Summary** - Calculates total ingredient quantities needed based on orders
5. **Manual Stock** - Input quantities for items sold in local shops or non-website orders
6. **Delivery Routes** - Planned delivery route starting from Unit 33 depot (Glasgow G45 9EE), showing only delivery customers on map with nearest-neighbor optimization; customer breakdown shows delivery/collection counts
7. **Settings** - Configurable auto-sync interval, sync enable/disable, order window (default: Sat noon to Wed midnight), logo upload (branding), user management (add/delete users)

## Data Model
- `products` - Products with optional WooCommerce ID, name, price, image
- `ingredients` - Per-product ingredients with quantity per unit and unit
- `orders` - Orders (WooCommerce or manual) with customer, address, geocoordinates, fulfillmentType (delivery/collection)
- `order_items` - Line items per order
- `manual_quantities` - Manual stock entries per product
- `settings` - Key-value store for app configuration (sync interval, order window, logo, etc.)
- `users` - Portal users with hashed passwords (UUID primary key)

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

## File Structure
- `shared/schema.ts` - Drizzle schema + Zod validators + TypeScript types
- `server/db.ts` - Database connection
- `server/storage.ts` - Data access layer (DatabaseStorage class)
- `server/woocommerce.ts` - WooCommerce API client
- `server/routes.ts` - Express API routes
- `client/src/pages/` - Page components (orders, products, product-totals, ingredients, manual-stock, delivery-routes, settings)
- `client/src/components/` - Shared components (app-sidebar, theme-provider, theme-toggle)

## Delivery/Collection Detection
- Uses WooCommerce `shipping_lines[0].method_id`: `flat_rate` = Delivery, `free_shipping` = Collection
- Stored in `orders.fulfillment_type` column, populated during sync
- Shown as badge on Orders page and used in Delivery Routes page breakdown

## Date Filtering
- Default date window: most recent Saturday → following Wednesday (order window), UK/London timezone
- All pages use shared `DateFilter`/`useDateFilter` components with Sat–Wed/Month/Custom modes
- Navigation arrows step by 7 days (one week)

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
