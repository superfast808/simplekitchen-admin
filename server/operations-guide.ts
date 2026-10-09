/**
 * Reviewed, public-to-admin operational navigation and workflow knowledge.
 * Do not include credentials, deployment secrets or source code execution paths.
 * Update this alongside major admin workflow changes.
 */
export const systemGuide = [
 {name:"Orders",path:"/",purpose:"Review imported WooCommerce and operational orders. Filter by production week/status, inspect items, and use Hard Refresh for a fresh database view. Woo sync is a separate operation.",links:["/saturday","/tuesday","/kitchen-production"]},
 {name:"Saturday Orders",path:"/saturday",purpose:"Review Saturday allocations separately from Tuesday. Check order status and quantities before preparing Saturday meals.",links:["/kitchen-production","/routes/saturday"]},
 {name:"Tuesday Orders",path:"/tuesday",purpose:"Review Tuesday-specific allocated orders separately. Do not merge them into Saturday kitchen totals.",links:["/kitchen-production","/routes/tuesday"]},
 {name:"Kitchen Production",path:"/kitchen-production",purpose:"Choose the Sat–Thu order window and Saturday, Tuesday, Both or Christmas. Filter by order source. Expand each product to inspect contributing orders; enter physical prepared counts to check against required quantities. The prepared fields are temporary, not saved.",links:["/","/ingredients","/possible-duplicates"]},
 {name:"Product Totals",path:"/product-totals",purpose:"View required quantities across products. Manual stock is distinct from ordered customer portions.",links:["/kitchen-production","/manual-stock"]},
 {name:"Ingredients",path:"/ingredients",purpose:"Translate meal quantities into ingredient requirements using recipe mappings. Missing or incorrect mappings can explain ingredient-page differences without proving missing customer orders.",links:["/ingredient-library","/kitchen-production"]},
 {name:"Ingredient Library",path:"/ingredient-library",purpose:"Maintain ingredient and recipe definitions used by Ingredients calculations.",links:["/ingredients"]},
 {name:"Manual Stock",path:"/manual-stock",purpose:"Record additional production stock separately from customer-order allocations; avoid double counting.",links:["/product-totals"]},
 {name:"Possible Duplicates",path:"/possible-duplicates",purpose:"Review flagged identical/near-identical orders. Flagging is not proof of duplication; investigate before cancellation/refund. Suspected orders remain counted while active.",links:["/"]},
 {name:"Subscriptions",path:"/subscriptions",purpose:"Review invitation/selection status and linked generated orders. Subscription choices can produce separate Saturday and Tuesday operational orders. Pending selection does not itself prove a kitchen shortfall.",links:["/kitchen-production","/"]},
 {name:"Weekly Stats",path:"/weekly-stats",purpose:"Review totals for the selected production window and compare source-specific figures with production.",links:["/kitchen-production"]},
 {name:"Monthly Stats",path:"/monthly-stats",purpose:"Review monthly aggregates; do not compare directly to a single Saturday preparation run.",links:["/weekly-stats"]},
 {name:"Saturday Routes",path:"/routes/saturday",purpose:"Review operational Saturday delivery allocations and routes, distinct from driver dispatch testing.",links:["/dispatch/dev/saturday"]},
 {name:"Tuesday Routes",path:"/routes/tuesday",purpose:"Review operational Tuesday delivery allocations and routes.",links:["/dispatch/dev/tuesday"]},
 {name:"Saturday Driver Dispatch (development)",path:"/dispatch/dev/saturday",purpose:"Assign Saturday deliveries to drivers by Kanban drag-and-drop or dropdown; development assignments are separate from legacy routes.",links:["/dispatch/locations"]},
 {name:"Tuesday Driver Dispatch (development)",path:"/dispatch/dev/tuesday",purpose:"Assign Tuesday deliveries independently from Saturday; development only.",links:["/dispatch/locations"]},
 {name:"Driver Locations",path:"/dispatch/locations",purpose:"View opted-in, recently updated driver GPS locations and lookup delivery completion evidence by order ID. GPS does not conclusively prove receipt.",links:["/dispatch/dev/saturday","/dispatch/dev/tuesday"]},
 {name:"Christmas Orders",path:"/christmas/orders",purpose:"Review Christmas-specific orders separately from ordinary Saturday and Tuesday meals.",links:["/christmas/delivery","/christmas/weekly"]},
 {name:"Christmas Delivery",path:"/christmas/delivery",purpose:"Review festive delivery/collection separately from regular weekly routes.",links:["/christmas/orders"]},
 {name:"Christmas Weekly/Monthly",path:"/christmas/weekly",purpose:"Review Christmas-only weekly and monthly reporting.",links:["/christmas/monthly"]},
 {name:"Products",path:"/products",purpose:"Manage product catalogue and categories; categorisation affects production and Christmas exclusions.",links:["/kitchen-production"]},
 {name:"Settings",path:"/settings",purpose:"Configure application integrations and operational settings; only administrators should change credentials and live/test toggles.",links:["/system-status"]},
 {name:"System Status",path:"/system-status",purpose:"Check application integration/health reporting before diagnosing stale operational results.",links:["/settings"]},
 {name:"Help",path:"/help",purpose:"Open existing guidance and support information.",links:[]}
];
export const relationships=[
 "WooCommerce synchronisation imports customer orders into the operational Orders database; Hard Refresh only reloads current data.",
 "Subscription invitations and selections can create manual operational orders linked by subscription_invites.selections_order_id (Saturday) or tuesday_selections_order_id (Tuesday). Staff manual orders are a different source.",
 "Eligible orders and their order_items feed Kitchen Production. Delivery day, status and Christmas category exclusions determine what contributes.",
 "Ingredients multiplies production inputs by recipe mappings; an ingredient requirement is not a separate customer order.",
 "Production checks and manual stock are different data concepts; additional stock must not be silently included in order-based counts.",
 "Labels and routes use fulfilment-eligible orders; duplicates, cancellation, Christmas exclusions and day selection can affect what appears.",
 "Dispatch assignments connect eligible deliveries to drivers. Driver PWA status and GPS updates feed customer journey/tracking and the admin location/audit tools, subject to configuration.",
 "Christmas uses separate order, delivery, label and reporting workflows; regular Saturday and Tuesday totals should exclude festive items."
];
