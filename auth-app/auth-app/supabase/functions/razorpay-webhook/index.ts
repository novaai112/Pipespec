// POST /functions/v1/razorpay-webhook   (deploy with --no-verify-jwt; Razorpay calls it, not a browser)
// Safety net: activates Pro even if the user closed the browser right after paying in their UPI app.
// Dashboard > Settings > Webhooks: events payment.captured, order.paid, payment.failed, refund.processed
import { adminClient, env, hmacSha256Hex, safeEqual } from "../_shared/utils.ts";

const ok = (msg = "ok") => new Response(msg, { status: 200 });

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text(); // signature is calculated over the RAW body
  const sig = req.headers.get("x-razorpay-signature") ?? "";
  const expected = await hmacSha256Hex(env("RAZORPAY_WEBHOOK_SECRET"), raw);
  if (!sig || !safeEqual(expected, sig)) return new Response("Invalid signature", { status: 400 });

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const admin = adminClient();
  const pay = event?.payload?.payment?.entity;

  try {
    switch (event.event) {
      case "payment.captured":
      case "order.paid": {
        if (!pay?.order_id || !pay?.id) return ok("ignored");
        // Cross-check amount with our own record before granting access
        const { data: row } = await admin.from("payments").select("amount,currency").eq("provider_order_id", pay.order_id).maybeSingle();
        if (!row) return ok("unknown order");
        if (row.amount !== pay.amount || row.currency !== pay.currency) {
          console.error("Amount mismatch", pay.order_id);
          return ok("mismatch");
        }
        const { error } = await admin.rpc("activate_subscription", {
          p_order_id: pay.order_id, p_payment_id: pay.id, p_method: pay.method ?? null,
        });
        if (error) { console.error(error); return new Response("retry", { status: 500 }); } // Razorpay retries
        break;
      }
      case "payment.failed": {
        if (pay?.order_id) {
          await admin.rpc("mark_payment_failed", {
            p_order_id: pay.order_id, p_payment_id: pay.id ?? null, p_reason: pay.error_description ?? null,
          });
        }
        break;
      }
      case "refund.processed": {
        const refund = event?.payload?.refund?.entity;
        const paymentId = refund?.payment_id ?? pay?.id;
        const total = pay?.amount ?? null;
        const refunded = pay?.amount_refunded ?? refund?.amount ?? 0;
        // Only a FULL refund ends Pro access
        if (paymentId && (total === null || refunded >= total)) {
          await admin.rpc("mark_payment_refunded", { p_payment_id: paymentId });
        }
        break;
      }
      default:
        break; // other events ignored
    }
  } catch (e) {
    console.error(e);
    return new Response("error", { status: 500 });
  }
  return ok();
});
