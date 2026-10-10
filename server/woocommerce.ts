function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'");
}

export { decodeHtmlEntities };

import { wooFetch } from "./woo-credentials";

export async function fetchWooOrders(params: Record<string, string> = {}): Promise<any[]> {
  const allOrders: any[] = [];
  let page = 1;
  const perPage = "100";

  while (true) {
    const orders = await wooFetch(`orders?${new URLSearchParams({ ...params, per_page: perPage, page: String(page) })}`);
    if (!Array.isArray(orders) || orders.length === 0) break;
    allOrders.push(...orders);
    if (orders.length < parseInt(perPage)) break;
    page++;
  }

  return allOrders;
}

export async function fetchWooProducts(params: Record<string, string> = {}): Promise<any[]> {
  const allProducts: any[] = [];
  let page = 1;
  const perPage = "100";

  while (true) {
    const products = await wooFetch(`products?${new URLSearchParams({ ...params, per_page: perPage, page: String(page) })}`);
    if (!Array.isArray(products) || products.length === 0) break;
    allProducts.push(...products);
    if (products.length < parseInt(perPage)) break;
    page++;
  }

  return allProducts;
}

export async function fetchWooVariations(parentId: number, parentProduct: any): Promise<any[]> {
  const allVariations: any[] = [];
  let page = 1;
  const perPage = "100";

  while (true) {
    let variations: any[];
    try { variations = await wooFetch(`products/${parentId}/variations?${new URLSearchParams({ status: "any", per_page: perPage, page: String(page) })}`); } catch (error: any) { throw new Error(`WooCommerce variation sync failed for product ${parentId}, page ${page}: ${error?.message || error}`); }
    if (!Array.isArray(variations) || variations.length === 0) break;
    // Attach parent info so we can build name/category
    for (const v of variations) {
      v._parentName = parentProduct.name;
      v._parentCategories = parentProduct.categories;
      v._parentImages = parentProduct.images;
    }
    allVariations.push(...variations);
    if (variations.length < parseInt(perPage)) break;
    page++;
  }

  return allVariations;
}
