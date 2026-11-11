MEDSTOCK – UPDATED PROJECT

FILES
- index.html: website structure (Medicine Information module removed)
- style.css: responsive styling
- script.js: authentication, inventory, billing, supplier comparison
- config.js: Supabase project URL and publishable/anon key
- database.sql: complete SQL setup for medicines, suppliers, sales and supplier offers

SETUP
1. Extract this ZIP. Open the folder in VS Code.
2. Open config.js and enter your Supabase Project URL and anon/publishable key. Never use a service_role or secret key in browser code.
3. In Supabase Dashboard → SQL Editor, run the ENTIRE database.sql file. This creates the original tables and the new supplier-offer comparison table.
4. In Supabase Authentication, enable Email sign-in. Configure Site URL / redirect URLs for your local and deployed website.
5. Run index.html using VS Code Live Server. Create an account and sign in.
6. In Supplier Management, add multiple suppliers. Add one medicine offer per supplier with composition, strength, dosage form, manufacturer, pack size, price, stock and expiry.
7. Compare offers. The recommendation is a decision aid using price, stock, expiry and supplier verification. Select the chosen supplier; matching offers are automatically marked Rejected but retained.

IMPORTANT
- The Medicine Information/openFDA feature has been removed because it did not cover every medicine brand and tablet.
- A recommendation is not proof of medicine quality or authenticity. Verify supplier drug licence, GST details, batch, manufacturer, packaging, expiry and authenticity before purchasing.
- Supplier verification status is manually entered by the pharmacy; the app does not independently validate licences.
- This is an educational/demo application, not a certified pharmacy, clinical or regulatory system. Do not use it as a substitute for professional verification or legal compliance.
- Keep Supabase Row Level Security enabled. Never expose service_role keys.
