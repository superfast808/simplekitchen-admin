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

const WC_STORE_URL = process.env.WC_STORE_URL || "";
const WC_CONSUMER_KEY = process.env.WC_CONSUMER_KEY || "";
const WC_CONSUMER_SECRET = process.env.WC_CONSUMER_SECRET || "";

function getAuthParams(): string {
  return `consumer_key=${encodeURIComponent(WC_CONSUMER_KEY)}&consumer_secret=${encodeURIComponent(WC_CONSUMER_SECRET)}`;
}

function buildUrl(endpoint: string, params: Record<string, string> = {}): string {
  const base = WC_STORE_URL.replace(/\/+$/, "");
  const queryParts = [getAuthParams()];
  for (const [key, value] of Object.entries(params)) {
    queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
  return `${base}/wp-json/wc/v3/${endpoint}?${queryParts.join("&")}`;
}

export async function fetchWooOrders(params: Record<string, string> = {}): Promise<any[]> {
  const allOrders: any[] = [];
  let page = 1;
  const perPage = "100";

  while (true) {
    const url = buildUrl("orders", { ...params, per_page: perPage, page: String(page) });
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WooCommerce API error (${response.status}): ${text}`);
    }
    const orders = await response.json();
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
    const url = buildUrl("products", { ...params, per_page: perPage, page: String(page) });
    const response = await fetch(url);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`WooCommerce API error (${response.status}): ${text}`);
    }
    const products = await response.json();
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
    const url = buildUrl(`products/${parentId}/variations`, { status: "any", per_page: perPage, page: String(page) });
    const response = await fetch(url);
    if (!response.ok) break;
    const variations = await response.json();
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
