# Login + Pricing + UPI Payments (Supabase + Razorpay)

```
index.html        login / sign up / forgot / reset / account        (from before)
pricing.html      Free vs Pro, monthly/yearly, ₹/$ auto-detect, UPI + card checkout
terms.html  privacy.html  refund.html  delivery.html  contact.html   policy pages (+ legal.css, legal.js)
config.js         your keys + company details (edit this)
schema.sql        step 1 database: profiles                         (from before)
payments.sql      step 2 database: plans, payments, subscriptions
supabase/functions/
   create-order/       creates the Razorpay order (price comes from the DB, not the browser)
   verify-payment/     verifies the signature, re-checks with Razorpay, activates Pro
   razorpay-webhook/   activates Pro even if the user closed the browser after paying in the UPI app
   _shared/utils.ts
```

## Setup

### A. Login (same as before)
1. Supabase → SQL Editor → run `schema.sql`.
2. Put the Supabase URL + anon key in `config.js`, set Site URL / Redirect URLs, enable Google (see the earlier steps: Authentication → URL Configuration and Providers).

### B. Database for payments
Supabase → SQL Editor → paste **`payments.sql`** → Run. (Run `schema.sql` first.)
Prices live in the `plans` table, so you can change them any time:
```sql
update public.plans set amount_inr = 45900 where id = 'pro_monthly';  -- paise
update public.plans set amount_inr = 440000 where id = 'pro_yearly';
```
Default prices: **Pro monthly $5 / ₹449**, **Pro yearly $48 / ₹4,310**. Both are exactly **20% cheaper** than paying monthly for a year, and the page calculates and shows the saved percentage automatically.

### C. Razorpay
1. Create an account at https://razorpay.com and finish activation (the policy pages below are what they ask for).
2. Dashboard → Settings → **API Keys** → generate Test keys first (`rzp_test_…`).
3. Dashboard → Settings → **Payment Methods**: enable **UPI**, Cards, Netbanking, Wallets.
4. For USD / non-India customers: request **International Payments** in Settings. Until it is approved, USD checkout shows a friendly error and customers can pay in INR instead.
5. Dashboard → Settings → **Payment Capture**: keep **Automatic**.

### D. Deploy the 3 functions
Install the Supabase CLI (`npm i -g supabase`), then in this folder:
```bash
supabase login
supabase link --project-ref YOUR-PROJECT-ID

supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxxx RAZORPAY_KEY_SECRET=xxxx RAZORPAY_WEBHOOK_SECRET=choose-a-long-random-string

supabase functions deploy create-order
supabase functions deploy verify-payment
supabase functions deploy razorpay-webhook --no-verify-jwt
```
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.)

### E. Webhook (important for mobile UPI)
Razorpay Dashboard → Settings → **Webhooks → Add**:
- URL: `https://YOUR-PROJECT-ID.supabase.co/functions/v1/razorpay-webhook`
- Secret: the same `RAZORPAY_WEBHOOK_SECRET` you set above
- Events: `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`

This is what activates Pro if a customer pays inside their UPI app and never returns to your page.

### F. Company details and policies
Edit the `COMPANY_*`, `SUPPORT_*`, `JURISDICTION`, `REFUND_DAYS` values in `config.js`. All five policy pages fill themselves from it. Give these URLs to Razorpay when they ask for them:
`/terms.html`, `/privacy.html`, `/refund.html`, `/delivery.html`, `/contact.html`.

### G. Run
```bash
npx serve .      # or: python3 -m http.server 5500
```
Open `http://localhost:5500/pricing.html`. Test payments with Razorpay test mode: UPI ID `success@razorpay` (success) or `failure@razorpay` (failure); test card `4111 1111 1111 1111`, any future expiry, any CVV, OTP `1234` if asked. When everything works, switch to Live keys (`supabase secrets set` again) and use https.

## How it behaves
| Feature | How |
|---|---|
| 2 plans | Free ($0) and Pro |
| Monthly / Yearly toggle | Yearly shows $48/₹4,310, the crossed-out $60/₹5,388, "Save 20%", and the per-month price |
| ₹ auto-detect | India time zone or `-IN` browser language → ₹; otherwise $. Visitors can switch ₹/$ and the choice is remembered |
| UPI on mobile | "Pay with UPI" opens Razorpay's UPI-only screen; on phones it lists installed UPI apps and opens the chosen app directly; on desktop it shows a QR code |
| Other methods | Separate button for cards, netbanking, wallets (INR); cards only for USD |
| Security | Amount is read from the DB server-side; payment signature verified; payment re-checked with Razorpay; amount/currency compared; activation is idempotent; browsers can only read their own rows |
| Pro status | Shown on the pricing page and the account page; renewals stack on the current end date |

## Good to know
- **No auto-renewal.** Each payment buys one month or one year. True auto-debit needs Razorpay Subscriptions / UPI AutoPay, which is a separate integration. The pricing page and policies say "no auto-renewal", so keep them in sync if you add it later.
- **Prices in ₹ are fixed numbers you control**, not live exchange rates, so the customer always pays exactly what they see.
- The policy pages are a sound starting template but are **not legal advice**. Have them checked for your business, and add GST/tax details and invoicing if you are registered.
- Never put `RAZORPAY_KEY_SECRET` or the service-role key in any browser file.
