-- كارتيلة الألوان: سجلات فرعية لكل لون داخل كارتيلا واحدة + باركود Code128 قصير.

CREATE TABLE cartela_label_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cartela_label_id uuid NOT NULL REFERENCES cartela_labels(id) ON DELETE CASCADE,
  color_no int NOT NULL,
  color_code text NOT NULL,
  barcode_code text NOT NULL,
  name_ar text NOT NULL DEFAULT '',
  name_tr text NOT NULL DEFAULT '',
  notes text,
  image_url text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cartela_label_colors_company_barcode UNIQUE (company_id, barcode_code),
  CONSTRAINT cartela_label_colors_cartela_code UNIQUE (cartela_label_id, color_code),
  CONSTRAINT cartela_label_colors_cartela_no UNIQUE (cartela_label_id, color_no),
  CONSTRAINT cartela_label_colors_color_no_chk CHECK (color_no > 0),
  CONSTRAINT cartela_label_colors_color_code_chk CHECK (char_length(trim(color_code)) > 0)
);

CREATE INDEX idx_cartela_label_colors_cartela
  ON cartela_label_colors(cartela_label_id, sort_order, color_no);

CREATE INDEX idx_cartela_label_colors_company_barcode
  ON cartela_label_colors(company_id, barcode_code);
