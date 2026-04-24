import { discoverProducts } from './mcp-host.js';
import type { DiscoveredProduct, TaskHandler, WebhookHandler } from './types.js';

/**
 * In-memory cache of discovered products. Loaded once at platform start; if a
 * product is added to disk, restart Abacus. Keeps the dispatcher product-
 * agnostic — it asks the registry "give me the handler for (product, kind)"
 * and the registry resolves it from each product's `abacus.json`.
 */
export class ProductRegistry {
  constructor(private readonly products: DiscoveredProduct[]) {}

  static async load(packagesDir: string): Promise<ProductRegistry> {
    return new ProductRegistry(await discoverProducts(packagesDir));
  }

  list(): DiscoveredProduct[] {
    return [...this.products];
  }

  get(product: string): DiscoveredProduct | undefined {
    return this.products.find((p) => p.name === product);
  }

  require(product: string): DiscoveredProduct {
    const found = this.get(product);
    if (!found) {
      throw new Error(
        `product-registry: unknown product "${product}" — discovered: [${this.products
          .map((p) => p.name)
          .join(', ')}]`,
      );
    }
    return found;
  }

  taskHandler(product: string, kind: string): TaskHandler | undefined {
    return this.require(product).manifest.tasks[kind];
  }

  webhookHandler(product: string, source: string): WebhookHandler | undefined {
    return this.require(product).manifest.webhooks[source];
  }
}
