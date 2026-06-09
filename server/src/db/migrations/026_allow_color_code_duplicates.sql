-- Fabric Categories Validation Fix
-- Remove global unique constraint on code to allow:
-- 1. Same color code across different materials
-- 2. Same color name across different materials
-- 3. Same material code across different materials
-- Keeps validation for material code uniqueness within same material name only (enforced by app logic)

-- Drop the unique constraint (not an index)
ALTER TABLE fabric_categories DROP CONSTRAINT IF EXISTS fabric_categories_company_id_code_key;

-- Add index for fast lookups (without uniqueness)
CREATE INDEX IF NOT EXISTS idx_fabric_categories_code_lookup 
ON fabric_categories(company_id, code);