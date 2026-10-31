// POST /functions/v1/verify-payment
// body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the browser right after Razorpay Checkout succeeds.
// 1) checks the HMAC signature, 2) re-checks the payment with Razorpay, 3) activates Pro.
import {
  adminClient, corsHeaders, env, getUser, hmacSha256Hex, json, razorpayAuthHeader, safeEqual,
} from "../_shared/utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await getUser(req);
    if (!user) return json({ error: "Please log in to continue." }, 401);

    const b = await req.json().catch(() => ({}));
    const orderId = String(b.razorpay_order_id ?? "");
    const paymentId = String(b.razorpay_payment_id ?? "");
    const signature = String(b.razorpay_signature ?? "");
    if (!orderId || !paymentId || !signature) return json({ error: "Missing payment details." }, 400);

    // 1) Signature check: HMAC_SHA256(order_id|payment_id, key_secret)
    const expected = await hmacSha256Hex(env("RAZORPAY_KEY_SECRET"), `${orderId}|${paymentId}`);
    if (!safeEqual(expected, signature)) return json({ error: "Payment signature is invalid." }, 400);

    // The order must belong to this logged-in user
    const admin = adminClient();
    const { data: pay } = await admin.from("payments").select("*").eq("provider_order_id", orderId).maybeSingle();
    if (!pay || pay.user_id !== user.id) return json({ error: "Order not found." }, 404);

    // 2) Ask Razorpay directly (never trust the browser alone)
    const auth = razorpayAuthHeader();
    let rp = await (await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, { headers: { Authorization: auth } })).json();
    if (rp.order_id !== orderId || rp.amount !== pay.amount || rp.currency !== pay.currency) {
      return json({ error: "Payment details do not match the order." }, 400);
    }
    if (rp.status === "authorized") {
      // Account is set to manual capture: capture now
      const cap = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: pay.amount, currency: pay.currency }),
      });
      rp = await cap.json();
    }
    if (rp.status !== "captured") {
      return json({ error: "Payment is not completed yet. If money was deducted it will activate automatically." }, 409);
    }

    // 3) Activate (idempotent: safe even if the webhook already did it)
    const { data, error } = await admin.rpc("activate_subscription", {
      p_order_id: orderId, p_payment_id: paymentId, p_method: rp.method ?? null,
    });
    if (error) {
      console.error(error);
      return json({ error: "Payment received but activation failed. Please contact support." }, 500);
    }
    return json({ ok: true, current_period_end: data?.current_period_end });
  } catch (e) {
    console.error(e);
    return json({ error: "Server error. Please try again." }, 500);
  }
});
