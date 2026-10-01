-- Lets admins set a custom display order for users; tables sort by this by default.
ALTER TABLE users ADD COLUMN order_no integer;
