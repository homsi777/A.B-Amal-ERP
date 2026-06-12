-- Set code = name for ALL categories where they differ.
-- This ensures the UI never shows a confusing second line under category names.
-- Covers codes from purchase import (L1_/L2_ slugs), sync-from-materials (toCode output),
-- and any other auto-generated format.

UPDATE fabric_categories
SET code = name,
    updated_at = now()
WHERE code IS DISTINCT FROM name;
