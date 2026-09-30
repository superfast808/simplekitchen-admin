import { db } from "./db";
import { eq, gte, lte, and, or, ne, sql, desc, isNotNull, isNull, inArray } from "drizzle-orm";
import {
  products, ingredients, orders, orderItems, manualQuantities, settings, users,
  subscriptionInvites, subscriptionSelections, recurringOrders, recurringOrderItems,
  standardIngredients, addonLinks, subscribers,
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
  type AddonLink,
  type Subscriber, type InsertSubscriber,
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
  deduplicateWooOrders(): Promise<number>;

  getOrderItems(orderId: number): Promise<OrderItem[]>;
  getOrderItemsBatch(orderIds: number[]): Promise<Map<number, OrderItem[]>>;
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
  submitSubscriptionInviteChoices(input: {
    inviteId: number;
    choices: Array<{ productName: string; quantity: number; price: string; deliveryDay: "sat" | "tue" }>;
    address: string | null;
    fulfillment: "delivery" | "collection";
    checkoutSessionId: string | null;
    addonAmountPence: number;
  }): Promise<{ orderId: number; tuesdayOrderId: number | null }>;
  confirmSubscriptionInvitePayment(id: number, reference: string, amountPence: number, kind: "session" | "intent"): Promise<{ valid: boolean; newlyPaid: boolean }>;
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
  deleteSubscriptionInvite(id: number): Promise<void>;

  setOrderPortalOverridden(id: number, value: boolean): Promise<void>;
  getPortalAddedItems(orderId: number): Promise<OrderItem[]>;
  createAddonLink(token: string, orderId: number, expiresAt: Date): Promise<AddonLink>;
  getAddonLink(token: string): Promise<AddonLink | undefined>;
  getAddonLinkByOrderId(orderId: number): Promise<AddonLink | undefined>;
  getPendingAddonLinks(): Promise<AddonLink[]>;
  updateAddonLink(token: string, data: { stripeSessionId?: string; pendingItems?: string; completedAt?: Date }): Promise<void>;

  createSubscriber(data: InsertSubscriber): Promise<Subscriber>;
  getSubscribers(activeOnly?: boolean): Promise<Subscriber[]>;
  getSubscriberById(id: number): Promise<Subscriber | undefined>;
  updateSubscriber(id: number, data: Partial<InsertSubscriber>): Promise<Subscriber | undefined>;
  deleteSubscriber(id: number): Promise<void>;
  getSubscriptionInvitesBySubscriberId(subscriberId: number): Promise<SubscriptionInvite[]>;
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

  async getCustomerDeliveryAddress(email: string, name: string): Promise<{ deliveryAddress: string | null; fulfillmentType: string | null; deliveryLat: string | null; deliveryLng: string | null } | undefined> {
    const byEmail = email
      ? await db.select().from(orders)
          .where(and(eq(orders.customerEmail, email), isNotNull(orders.deliveryAddress)))
          .orderBy(desc(orders.orderDate))
          .limit(1)
      : [];
    if (byEmail.length > 0) return { deliveryAddress: byEmail[0].deliveryAddress, fulfillmentType: byEmail[0].fulfillmentType, deliveryLat: byEmail[0].deliveryLat, deliveryLng: byEmail[0].deliveryLng };
    const byName = await db.select().from(orders)
      .where(and(eq(orders.customerName, name), isNotNull(orders.deliveryAddress)))
      .orderBy(desc(orders.orderDate))
      .limit(1);
    if (byName.length > 0) return { deliveryAddress: byName[0].deliveryAddress, fulfillmentType: byName[0].fulfillmentType, deliveryLat: byName[0].deliveryLat, deliveryLng: byName[0].deliveryLng };
    return undefined;
  }

  async createOrder(order: InsertOrder): Promise<Order> {
    const [created] = await db.insert(orders).values(order).returning();
    return created;
  }

  async deduplicateWooOrders(): Promise<number> {
    // Find woo_ids that have been inserted more than once (multi-instance race condition)
    const dupes = await db.execute(sql`
      SELECT woo_id, array_agg(id ORDER BY id) as ids
      FROM orders
      WHERE woo_id IS NOT NULL
      GROUP BY woo_id
      HAVING COUNT(*) > 1
    `);
    const rows = dupes.rows as { woo_id: number; ids: number[] }[];
    let removed = 0;
    for (const row of rows) {
      // Keep the lowest id (first created), delete the rest along with their items
      const toDelete = row.ids.slice(1);
      for (const id of toDelete) {
        await db.delete(orderItems).where(eq(orderItems.orderId, id));
        await db.delete(orders).where(eq(orders.id, id));
        removed++;
      }
    }
    return removed;
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

  async getOrderItemsBatch(orderIds: number[]): Promise<Map<number, OrderItem[]>> {
    const map = new Map<number, OrderItem[]>();
    if (orderIds.length === 0) return map;
    const rows = await db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds));
    for (const row of rows) {
      const list = map.get(row.orderId) ?? [];
      list.push(row);
      map.set(row.orderId, list);
    }
    return map;
  }

  async getOrderItemsByDateRange(from?: Date, to?: Date): Promise<(OrderItem & { orderId: number; isManual: boolean; isTuesday: boolean })[]> {
    const conditions = [or(ne(orders.status, "on-hold"), eq(orders.isManual, false))!];
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
    // Subscription week anchors historically straddled midnight because London
    // midnight during BST can be persisted as 23:00 Friday in timestamp-without-
    // time-zone columns. Allow a 12-hour tolerance on the lower bound so legacy
    // invites still belong to the intended Saturday week. New invites are stored
    // at a safe Saturday-afternoon anchor.
    if (from) {
      const tolerantFrom = new Date(from.getTime() - 12 * 60 * 60 * 1000);
      conditions.push(gte(subscriptionInvites.weekFrom, tolerantFrom));
    }
    if (to) conditions.push(lte(subscriptionInvites.weekFrom, to));
    return db.select().from(subscriptionInvites)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(subscriptionInvites.customerName);
  }

  async getSubscriptionOriginOrderIds(): Promise<Set<number>> {
    const rows = await db.select({
      satId: subscriptionInvites.selectionsOrderId,
      tueId: (subscriptionInvites as any).tuesdaySelectionsOrderId,
    }).from(subscriptionInvites);
    const ids = new Set<number>();
    for (const r of rows) {
      if (r.satId) ids.add(r.satId as number);
      if (r.tueId) ids.add(r.tueId as number);
    }
    return ids;
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
    const tuesdayOrderId = invite.tuesdaySelectionsOrderId ?? null;
    await db.transaction(async tx => {
      await tx.delete(subscriptionSelections).where(eq(subscriptionSelections.inviteId, id));
      await tx.update(subscriptionInvites)
        .set({ status: "pending", selectionsOrderId: null, tuesdaySelectionsOrderId: null, addonAmountPence: null, addonPaid: false, stripePaymentIntentId: null, addonPaymentToken: null })
        .where(eq(subscriptionInvites.id, id));
      for (const orderId of Array.from(new Set([selectionsOrderId, tuesdayOrderId].filter((v): v is number => v !== null)))) {
        const [manualOrder] = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.id, orderId), eq(orders.isManual, true)));
        if (manualOrder) {
          await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
          await tx.delete(orders).where(eq(orders.id, orderId));
        }
      }
    });
    return { deletedOrderId: selectionsOrderId };
  }

  async confirmSubscriptionInvitePayment(id: number, reference: string, amountPence: number, kind: "session" | "intent"): Promise<{ valid: boolean; newlyPaid: boolean }> {
    return db.transaction(async tx => {
      const [invite] = await tx.select().from(subscriptionInvites).where(eq(subscriptionInvites.id, id));
      if (!invite || invite.status !== "completed" || invite.addonAmountPence !== amountPence
        || (kind === "session" ? invite.addonPaymentToken : invite.stripePaymentIntentId) !== reference) {
        return { valid: false, newlyPaid: false };
      }
      const updated = await tx.update(subscriptionInvites)
        .set({ addonPaid: true })
        .where(and(eq(subscriptionInvites.id, id), eq(subscriptionInvites.addonPaid, false)))
        .returning({ id: subscriptionInvites.id });
      for (const orderId of [invite.selectionsOrderId, invite.tuesdaySelectionsOrderId]) {
        if (orderId) {
          await tx.update(orders).set({ status: "processing" })
            .where(and(eq(orders.id, orderId), eq(orders.status, "on-hold"), eq(orders.isManual, true)));
        }
      }
      return { valid: true, newlyPaid: updated.length > 0 };
    });
  }

  async submitSubscriptionInviteChoices(input: {
    inviteId: number;
    choices: Array<{ productName: string; quantity: number; price: string; deliveryDay: "sat" | "tue" }>;
    address: string | null;
    fulfillment: "delivery" | "collection";
    checkoutSessionId: string | null;
    addonAmountPence: number;
  }): Promise<{ orderId: number; tuesdayOrderId: number | null }> {
    return db.transaction(async tx => {
      // Lock the invitation to make concurrent POSTs from the same link idempotent.
      const [invite] = await tx.select().from(subscriptionInvites)
        .where(eq(subscriptionInvites.id, input.inviteId)).for("update");
      if (!invite || invite.status !== "pending") throw new Error("Meal choices have already been submitted");
      const isDual = invite.isDual === true;
      for (const choice of input.choices) {
        await tx.insert(subscriptionSelections).values({
          inviteId: invite.id, productName: choice.productName,
          quantity: choice.quantity, deliveryDay: choice.deliveryDay,
        });
      }
      const createDeliveryOrder = async (day: "sat" | "tue") => {
        const [order] = await tx.insert(orders).values({
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          deliveryAddress: input.address,
          orderDate: invite.weekFrom,
          status: input.checkoutSessionId ? "on-hold" : "processing",
          fulfillmentType: input.fulfillment,
          isManual: true,
          isTuesday: day === "tue",
        }).returning();
        for (const choice of input.choices.filter(item => item.deliveryDay === day)) {
          await tx.insert(orderItems).values({
            orderId: order.id, productId: null, productName: choice.productName,
            quantity: choice.quantity, price: choice.price,
          });
        }
        return order.id;
      };
      const orderId = await createDeliveryOrder(isDual ? "sat" : (invite.isTuesday ? "tue" : "sat"));
      const tuesdayOrderId = isDual ? await createDeliveryOrder("tue") : null;
      await tx.update(subscriptionInvites).set({
        status: "completed",
        selectionsOrderId: orderId,
        tuesdaySelectionsOrderId: tuesdayOrderId,
        addonAmountPence: input.checkoutSessionId ? input.addonAmountPence : null,
        addonPaid: false,
        addonPaymentToken: input.checkoutSessionId,
      }).where(eq(subscriptionInvites.id, invite.id));
      return { orderId, tuesdayOrderId };
    });
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
    const trimmed = name.trim();
    // Case-insensitive lookup so "Chicken" and "chicken" resolve to the same entry
    const existing = await db
      .select()
      .from(standardIngredients)
      .where(sql`LOWER(${standardIngredients.name}) = LOWER(${trimmed})`)
      .limit(1);
    if (existing.length > 0) {
      const [updated] = await db
        .update(standardIngredients)
        .set({ costPerG, unit })
        .where(eq(standardIngredients.id, existing[0].id))
        .returning();
      return updated;
    }
    const [row] = await db
      .insert(standardIngredients)
      .values({ name: trimmed, costPerG, unit })
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

  async deleteSubscriptionInvite(id: number): Promise<void> {
    await db.delete(subscriptionInvites).where(eq(subscriptionInvites.id, id));
  }

  async setOrderPortalOverridden(id: number, value: boolean): Promise<void> {
    await db.update(orders).set({ portalOverridden: value } as any).where(eq(orders.id, id));
  }

  async getPortalAddedItems(orderId: number): Promise<OrderItem[]> {
    return db.select().from(orderItems).where(
      and(eq(orderItems.orderId, orderId), eq(orderItems.portalAdded, true))
    );
  }

  async createAddonLink(token: string, orderId: number, expiresAt: Date): Promise<AddonLink> {
    const [created] = await db.insert(addonLinks).values({ token, orderId, expiresAt }).returning();
    return created;
  }

  async getAddonLink(token: string): Promise<AddonLink | undefined> {
    const [link] = await db.select().from(addonLinks).where(eq(addonLinks.token, token));
    return link;
  }

  async getAddonLinkByOrderId(orderId: number): Promise<AddonLink | undefined> {
    const [link] = await db.select().from(addonLinks)
      .where(eq(addonLinks.orderId, orderId))
      .orderBy(desc(addonLinks.createdAt))
      .limit(1);
    return link;
  }

  async getPendingAddonLinks(): Promise<AddonLink[]> {
    return db.select().from(addonLinks)
      .where(and(isNotNull(addonLinks.stripeSessionId), isNull(addonLinks.completedAt)));
  }

  async createSubscriber(data: InsertSubscriber): Promise<Subscriber> {
    const [created] = await db.insert(subscribers).values(data).returning();
    return created;
  }

  async getSubscribers(activeOnly = false): Promise<Subscriber[]> {
    if (activeOnly) {
      return db.select().from(subscribers).where(eq(subscribers.active, true)).orderBy(subscribers.customerName);
    }
    return db.select().from(subscribers).orderBy(subscribers.customerName);
  }

  async getSubscriberById(id: number): Promise<Subscriber | undefined> {
    const [sub] = await db.select().from(subscribers).where(eq(subscribers.id, id));
    return sub;
  }

  async updateSubscriber(id: number, data: Partial<InsertSubscriber>): Promise<Subscriber | undefined> {
    const [updated] = await db.update(subscribers).set(data as any).where(eq(subscribers.id, id)).returning();
    return updated;
  }

  async deleteSubscriber(id: number): Promise<void> {
    await db.delete(subscribers).where(eq(subscribers.id, id));
  }

  async getSubscriptionInvitesBySubscriberId(subscriberId: number): Promise<SubscriptionInvite[]> {
    return db.select().from(subscriptionInvites)
      .where(eq((subscriptionInvites as any).subscriberId, subscriberId))
      .orderBy(subscriptionInvites.weekFrom);
  }

  async updateAddonLink(token: string, data: { stripeSessionId?: string; pendingItems?: string; completedAt?: Date }): Promise<void> {
    await db.update(addonLinks).set(data).where(eq(addonLinks.token, token));
  }
}

export const storage = new DatabaseStorage();
