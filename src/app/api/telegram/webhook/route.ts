import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const message = body.message || body.edited_message;

    if (message && message.chat && message.chat.id) {
      const chatId = message.chat.id;
      const appUrl = env.appBaseUrl || "https://vibe-pos-miniapp.vercel.app";

      await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🌟 **VIBE HotDog · Burger · Drinks** ga xush kelibsiz!\n\nPastdagi tugmani bosing va osongina buyurtma bering:",
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "🛒 Buyurtma berish",
                  web_app: { url: `${appUrl}/?v=${Date.now()}` },
                },
              ],
            ],
          },
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram webhook error]", error);
    return NextResponse.json({ ok: true });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "telegram-bot-webhook" });
}
