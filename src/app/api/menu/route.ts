import { getCatalogBundle } from "@/lib/catalog";
import { fail, ok, serverError } from "@/lib/api";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Public menu read (categories, products, prices, images, modifiers, stock
 * flags, payment methods, promos). Data always comes from the local POS via
 * the bridge agent; the cloud only caches it.
 */
export async function GET() {
  try {
    const bundle = await getCatalogBundle();
    return ok({
      brand: bundle.catalog.settings.brandName,
      currency: bundle.catalog.currency,
      categories: [...bundle.catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder),
      products: bundle.catalog.products,
      settings: bundle.catalog.settings,
      promotions: bundle.promotions,
      meta: {
        source: bundle.source,
        posOnline: bundle.posOnline,
        stale: bundle.stale,
        degraded: bundle.degraded,
        fetchedAt: bundle.fetchedAt,
        catalogVersion: bundle.catalog.version,
        mockMode: env.posMode === "mock",
      },
    });
  } catch (error) {
    return serverError(error);
  }
}
