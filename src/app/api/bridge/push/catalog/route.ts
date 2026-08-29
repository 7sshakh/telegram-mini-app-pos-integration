import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { posJobs } from "@/db/schema";
import { fail, ok, parseBody, pushCatalogSchema, serverError } from "@/lib/api";
import { audit, authenticateDevice } from "@/lib/auth";
import { saveCatalogSnapshot, touchDevice } from "@/lib/catalog";
import type { PosCatalog, PromotionDef } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The local agent pushes the live POS menu (products, prices, images,
 * modifiers, stock, payment methods, promotions). This is the only way catalog
 * data enters the cloud — the cloud never reads the POS SQLite file directly.
 */
export async function POST(request: Request) {
  try {
    const device = await authenticateDevice(request);
    if (!device) return fail("UNAUTHORIZED", "Qurilma tokeni yaroqsiz.", 401);

    const parsed = await parseBody(request, pushCatalogSchema);
    if (!parsed.ok) return parsed.response;

    const incoming = parsed.data.catalog;
    const catalog: PosCatalog = {
      version: incoming.version,
      source: "pos",
      currency: "UZS",
      generatedAt: incoming.generatedAt ?? new Date().toISOString(),
      categories: incoming.categories.map((category) => ({
        id: category.id,
        name: category.name,
        emoji: category.emoji,
        sortOrder: category.sortOrder,
      })),
      products: incoming.products.map((product) => ({
        id: product.id,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        price: product.price,
        oldPrice: product.oldPrice,
        imageUrl: product.imageUrl,
        isAvailable: product.isAvailable,
        stock: product.stock ?? null,
        modifiers: product.modifiers,
        tags: product.tags,
      })),
      settings: { ...incoming.settings, workHours: incoming.settings.workHours ?? null },
    };

    const promotions: PromotionDef[] = parsed.data.promotions.map((promo) => ({
      code: promo.code,
      title: promo.title,
      description: promo.description,
      type: promo.type,
      eligibleCategoryIds: promo.eligibleCategoryIds,
      eligibleProductIds: promo.eligibleProductIds,
      minQty: promo.minQty,
      discountPercent: promo.discountPercent,
      discountAmount: promo.discountAmount,
      requiresPhone: promo.requiresPhone,
      requiresHistory: promo.requiresHistory,
      maxUsesPerCustomer: promo.maxUsesPerCustomer ?? null,
      activeFrom: promo.activeFrom ?? null,
      activeUntil: promo.activeUntil ?? null,
      enabled: promo.enabled,
      priority: promo.priority,
    }));

    await saveCatalogSnapshot({ catalog, promotions });
    await touchDevice(device.deviceId, {
      status: "online",
      posVersion: request.headers.get("x-pos-version") ?? undefined,
      agentVersion: request.headers.get("x-agent-version") ?? undefined,
    });

    // mark pending catalog refresh requests as done
    await db
      .update(posJobs)
      .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(posJobs.type, "REFRESH_CATALOG"), eq(posJobs.status, "pending")));

    void audit({
      actorType: "pos",
      actorId: device.deviceId,
      action: "bridge.catalog_pushed",
      payload: { version: catalog.version, products: catalog.products.length, promotions: parsed.data.promotions.length },
    });

    return ok({ stored: true, version: catalog.version });
  } catch (error) {
    return serverError(error);
  }
}
