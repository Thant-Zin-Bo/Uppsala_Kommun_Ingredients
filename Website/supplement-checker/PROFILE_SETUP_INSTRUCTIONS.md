# User Profile Feature Setup Instructions

## What I Fixed

1. **Fixed UserProfile component** - Changed `user_id` to `created_by` to match the database schema
2. **Added error handling** - Errors now log to console instead of crashing
3. **Added search history saving** - When logged-in users analyze ingredients, it saves to the database
4. **Created SQL migration** - New file `add_search_history_table.sql` to create the missing table

## What You Need to Do in Supabase

### Step 1: Run the SQL Migration

1. Go to your Supabase project dashboard
2. Click on "SQL Editor" in the left sidebar
3. Copy the contents of `add_search_history_table.sql`
4. Paste it into a new query
5. Click "Run" to execute it

This will create the `search_history` table with proper permissions.

### Step 2: Verify the Tables Exist

After running the migration, check that these tables exist:
- `manual_labels` (should already exist)
- `search_history` (newly created)

You can verify by going to "Table Editor" in Supabase.

### Step 3: Test the Profile Feature

1. Sign in to your app
2. Create a community label for an ingredient
3. Analyze some ingredients (this saves search history)
4. Click on your email address in the header
5. You should now see:
   - Your community labels
   - Your recent searches (last 3)

## How It Works

### Community Labels
- When you create a label, it saves to `manual_labels` table with your user ID in the `created_by` column
- The profile fetches all labels where `created_by` matches your user ID

### Search History
- Every time you click "Analyze" while logged in, it saves the ingredient list to `search_history`
- The profile fetches the latest 3 searches ordered by `searched_at`

## Troubleshooting

If you still don't see data:

1. **Check browser console** - Look for error messages
2. **Check Supabase logs** - Go to "Logs" in Supabase to see query errors
3. **Verify RLS policies** - Make sure Row Level Security policies allow you to read your own data
4. **Test the queries directly** - Try running the queries in Supabase SQL editor:

```sql
-- Test community labels
SELECT * FROM manual_labels WHERE created_by = 'YOUR_USER_ID';

-- Test search history
SELECT * FROM search_history WHERE user_id = 'YOUR_USER_ID';
```

Replace `'YOUR_USER_ID'` with your actual auth.users ID (you can find it in the auth.users table).
