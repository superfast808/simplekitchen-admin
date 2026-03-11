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
});

export const ingredients = pgTable("ingredients", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull(),
  name: text("name").notNull(),
  quantityPerUnit: decimal("quantity_per_unit", { precision: 10, scale: 3 }).notNull(),
  unit: text("unit").notNull(),
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
});

export const orderItems = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull(),
  productId: integer("product_id"),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
  price: decimal("price", { precision: 10, scale: 2 }).default("0"),
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

export const subscriptionInvites = pgTable("subscription_invites", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id"),
  customerEmail: text("customer_email").notNull(),
  customerName: text("customer_name").notNull(),
  token: text("token").notNull().unique(),
  subscriptionQuantity: integer("subscription_quantity").notNull(),
  status: text("status").notNull().default("pending"),
  weekFrom: timestamp("week_from").notNull(),
  weekTo: timestamp("week_to").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptionSelections = pgTable("subscription_selections", {
  id: serial("id").primaryKey(),
  inviteId: integer("invite_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
});

export const recurringOrders = pgTable("recurring_orders", {
  id: serial("id").primaryKey(),
  customerName: text("customer_name").notNull(),
  deliveryAddress: text("delivery_address"),
  fulfillmentType: text("fulfillment_type").notNull().default("delivery"),
  active: boolean("active").notNull().default(true),
});

export const recurringOrderItems = pgTable("recurring_order_items", {
  id: serial("id").primaryKey(),
  recurringOrderId: integer("recurring_order_id").notNull(),
  productName: text("product_name").notNull(),
  quantity: integer("quantity").notNull().default(1),
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
export const insertSubscriptionInviteSchema = createInsertSchema(subscriptionInvites).omit({ id: true, createdAt: true });
export const insertSubscriptionSelectionSchema = createInsertSchema(subscriptionSelections).omit({ id: true });
export const insertRecurringOrderSchema = createInsertSchema(recurringOrders).omit({ id: true });
export const insertRecurringOrderItemSchema = createInsertSchema(recurringOrderItems).omit({ id: true });

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
