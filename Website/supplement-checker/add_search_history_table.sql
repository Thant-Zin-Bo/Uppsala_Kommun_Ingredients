-- Create search_history table to track user searches
CREATE TABLE IF NOT EXISTS search_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  ingredients_list TEXT[] NOT NULL,
  searched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_search_history_user
ON search_history(user_id, searched_at DESC);

-- Enable Row Level Security
ALTER TABLE search_history ENABLE ROW LEVEL SECURITY;

-- Search history policies
CREATE POLICY "Users can view their own search history"
ON search_history FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own search history"
ON search_history FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own search history"
ON search_history FOR DELETE
USING (auth.uid() = user_id);
