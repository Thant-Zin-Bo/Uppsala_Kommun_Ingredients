-- Add custom status columns to manual_labels table

-- Add custom_status_label column (stores custom text like "Novel Food")
ALTER TABLE manual_labels
ADD COLUMN IF NOT EXISTS custom_status_label TEXT;

-- Add custom_status_color column (stores hex color like "#3b82f6")
ALTER TABLE manual_labels
ADD COLUMN IF NOT EXISTS custom_status_color TEXT;

-- Note: We keep the status column with its CHECK constraint
-- When custom_status_label is set, the status column will be 'unknown'
-- but the custom label text will be displayed instead
