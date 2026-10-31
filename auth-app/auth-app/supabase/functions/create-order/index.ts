// POST /functions/v1/create-order   body: { plan_id: "pro_monthly" | "pro_yearly", currency: "INR" | "USD" }
// Creates a Razorpay order. The price is read from the database, never from the browser.
import { adminClient, corsHeaders, env, getUser, json, razorpayAuthHeader } from "../_shared/utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await getUser(req);
    if (!user) return json({ error: "Please log in to continue." }, 401);

    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id ?? "");
    const currency = String(body.currency ?? "").toUpperCase();
    if (currency !== "INR" && currency !== "USD") return json({ error: "Unsupported currency." }, 400);

    const admin = adminClient();
    const { data: plan, error: planErr } = await admin
      .from("plans").select("*").eq("id", planId).eq("active", true).maybeSingle();
    if (planErr || !plan) return json({ error: "Plan not found." }, 404);

    const amount: number = currency === "INR" ? plan.amount_inr : plan.amount_usd;
    if (!Number.isInteger(amount) || amount <= 0) return json({ error: "This plan cannot be purchased." }, 400);

    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: razorpayAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        currency,
        receipt: `r_${crypto.randomUUID().replace(/-/g, "").slice(0, 30)}`, // max 40 chars
        notes: { user_id: user.id, plan_id: plan.id },
      }),
    });
    const order = await rzpRes.json();
    if (!rzpRes.ok) {
      console.error("Razorpay order error", order);
      const msg = order?.error?.description ?? "Could not start the payment.";
      return json({ error: currency === "USD" && /currency|international/i.test(msg)
        ? "USD payments are not enabled on this Razorpay account yet. Please pay in INR."
        : msg }, 502);
    }

    const { error: insErr } = await admin.from("payments").insert({
      user_id: user.id,
      plan_id: plan.id,
      provider_order_id: order.id,
      amount,
      currency,
      status: "created",
    });
    if (insErr) {
      console.error("DB insert error", insErr);
      return json({ error: "Could not save the order. Please try again." }, 500);
    }

    return json({
      order_id: order.id,
      amount,
      currency,
      key_id: env("RAZORPAY_KEY_ID"), // public key id is safe to send
      plan_name: plan.name,
      email: user.email,
    });
  } catch (e) {
    console.error(e);
    return json({ error: "Server error. Please try again." }, 500);
  }
});
