-- ربط لون كارتيلة خارجية (cartela_label_colors) بلون حقيقي من كتالوج
-- fabric_colors بدل إدخال رابط صورة نصي حر. العمود القديم image_url يبقى
-- كما هو لكل السجلات الحالية (بلا أي حذف) — يُستبدَل فقط من نموذج
-- الإضافة/التعديل بخيار اختيار لون من المستودع. الربط اختياري بالكامل:
-- يبقى ممكناً إنشاء لون نصي حر بلا أي ربط بالكتالوج، كما هو اليوم.
ALTER TABLE cartela_label_colors
  ADD COLUMN fabric_color_id uuid REFERENCES fabric_colors(id);

CREATE INDEX idx_cartela_label_colors_fabric_color
  ON cartela_label_colors(fabric_color_id) WHERE fabric_color_id IS NOT NULL;
