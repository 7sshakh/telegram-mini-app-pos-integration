import { desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogSnapshots, posDevices } from "@/db/schema";
import { env } from "@/lib/env";
import { enqueueJob } from "@/lib/jobs";
import { buildMockCatalog, buildMockPromotions } from "@/lib/mock-pos";
import type { PosCatalog, PromotionDef } from "@/lib/types";

export type CatalogBundle = {
  catalog: PosCatalog;
  promotions: PromotionDef[];
  source: "pos" | "mock";
  stale: boolean;
  posOnline: boolean;
  fetchedAt: string;
  degraded: boolean;
};

let lastRefreshRequest = 0;

export async function isPosOnline(): Promise<boolean> {
  const rows = await db.execute(
    sql`select 1 as online from pos_devices where disabled = false and last_seen_at > now() - interval '120 seconds' limit 1`,
  );
  return (resultRows(rows)).length > 0;
}

function resultRows(result: { rows?: unknown }): unknown[] {
  return (result.rows ?? []) as unknown[];
}

export async function saveCatalogSnapshot(input: {
  catalog: PosCatalog;
  promotions: PromotionDef[];
}): Promise<void> {
  await db.insert(catalogSnapshots).values({
    version: input.catalog.version,
    source: input.catalog.source === "mock" ? "mock" : "pos",
    payload: input.catalog,
    promotions: input.promotions,
    settings: input.catalog.settings,
    fetchedAt: new Date(),
  });
  // keep the table small: only the newest 20 snapshots matter
  await db.execute(sql`
    delete from catalog_snapshots
     where id not in (select id from catalog_snapshots order by fetched_at desc limit 20)
  `);
}

/**
 * Read the menu. The local POS is the source of truth; the cloud only keeps a
 * short lived cache. If the cache is stale we ask the agent (through the queue)
 * to push a fresh copy and keep serving the cached one so the Mini App stays
 * fast even while the POS computer is offline.
 */
export async function getCatalogBundle(): Promise<CatalogBundle> {
  if (env.posMode === "mock") {
    return {
      catalog: buildMockCatalog(),
      promotions: buildMockPromotions(),
      source: "mock",
      stale: false,
      posOnline: false,
      fetchedAt: new Date().toISOString(),
      degraded: false,
    };
  }

  const rows = await db
    .select()
    .from(catalogSnapshots)
    .where(eq(catalogSnapshots.source, "pos"))
    .orderBy(desc(catalogSnapshots.fetchedAt))
    .limit(1);

  const posOnline = await isPosOnline();
  const snapshot = rows[0];
  const ttlMs = env.catalogTtlSeconds * 1000;

  if (!snapshot) {
    if (env.allowMockFallback) {
      return {
        catalog: buildMockCatalog(),
        promotions: buildMockPromotions(),
        source: "mock",
        stale: true,
        posOnline,
        fetchedAt: new Date().toISOString(),
        degraded: true,
      };
    }
    throw new Error("POS_CATALOG_UNAVAILABLE");
  }

  const ageMs = Date.now() - snapshot.fetchedAt.getTime();
  if (ageMs > ttlMs && Date.now() - lastRefreshRequest > 20_000) {
    lastRefreshRequest = Date.now();
    void enqueueJob({
      type: "REFRESH_CATALOG",
      dedupeKey: `catalog-refresh:${Math.floor(Date.now() / 60_000)}`,
      payload: {},
    }).catch(() => undefined);
  }

  return {
    catalog: snapshot.payload,
    promotions: snapshot.promotions ?? [],
    source: "pos",
    stale: ageMs > ttlMs,
    posOnline,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    degraded: false,
  };
}

export async function touchDevice(deviceId: string, meta?: { status?: string; posVersion?: string; agentVersion?: string }) {
  await db
    .update(posDevices)
    .set({
      lastSeenAt: new Date(),
      status: meta?.status ?? "online",
      posVersion: meta?.posVersion ?? undefined,
      agentVersion: meta?.agentVersion ?? undefined,
    })
    .where(eq(posDevices.deviceId, deviceId));
}
