# Supabase Authentication

The app keeps its Student ID, Admin ID, and Staff ID login fields. Each existing account is imported into Supabase Auth using a deterministic internal email address; users continue to enter their existing ID and password.

## Configure

1. Create a Supabase project and copy its project URL, anon key, and service role key. Students sign up and log in with a real email address; disable email confirmation for immediate login, or leave it enabled and have students confirm their email. If signup emails hit the provider limit, wait for it to reset or configure custom SMTP.
2. The local `.env` file contains `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Set `SUPABASE_SERVICE_ROLE_KEY` only for the one-time migration command; never expose it to the browser or add it to Vercel's runtime environment.
3. Import the accounts from `db.json`:

   Add a real `email` property to each student entry before migrating. The current student entries contain only Student ID, name, and password, so they cannot be migrated to email login until actual addresses are supplied. Student ID remains optional profile metadata for complaint tracking; admin and staff continue to use their IDs.
 
   ```powershell
   $env:SUPABASE_URL = "https://your-project.supabase.co"
   $env:SUPABASE_SERVICE_ROLE_KEY = "your-service-role-key"
   npm run migrate:supabase-users
   Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
   ```

4. Run the local server with Node.js 20.6 or newer:

   ```powershell
   npm start
   ```

   Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel project environment variables, then redeploy.
5. Once the migration succeeds, remove the `password` properties from `db.json` and rotate any credentials that were previously used outside this demo.

The importer marks imported accounts as confirmed. It updates legacy generated student identities to the real student email in place. It can be rerun after passwords are removed from `db.json` to update existing accounts; creating a new imported account still requires its password.

Students create accounts and log in with their real email from the student portal. The optional Student ID is stored only as profile metadata for complaint tracking. Admin and staff continue to authenticate with their IDs and trusted app metadata set by the importer.

This integration authenticates the login form. The app's complaint and staff API routes do not yet validate Supabase access tokens, so those routes are not protected by this login alone.