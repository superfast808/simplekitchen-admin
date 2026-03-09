# Partner Portal - WooCommerce Food Ordering Manager

## Overview
A partner portal for managing food orders from a WooCommerce store. It imports orders and products from WooCommerce, tracks ingredients, handles manual stock entries for local shops, and plans delivery routes using OpenStreetMap.

## Architecture
- **Frontend**: React + TypeScript + Vite, TailwindCSS, shadcn/ui components
- **Backend**: Express.js API server
- **Database**: PostgreSQL via Drizzle ORM
- **External APIs**: WooCommerce REST API v3, OpenStreetMap Nominatim (geocoding), Leaflet (maps)

## Key Features
1. **Orders View** - Weekly view of all orders (WooCommerce + manual), with items in columns, customer name, delivery address, status
2. **Products** - Import products from WooCommerce, manage ingredient lists per product
3. **Product Totals** - Date-filterable summary of products ordered (online + manual/shop quantities)
4. **Ingredient Summary** - Calculates total ingredient quantities needed based on orders
5. **Manual Stock** - Input quantities for items sold in local shops or non-website orders
6. **Delivery Routes** - OSM map with geocoded addresses and nearest-neighbor route optimization

## Data Model
- `products` - Products with optional WooCommerce ID, name, price, image
- `ingredients` - Per-product ingredients with quantity per unit and unit
- `orders` - Orders (WooCommerce or manual) with customer, address, geocoordinates
- `order_items` - Line items per order
- `manual_quantities` - Manual stock entries per product

## Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `WC_STORE_URL` - WooCommerce store URL
- `WC_CONSUMER_KEY` - WooCommerce API consumer key
- `WC_CONSUMER_SECRET` - WooCommerce API consumer secret

## File Structure
- `shared/schema.ts` - Drizzle schema + Zod validators + TypeScript types
- `server/db.ts` - Database connection
- `server/storage.ts` - Data access layer (DatabaseStorage class)
- `server/woocommerce.ts` - WooCommerce API client
- `server/routes.ts` - Express API routes
- `client/src/pages/` - Page components (orders, products, product-totals, ingredients, manual-stock, delivery-routes)
- `client/src/components/` - Shared components (app-sidebar, theme-provider, theme-toggle)
