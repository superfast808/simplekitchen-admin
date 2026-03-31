import { db } from "./db";
import { eq, gte, lte, and, sql, desc, isNotNull } from "drizzle-orm";
import {
  products, ingredients, orders, orderItems, manualQuantities, settings, users,
  subscriptionInvites, subscriptionSelections, recurringOrders, recurringOrderItems,
  standardIngredients,
  type Product, type InsertProduct,
  type Ingredient, type InsertIngredient,
  type Order, type InsertOrder,
  type OrderItem, type InsertOrderItem,
  type ManualQuantity, type InsertManualQuantity,
  type Setting, type User, type InsertUser,
  type SubscriptionInvite, type InsertSubscriptionInvite,
  type SubscriptionSelection, type InsertSubscriptionSelection,
  type RecurringOrder, type InsertRecurringOrder,
  type RecurringOrderItem, type InsertRecurringOrderItem,
  type StandardIngredient, type InsertStandardIngredient,
} from "@shared/schema";

export interface IStorage {
  getProducts(): Promise<Product[]>;
  getProduct(id: number): Promise<Product | undefined>;
  getProductByWooId(wooId: number): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<void>;

  getIngredients(productId: number): Promise<Ingredient[]>;
  getAllIngredients(): Promise<Ingredient[]>;
  createIngredient(ingredient: InsertIngredient): Promise<Ingredient>;
  updateIngredient(id: number, ingredient: Partial<InsertIngredient>): Promise<Ingredient | undefined>;
  deleteIngredient(id: number): Promise<void>;
  deleteIngredientsByProductId(productId: number): Promise<void>;

  getOrders(from?: Date, to?: Date): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  getOrderByWooId(wooId: number): Promise<Order | undefined>;
  createOrder(order: InsertOrder): Promise<Order>;
  updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order | undefined>;
  deleteOrder(id: number): Promise<void>;

  getOrderItems(orderId: number): Promise<OrderItem[]>;
  getOrderItemsByDateRange(from?: Date, to?: Date): Promise<(OrderItem & { orderId: number; isManual: boolean; isTuesday: boolean; customerName: string })[]>;
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  deleteOrderItemsByOrderId(orderId: number): Promise<void>;

  getManualQuantities(from?: Date, to?: Date): Promise<ManualQuantity[]>;
  createManualQuantity(mq: InsertManualQuantity): Promise<ManualQuantity>;
  deleteManualQuantity(id: number): Promise<void>;

  getSetting(key: string): Promise<string | undefined>;
  getAllSettings(): Promise<Setting[]>;
  setSetting(key: string, value: string): Promise<void>;

  getUsers(): Promise<User[]>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  deleteUser(id: string): Promise<void>;
  countUsers(): Promise<number>;

  createSubscriptionInvite(invite: InsertSubscriptionInvite): Promise<SubscriptionInvite>;
  getSubscriptionInviteByToken(token: string): Promise<SubscriptionInvite | undefined>;
  getSubscriptionInvites(from?: Date, to?: Date): Promise<SubscriptionInvite[]>;
  updateSubscriptionInviteStatus(id: number, status: string): Promise<void>;
  updateSubscriptionInviteQuantity(id: number, quantity: number): Promise<void>;
  setSubscriptionInviteSelectionsOrder(id: number, orderId: number): Promise<void>;
  setSubscriptionInviteTuesdayOrder(id: number, orderId: number): Promise<void>;
  getSubscriptionInviteById(id: number): Promise<SubscriptionInvite | undefined>;
  updateSubscriptionInvitePayment(id: number, data: { stripePaymentIntentId?: string; addonAmountPence?: number; addonPaid?: boolean; addonPaymentToken?: string }): Promise<void>;
  createSubscriptionSelection(selection: InsertSubscriptionSelection): Promise<SubscriptionSelection>;
  getSubscriptionSelections(inviteId: number): Promise<SubscriptionSelection[]>;
  deleteSubscriptionSelectionsByInviteId(inviteId: number): Promise<void>;
  resetSubscriptionInvite(id: number): Promise<{ deletedOrderId: number | null }>;


  getRecurringOrders(): Promise<RecurringOrder[]>;
  getRecurringOrder(id: number): Promise<RecurringOrder | undefined>;
  createRecurringOrder(order: InsertRecurringOrder): Promise<RecurringOrder>;
  updateRecurringOrder(id: number, order: Partial<InsertRecurringOrder>): Promise<RecurringOrder | undefined>;
  deleteRecurringOrder(id: number): Promise<void>;
  getRecurringOrderItems(recurringOrderId: number): Promise<RecurringOrderItem[]>;
  createRecurringOrderItem(item: InsertRecurringOrderItem): Promise<RecurringOrderItem>;
  deleteRecurringOrderItemsByOrderId(recurringOrderId: number): Promise<void>;

  getStandardIngredients(): Promise<StandardIngredient[]>;
  upsertStandardIngredient(name: string, costPerG: string, unit: string): Promise<StandardIngredient>;
  updateStandardIngredient(id: number, data: Partial<InsertStandardIngredient>): Promise<StandardIngredient | undefined>;
  deleteStandardIngredient(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getProducts(): Promise<Product[]> {
    return db.select().from(products).orderBy(products.name);
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async getProductByWooId(wooId: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.wooId, wooId));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [created] = await db.insert(products).values(product).returning();
    return created;
  }

  async updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined> {
    const [updated] = await db.update(products).set(product).where(eq(products.id, id)).returning();
    return updated;
  }

  async deleteProduct(id: number): Promise<void> {
    await db.delete(products).where(eq(products.id, id));
  }

  async getIngredients(productId: number): Promise<Ingredient[]> {
    return db.select().from(ingredients).where(eq(ingredients.productId, productId)).orderBy(ingredients.name);
  }

  async getAllIngredients(): Promise<Ingredient[]> {
    return db.select().from(ingredients).orderBy(ingredients.name);
  }

  async createIngredient(ingredient: InsertIngredient): Promise<Ingredient> {
    const [created] = await db.insert(ingredients).values(ingredient).returning();
    return created;
  }

  async updateIngredient(id: number, ingredient: Partial<InsertIngredient>): Promise<Ingredient | undefined> {
    const [updated] = await db.update(ingredients).set(ingredient).where(eq(ingredients.id, id)).returning();
    return updated;
  }

  async deleteIngredient(id: number): Promise<void> {
    await db.delete(ingredients).where(eq(ingredients.id, id));
  }

  async deleteIngredientsByProductId(productId: number): Promise<void> {
    await db.delete(ingredients).where(eq(ingredients.productId, productId));
  }

  async getOrders(from?: Date, to?: Date): Promise<Order[]> {
    const conditions = [];
    if (from) conditions.push(gte(orders.orderDate, from));
    if (to) conditions.push(lte(orders.orderDate, to));
    return db.select().from(orders)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(orders.orderDate);
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async getOrderByWooId(wooId: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.wooId, wooId));
    return order;
  }

  async getCustomerDeliveryAddress(email: string, name: string): Promise<{ deliveryAddress: string | null; fulfillmentType: string | null } | undefined> {
    const byEmail = email
      ? await db.select().from(orders)
          .where(and(eq(orders.customerEmail, email), isNotNull(orders.deliveryAddress)))
          .orderBy(desc(orders.orderDate))
          .limit(1)
      : [];
    if (byEmail.length > 0) return { deliveryAddress: byEmail[0].deliveryAddress, fulfillmentType: byEmail[0].fulfillmentType };
    const byName = await db.select().from(orders)
      .where(and(eq(orders.customerName, name), isNotNull(orders.deliveryAddress)))
      .orderBy(desc(orders.orderDate))
      .limit(1);
    if (byName.length > 0) return { deliveryAddress: byName[0].deliveryAddress, fulfillmentType: byName[0].fulfillmentType };
    return undefined;
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const [created] = await db.insert(orders).values(order).returning();
    return created;
  }

  async updateOrder(id: number, order: Partial<InsertOrder>): Promise<Order | undefined> {
    const [updated] = await db.update(orders).set(order).where(eq(orders.id, id)).returning();
    return updated;
  }

  async deleteOrder(id: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, id));
    await db.delete(orders).where(eq(orders.id, id));
  }

  async getOrderItems(orderId: number): Promise<OrderItem[]> {
    return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async getOrderItemsByDateRange(from?: Date, to?: Date): Promise<(OrderItem & { orderId: number; isManual: boolean; isTuesday: boolean })[]> {
    const conditions = [];
    if (from) conditions.push(gte(orders.orderDate, from));
    if (to) conditions.push(lte(orders.orderDate, to));

    const result = await db.select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      productName: orderItems.productName,
      quantity: orderItems.quantity,
      price: orderItems.price,
      isManual: orders.isManual,
      isTuesday: orders.isTuesday,
      customerName: orders.customerName,
    }).from(orderItems)
      .innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return result;
  }

  async createOrderItem(item: InsertOrderItem): Promise<OrderItem> {
    const [created] = await db.insert(orderItems).values(item).returning();
    return created;
  }

  async deleteOrderItemsByOrderId(orderId: number): Promise<void> {
    await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  }

  async getManualQuantities(from?: Date, to?: Date): Promise<ManualQuantity[]> {
    const conditions = [];
    if (from) conditions.push(gte(manualQuantities.date, from));
    if (to) conditions.push(lte(manualQuantities.date, to));
    return db.select().from(manualQuantities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(manualQuantities.date);
  }

  async createManualQuantity(mq: InsertManualQuantity): Promise<ManualQuantity> {
    const [created] = await db.insert(manualQuantities).values(mq).returning();
    return created;
  }

  async deleteManualQuantity(id: number): Promise<void> {
    await db.delete(manualQuantities).where(eq(manualQuantities.id, id));
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key));
    return setting?.value;
  }

  async getAllSettings(): Promise<Setting[]> {
    return db.select().from(settings);
  }

  async setSetting(key: string, value: string): Promise<void> {
    const existing = await this.getSetting(key);
    if (existing !== undefined) {
      await db.update(settings).set({ value }).where(eq(settings.key, key));
    } else {
      await db.insert(settings).values({ key, value });
    }
  }

  async getUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.username);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async countUsers(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result[0].count);
  }

  async createSubscriptionInvite(invite: InsertSubscriptionInvite): Promise<SubscriptionInvite> {
    const [created] = await db.insert(subscriptionInvites).values(invite).returning();
    return created;
  }

  async getSubscriptionInviteByToken(token: string): Promise<SubscriptionInvite | undefined> {
    const [invite] = await db.select().from(subscriptionInvites).where(eq(subscriptionInvites.token, token));
    return invite;
  }

  async getSubscriptionInvites(from?: Date, to?: Date): Promise<SubscriptionInvite[]> {
    const conditions = [];
    if (from) conditions.push(gte(subscriptionInvites.weekFrom, from));
    if (to) conditions.push(lte(subscriptionInvites.weekTo, to));
    return db.select().from(subscriptionInvites)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(subscriptionInvites.customerName);
  }

  async getSubscriptionOriginOrderIds(): Promise<Set<number>> {
    const rows = await db.select({ id: subscriptionInvites.selectionsOrderId }).from(subscriptionInvites)
      .where(isNotNull(subscriptionInvites.selectionsOrderId));
    return new Set(rows.map(r => r.id as number));
  }

  async updateSubscriptionInviteStatus(id: number, status: string): Promise<void> {
    await db.update(subscriptionInvites).set({ status }).where(eq(subscriptionInvites.id, id));
  }

  async updateSubscriptionInviteQuantity(id: number, quantity: number): Promise<void> {
    await db.update(subscriptionInvites).set({ subscriptionQuantity: quantity }).where(eq(subscriptionInvites.id, id));
  }

  async setSubscriptionInviteSelectionsOrder(id: number, orderId: number): Promise<void> {
    await db.update(subscriptionInvites).set({ selectionsOrderId: orderId }).where(eq(subscriptionInvites.id, id));
  }

  async setSubscriptionInviteTuesdayOrder(id: number, orderId: number): Promise<void> {
    await db.update(subscriptionInvites).set({ tuesdaySelectionsOrderId: orderId } as any).where(eq(subscriptionInvites.id, id));
  }

  async getSubscriptionInviteById(id: number): Promise<SubscriptionInvite | undefined> {
    const [invite] = await db.select().from(subscriptionInvites).where(eq(subscriptionInvites.id, id));
    return invite;
  }

  async updateSubscriptionInvitePayment(id: number, data: { stripePaymentIntentId?: string; addonAmountPence?: number; addonPaid?: boolean; addonPaymentToken?: string }): Promise<void> {
    await db.update(subscriptionInvites).set(data as any).where(eq(subscriptionInvites.id, id));
  }

  async createSubscriptionSelection(selection: InsertSubscriptionSelection): Promise<SubscriptionSelection> {
    const [created] = await db.insert(subscriptionSelections).values(selection).returning();
    return created;
  }

  async getSubscriptionSelections(inviteId: number): Promise<SubscriptionSelection[]> {
    return db.select().from(subscriptionSelections).where(eq(subscriptionSelections.inviteId, inviteId));
  }

  async deleteSubscriptionSelectionsByInviteId(inviteId: number): Promise<void> {
    await db.delete(subscriptionSelections).where(eq(subscriptionSelections.inviteId, inviteId));
  }

  async resetSubscriptionInvite(id: number): Promise<{ deletedOrderId: number | null }> {
    const [invite] = await db.select().from(subscriptionInvites).where(eq(subscriptionInvites.id, id));
    if (!invite) return { deletedOrderId: null };
    const selectionsOrderId = invite.selectionsOrderId ?? null;
    await db.delete(subscriptionSelections).where(eq(subscriptionSelections.inviteId, id));
    await db.update(subscriptionInvites)
      .set({ status: "pending", selectionsOrderId: null, addonAmountPence: null, addonPaid: false, stripePaymentIntentId: null, addonPaymentToken: null })
      .where(eq(subscriptionInvites.id, id));
    if (selectionsOrderId) {
      await db.delete(orderItems).where(eq(orderItems.orderId, selectionsOrderId));
      await db.delete(orders).where(and(eq(orders.id, selectionsOrderId), eq(orders.isManual, true)));
    }
    return { deletedOrderId: selectionsOrderId };
  }

  async getRecurringOrders(): Promise<RecurringOrder[]> {
    return db.select().from(recurringOrders).orderBy(recurringOrders.customerName);
  }

  async getRecurringOrder(id: number): Promise<RecurringOrder | undefined> {
    const [order] = await db.select().from(recurringOrders).where(eq(recurringOrders.id, id));
    return order;
  }

  async createRecurringOrder(order: InsertRecurringOrder): Promise<RecurringOrder> {
    const [created] = await db.insert(recurringOrders).values(order).returning();
    return created;
  }

  async updateRecurringOrder(id: number, order: Partial<InsertRecurringOrder>): Promise<RecurringOrder | undefined> {
    const [updated] = await db.update(recurringOrders).set(order).where(eq(recurringOrders.id, id)).returning();
    return updated;
  }

  async deleteRecurringOrder(id: number): Promise<void> {
    await db.delete(recurringOrderItems).where(eq(recurringOrderItems.recurringOrderId, id));
    await db.delete(recurringOrders).where(eq(recurringOrders.id, id));
  }

  async getRecurringOrderItems(recurringOrderId: number): Promise<RecurringOrderItem[]> {
    return db.select().from(recurringOrderItems).where(eq(recurringOrderItems.recurringOrderId, recurringOrderId));
  }

  async createRecurringOrderItem(item: InsertRecurringOrderItem): Promise<RecurringOrderItem> {
    const [created] = await db.insert(recurringOrderItems).values(item).returning();
    return created;
  }

  async deleteRecurringOrderItemsByOrderId(recurringOrderId: number): Promise<void> {
    await db.delete(recurringOrderItems).where(eq(recurringOrderItems.recurringOrderId, recurringOrderId));
  }

  async getStandardIngredients(): Promise<StandardIngredient[]> {
    return db.select().from(standardIngredients).orderBy(standardIngredients.name);
  }

  async upsertStandardIngredient(name: string, costPerG: string, unit: string): Promise<StandardIngredient> {
    const [row] = await db
      .insert(standardIngredients)
      .values({ name, costPerG, unit })
      .onConflictDoUpdate({ target: standardIngredients.name, set: { costPerG, unit } })
      .returning();
    return row;
  }

  async updateStandardIngredient(id: number, data: Partial<InsertStandardIngredient>): Promise<StandardIngredient | undefined> {
    const [updated] = await db.update(standardIngredients).set(data).where(eq(standardIngredients.id, id)).returning();
    return updated;
  }

  async deleteStandardIngredient(id: number): Promise<void> {
    await db.delete(standardIngredients).where(eq(standardIngredients.id, id));
  }
}

export const storage = new DatabaseStorage();
