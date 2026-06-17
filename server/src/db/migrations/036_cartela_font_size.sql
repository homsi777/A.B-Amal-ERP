-- Cartela label font size control (pt).

ALTER TABLE cartela_labels
  ADD COLUMN IF NOT EXISTS font_size_pt numeric(4,1) NOT NULL DEFAULT 6.8;
