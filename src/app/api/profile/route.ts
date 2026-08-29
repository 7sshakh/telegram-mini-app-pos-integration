import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { addresses, customers } from "@/db/schema";
import { fail, isResponse, ok, parseBody, phoneSchema, requireCustomer, serverError } from "@/lib/api";
import { audit, clientIp, toCustomerDTO } from "@/lib/auth";
import { getCatalogBundle } from "@/lib/catalog";
import { listOrdersForCustomer } from "@/lib/orders";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  phone: phoneSchema.optional(),
  firstName: z.string().min(1).max(120).optional(),
});

export async function GET(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const [addressRows, recentOrders, bundle] = await Promise.all([
      db
        .select()
        .from(addresses)
        .where(eq(addresses.customerId, authed.customer.id))
        .orderBy(desc(addresses.isDefault), desc(addresses.createdAt)),
      listOrdersForCustomer(authed.customer.id, 5),
      getCatalogBundle(),
    ]);

    return ok({
      customer: toCustomerDTO(authed.customer),
      addresses: addressRows.map((row) => ({
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
      })),
      recentOrders: recentOrders,
      settings: bundle.catalog.settings,
      meta: { posOnline: bundle.posOnline, source: bundle.source },
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const authed = await requireCustomer(request);
    if (isResponse(authed)) return authed;

    const parsed = await parseBody(request, patchSchema);
    if (!parsed.ok) return parsed.response;

    const phone = parsed.data.phone?.replace(/\s|-|\(|\)/g, "");
    const normalized = phone
      ? phone.startsWith("998")
        ? `+${phone}`
        : phone.startsWith("+998")
          ? phone
          : `+998${phone}`
      : undefined;

    const updated = await db
      .update(customers)
      .set({
        phone: normalized ?? authed.customer.phone,
        firstName: parsed.data.firstName?.slice(0, 120) ?? authed.customer.firstName,
        loyaltyEligible: authed.customer.completedOrders > 0,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, authed.customer.id))
      .returning();

    void audit({
      actorType: "customer",
      actorId: authed.customer.id,
      action: "profile.updated",
      payload: { phoneAdded: !!normalized },
      ip: clientIp(request),
    });

    return ok({ customer: toCustomerDTO(updated[0]) });
  } catch (error) {
    return serverError(error);
  }
}
