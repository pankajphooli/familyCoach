# HouseholdHQ (Next.js + Supabase)

## Supabase setup
1. SQL Editor → New query → paste contents of `supabase/schema.sql` → Run.
2. SQL Editor → New query → paste contents of `supabase/policies.sql` → Run.
3. Auth → Providers → enable Email/Password.
4. (Dev) Turn off email confirmations OR set Site URL to http://localhost:3000 and configure SMTP.
5. Settings → API → copy Project URL & anon key for frontend.
6. (Optional) Table Editor → recipes → Import `public/data/recipes_seed_v1.csv`.

## Local run
```bash
cp .env.example .env
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm i
npm run dev
```
Visit http://localhost:3000 → sign up/in → Onboarding → Family → Today → Generate Plan.

## Deploy
- Vercel → import project → add the two env vars → Deploy.
- Update Supabase Auth redirect URLs if confirmations are ON.

Commit
