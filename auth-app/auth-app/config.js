// Supabase Dashboard > Project Settings > API
// The anon (public) key is safe in the browser because Row Level Security protects the data.
// NEVER put the service_role key or any Razorpay secret here.
window.APP_CONFIG = {
  SUPABASE_URL: "https://qgwogmoqjmgfcbfiuudk.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFnd29nbW9xam1nZmNiZml1dWRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0MjIwNzMsImV4cCI6MjEwODk5ODA3M30.xy8pE5TIjwcnsPdYUnZR42YGJq8-CrsVn8US2wzDe0Q",
  APP_NAME: "Pipespec",

  // ---- Shown on the policy pages and the Contact page (edit these!) ----
  COMPANY_NAME: "Nova AI Technologies",            // your legal / trading name
  SUPPORT_EMAIL: "analysis.ai.nova@gmail.com",
  SUPPORT_PHONE: "+91 00000 00000",
  COMPANY_ADDRESS: "Longowal, Sangrur, Punjab, 148106, India",
  WEBSITE_URL: "https://pipespec.vercel.app/",
  SUPPORT_HOURS: "Mon–Sat, 10:00 AM – 6:00 PM IST",
  JURISDICTION: "India",                        // courts / governing law
  REFUND_DAYS: 7                                // refund window for first purchase
};
