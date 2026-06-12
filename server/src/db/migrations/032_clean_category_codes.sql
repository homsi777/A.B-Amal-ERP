-- Remove L1_/L2_/L3_/L4_ prefixes from fabric_categories codes
-- These prefixes were auto-generated during purchase invoice import
-- and cause visual confusion in the categories UI.
-- Set code = name so the UI hides the redundant code display.

UPDATE fabric_categories
SET code = name,
    updated_at = now()
WHERE code ~ '^L[1-4]_';
