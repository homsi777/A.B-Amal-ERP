-- Phase 2: master data improvements
-- Adds company scoping + is_active to fabric_colors; search indexes

-- fabric_colors was company-independent; scope it properly
ALTER TABLE fabric_colors
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Search / filter indexes
CREATE INDEX IF NOT EXISTS idx_suppliers_name_search   ON suppliers   USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_customers_name_search   ON customers   USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_fabric_items_name_search ON fabric_items USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_fabric_categories_name_search ON fabric_categories USING gin(to_tsvector('simple', name));

-- B-tree indexes for equality / range filters
CREATE INDEX IF NOT EXISTS idx_suppliers_is_active     ON suppliers(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_customers_is_active     ON customers(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_fabric_items_category   ON fabric_items(company_id, category_id);
CREATE INDEX IF NOT EXISTS idx_fabric_items_supplier   ON fabric_items(company_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_fabric_colors_company   ON fabric_colors(company_id);
CREATE INDEX IF NOT EXISTS idx_fabric_variants_color   ON fabric_item_variants(color_id);
