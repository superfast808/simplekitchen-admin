---
name: WooCommerce sync race condition
description: Race condition between auto-sync and manual sync that creates duplicate order rows for the same woo_id
---

# WooCommerce sync race condition

## The rule
Both the auto-sync and manual sync paths must re-check `getOrderByWooId` immediately before inserting a new order row.

**Why:** Both sync paths do a `getOrderByWooId` check at the top of the loop, but if auto-sync and manual sync run concurrently, both can see "no existing row" for the same woo_id and both proceed to insert — creating a duplicate. The startup `deduplicateWooOrders()` cleans these up on restart, but the window before restart causes real UI duplication (customer appearing twice in the collection view).

**How to apply:** Any code path that inserts a new order from a WooCommerce order must pattern-match the auto-sync guard:
```ts
const recheckExisting = await storage.getOrderByWooId(wo.id);
if (recheckExisting) {
  updated++;
  continue;
}
```
This guard is already present in the auto-sync (background) path. The manual sync path (POST /api/woo/sync-orders or similar) needed it added — confirmed fixed.
