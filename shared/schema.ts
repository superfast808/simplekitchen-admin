import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, timestamp, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  wooId: integer("woo_id"),
  name: text("name").notNull(),
  price: decimal("price", { precision: 10, scale: 2 }).default("0"),
  imageUrl: text("image_url"),
  category: text("category"),
});

export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  quantityPerUnit: decimal("quantity_per_unit", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
  costPerG: decimal("cost_per_g", { precision: 10, scale: 6 }),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  wooId: integer("woo_id"),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  deliveryAddress: text("delivery_address"),
  deliveryLat: decimal("delivery_lat", { precision: 10, scale: 7 }),
  deliveryLng: decimal("delivery_lng", { precision: 10, scale: 7 }),
  orderDate: timestamp("order_date").notNull().defaultNow(),
  status: text("status").notNull().default("processing"),
  fulfillmentType: text("fulfillment_type").default("collection"),
  isManual: boolean("is_manual").notNull().default(false),
  isTuesday: boolean("is_tuesday").notNull().default(false),
  notes: text("notes"),
  cashAmount: decimal("cash_amount", { precision: 10, scale: 2 }),
  paymentMethod: varchar("payment_method"),
  shippingTotal: decimal("shipping_total", { precision: 10, scale: 2 }).default("0"),
  readyToPack: boolean("ready_to_pack").notNull().default(false),
  portalOverridden: boolean("portal_overridden").notNull().default(false),
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  price: decimal("price", { precision: 10, scale: 2 }).default("0"),
  portalAdded: boolean("portal_added").notNull().default(false),
});

export const addonLinks = pgTable("addon_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  orderId: integer("order_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
  stripeSessionId: text("stripe_session_id"),
  pendingItems: text("pending_items"),
  completedAt: timestamp("completed_at"),
});

export const manualQuantities = pgTable("manual_quantities", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  quantity: integer("quantity").notNull(),
  date: timestamp("date").notNull().defaultNow(),
  note: text("note"),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
});

export const subscribers = pgTable("subscribers", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  deliveryDay: text("delivery_day").notNull().default("sat"), // "sat" | "tue" | "dual"
  quantity: integer("quantity").notNull().default(1),
  paymentIntervalWeeks: integer("payment_interval_weeks").notNull().default(1),
  active: boolean("active").notNull().default(true),
  lastPaymentSentAt: timestamp("last_payment_sent_at"),
  nextPaymentDueAt: timestamp("next_payment_due_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptionInvites = pgTable("subscription_invites", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id"),
  selectionsOrderId: integer("selections_order_id"),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name").notNull(),
  token: text("token").notNull().unique(),
  subscriptionQuantity: integer("subscription_quantity").notNull(),
  status: text("status").notNull().default("pending"),
  weekFrom: timestamp("week_from").notNull(),
  weekTo: timestamp("week_to").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  deliveryAddress: text("delivery_address"),
  fulfillmentType: text("fulfillment_type").notNull().default("delivery"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  addonAmountPence: integer("addon_amount_pence"),
  addonPaid: boolean("addon_paid").notNull().default(false),
  addonPaymentToken: text("addon_payment_token"),
  isTuesday: boolean("is_tuesday").notNull().default(false),
  isDual: boolean("is_dual").notNull().default(false),
  tuesdaySelectionsOrderId: integer("tuesday_selections_order_id"),
  subscriberId: integer("subscriber_id"),
});

export const subscriptionSelections = pgTable("subscription_selections", {
  id: serial("id").primaryKey(),
  inviteId: integer("invite_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  deliveryDay: text("delivery_day").notNull().default("sat"),
});

export const recurringOrders = pgTable("recurring_orders", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  deliveryAddress: text("delivery_address"),
  fulfillmentType: text("fulfillment_type").notNull().default("delivery"),
  active: boolean("active").notNull().default(true),
  isTuesday: boolean("is_tuesday").notNull().default(true),
  notes: text("notes"),
});

export const recurringOrderItems = pgTable("recurring_order_items", {
  id: serial("id").primaryKey(),
  recurringOrderId: integer("recurring_order_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
});

export const standardIngredients = pgTable("standard_ingredients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  costPerG: decimal("cost_per_g", { precision: 10, scale: 6 }).notNull(),
  unit: text("unit").notNull().default("g"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertIngredientSchema = createInsertSchema(ingredients).omit({ id: true });
export const insertOrderSchema = createInsertSchema(orders).omit({ id: true });
export const insertOrderItemSchema = createInsertSchema(orderItems).omit({ id: true });
export const insertManualQuantitySchema = createInsertSchema(manualQuantities).omit({ id: true });
export const insertSubscriberSchema = createInsertSchema(subscribers).omit({ id: true, createdAt: true });
export const insertSubscriptionInviteSchema = createInsertSchema(subscriptionInvites).omit({ id: true, createdAt: true });
export const insertSubscriptionSelectionSchema = createInsertSchema(subscriptionSelections).omit({ id: true });
export const insertRecurringOrderSchema = createInsertSchema(recurringOrders).omit({ id: true });
export const insertRecurringOrderItemSchema = createInsertSchema(recurringOrderItems).omit({ id: true });
export const insertStandardIngredientSchema = createInsertSchema(standardIngredients).omit({ id: true });
export const insertAddonLinkSchema = createInsertSchema(addonLinks).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Ingredient = typeof ingredients.$inferSelect;
export type InsertIngredient = z.infer<typeof insertIngredientSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type ManualQuantity = typeof manualQuantities.$inferSelect;
export type InsertManualQuantity = z.infer<typeof insertManualQuantitySchema>;
export type Setting = typeof settings.$inferSelect;
export type SubscriptionInvite = typeof subscriptionInvites.$inferSelect;
export type InsertSubscriptionInvite = z.infer<typeof insertSubscriptionInviteSchema>;
export type SubscriptionSelection = typeof subscriptionSelections.$inferSelect;
export type InsertSubscriptionSelection = z.infer<typeof insertSubscriptionSelectionSchema>;
export type RecurringOrder = typeof recurringOrders.$inferSelect;
export type InsertRecurringOrder = z.infer<typeof insertRecurringOrderSchema>;
export type RecurringOrderItem = typeof recurringOrderItems.$inferSelect;
export type InsertRecurringOrderItem = z.infer<typeof insertRecurringOrderItemSchema>;
export type StandardIngredient = typeof standardIngredients.$inferSelect;
export type InsertStandardIngredient = z.infer<typeof insertStandardIngredientSchema>;
export type AddonLink = typeof addonLinks.$inferSelect;
export type InsertAddonLink = z.infer<typeof insertAddonLinkSchema>;
export type Subscriber = typeof subscribers.$inferSelect;
export type InsertSubscriber = z.infer<typeof insertSubscriberSchema>;
