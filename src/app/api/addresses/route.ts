import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { addresses } from "@/db/schema";
import { addressSchema, fail, isResponse, ok, parseBody, requireCustomer, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_ADDRESSES = 10;

function toDTO(row: typeof addresses.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    addressLine: row.addressLine,
    apartment: row.apartment,
    entrance: row.entrance,
    floor: row.floor,
    landmark: row.landmark,
    note: row.note,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const rows = await db
      .select()
      .from(addresses)
      .where(eq(addresses.customerId, authed.customer.id))
      .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));
    return ok({ addresses: rows.map(toDTO) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const parsed = await parseBody(request, addressSchema);
    if (!parsed.ok) return parsed.response;

    const existing = await db
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.customerId, authed.customer.id));
    if (existing.length >= MAX_ADDRESSES) {
      return fail("VALIDATION", `Maksimal ${MAX_ADDRESSES} ta manzil saqlash mumkin. Eskilaridan birini o‘chiring.`, 422);
    }

    const shouldDefault = existing.length === 0;
    const inserted = await db
      .insert(addresses)
      .values({
        customerId: authed.customer.id,
        label: parsed.data.label,
        addressLine: parsed.data.addressLine,
        apartment: parsed.data.apartment ?? null,
        entrance: parsed.data.entrance ?? null,
        floor: parsed.data.floor ?? null,
        landmark: parsed.data.landmark ?? null,
        note: parsed.data.note ?? null,
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
        isDefault: shouldDefault,
      })
      .returning();

    return ok({ address: toDTO(inserted[0]) }, { status: 201 });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return fail("VALIDATION", "Manzil identifikatori ko‘rsatilmagan.", 422);

    const deleted = await db
      .delete(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.customerId, authed.customer.id)))
      .returning({ id: addresses.id });

    if (!deleted[0]) return fail("NOT_FOUND", "Manzil topilmadi.", 404);
    return ok({ deleted: deleted[0].id });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;
    const parsed = await parseBody(
      request,
      z.object({ id: z.string().uuid(), isDefault: z.boolean().optional(), label: z.enum(["home", "work", "other"]).optional() }),
    );
    if (!parsed.ok) return parsed.response;

    if (parsed.data.isDefault) {
      await db
        .update(addresses)
        .set({ isDefault: false })
        .where(eq(addresses.customerId, authed.customer.id));
    }

    const updated = await db
      .update(addresses)
      .set({
        ...(parsed.data.isDefault !== undefined ? { isDefault: parsed.data.isDefault } : {}),
        ...(parsed.data.label ? { label: parsed.data.label } : {}),
      })
      .where(and(eq(addresses.id, parsed.data.id), eq(addresses.customerId, authed.customer.id)))
      .returning();

    if (!updated[0]) return fail("NOT_FOUND", "Manzil topilmadi.", 404);
    return ok({ address: toDTO(updated[0]) });
  } catch (error) {
    return serverError(error);
  }
}
