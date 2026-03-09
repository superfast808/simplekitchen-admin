import { db } from "./db";
import { eq, gte, lte, and, sql } from "drizzle-orm";
import {
  products, ingredients, orders, orderItems, manualQuantities,
  type Product, type InsertProduct,
  type Ingredient, type InsertIngredient,
  type Order, type InsertOrder,
  type OrderItem, type InsertOrderItem,
  type ManualQuantity, type InsertManualQuantity,
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
  getOrderItemsByDateRange(from?: Date, to?: Date): Promise<(OrderItem & { orderId: number })[]>;
  createOrderItem(item: InsertOrderItem): Promise<OrderItem>;
  deleteOrderItemsByOrderId(orderId: number): Promise<void>;

  getManualQuantities(from?: Date, to?: Date): Promise<ManualQuantity[]>;
  createManualQuantity(mq: InsertManualQuantity): Promise<ManualQuantity>;
  deleteManualQuantity(id: number): Promise<void>;
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

  async getOrderItemsByDateRange(from?: Date, to?: Date): Promise<(OrderItem & { orderId: number })[]> {
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
}

export const storage = new DatabaseStorage();
