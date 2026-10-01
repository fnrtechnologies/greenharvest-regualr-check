-- Drop the old open policies
DROP POLICY IF EXISTS "service_role_all" ON groups;
DROP POLICY IF EXISTS "service_role_all" ON users;
DROP POLICY IF EXISTS "service_role_all" ON payouts;
DROP POLICY IF EXISTS "service_role_all" ON admin_users;
DROP POLICY IF EXISTS "service_role_all" ON earnings;

-- New: only signed-in Supabase Auth users can read/write
CREATE POLICY "authenticated_only" ON groups      FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_only" ON users       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_only" ON payouts     FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_only" ON admin_users FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_only" ON earnings    FOR ALL USING (auth.uid() IS NOT NULL);
