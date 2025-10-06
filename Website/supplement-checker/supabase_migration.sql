-- Add custom status columns to manual_labels table
-- Run this in your Supabase SQL Editor

ALTER TABLE manual_labels
ADD COLUMN IF NOT EXISTS custom_status_label TEXT,
ADD COLUMN IF NOT EXISTS custom_status_color TEXT;

-- Add comment to describe the columns
COMMENT ON COLUMN manual_labels.custom_status_label IS 'Custom user-defined status label (e.g., "Sometimes", "Conditional")';
COMMENT ON COLUMN manual_labels.custom_status_color IS 'Hex color code for custom status (e.g., "#3b82f6")';
