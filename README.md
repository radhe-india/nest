# Nest

A small money app for two people: what came in, what we spent, what we saved.

- **Home**: the month at a glance (Came in / Spent / Saved / Left), spending by category with budgets, goals, latest entries.
- **Quick add**: one-tap buttons for regular things (rent, groceries, SIP…).
- **Import**: pick a screenshot (GPay, PhonePe, bank app), a PDF statement or a CSV/Excel file. The phone reads it itself, you tick what to keep, and it's saved. Card bill payments, transfers between your own accounts and duplicates are left unticked.
- **Views**: Together, each person, and the yoga business kept separate.

It's a plain web app (no build step) hosted on GitHub Pages, with data in Supabase. Only people on the `members` list can read or write anything.

## Set up (once)

1. **Supabase → SQL Editor**: run `supabase/schema.sql`, then your private starter file (`seed.sql`, kept out of this repo).
2. **Supabase → Authentication → Users → Add user**: create a user for each of you with email + password, and tick *Auto confirm*.
3. **Supabase → Authentication → Sign In / Providers**: turn off *Allow new users to sign up*.
4. **Supabase → Project Settings → API**: copy the Project URL and the anon/publishable key into `config.js`.
5. **GitHub → Settings → Pages**: deploy from the `main` branch, root folder.

Then open `https://<user>.github.io/nest/`, sign in, and add it to your home screen.

## Try it without signing in

Open the app with `?demo` at the end of the address to see it with example data. Nothing is saved.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css` | Page shell and look |
| `app.js` | Screens, adding and editing, import review |
| `import.js` | Reads screenshots (Tesseract), PDFs (pdf.js) and spreadsheets (SheetJS) on the device |
| `db.js` | Talks to Supabase (or the in-memory demo) |
| `supabase/schema.sql` | Tables, security rules and default categories |
| `config.js` | Your Supabase URL and public key |
