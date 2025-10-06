import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://hahjcqpqgktzuimeqyca.supabase.co'
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY || 'your-anon-key-here'

export const supabase = createClient(supabaseUrl, supabaseKey)

// Auth helper functions
export const signInWithEmail = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })
  return { data, error }
}

export const signUpWithEmail = async (email, password) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  })
  return { data, error }
}

export const signOut = async () => {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Manual labels functions
export const getManualLabels = async (ingredientName) => {
  const normalizedName = ingredientName.toLowerCase().trim()
  const { data, error } = await supabase
    .from('manual_labels')
    .select(`
      *,
      votes:label_votes(vote),
      creator:profiles(email)
    `)
    .eq('ingredient_name_normalized', normalizedName)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching manual labels:', error)
    return []
  }

  // Calculate net votes for each label
  return data.map(label => ({
    ...label,
    upvotes: label.votes?.filter(v => v.vote === 1).length || 0,
    downvotes: label.votes?.filter(v => v.vote === -1).length || 0,
    netVotes: (label.votes?.filter(v => v.vote === 1).length || 0) -
              (label.votes?.filter(v => v.vote === -1).length || 0)
  })).sort((a, b) => b.netVotes - a.netVotes)
}

export const createManualLabel = async (ingredientName, status, notes, userId, customStatusLabel = null, customStatusColor = null) => {
  const normalizedName = ingredientName.toLowerCase().trim()
  const { data, error } = await supabase
    .from('manual_labels')
    .insert([
      {
        ingredient_name: ingredientName,
        ingredient_name_normalized: normalizedName,
        status,
        notes,
        created_by: userId,
        custom_status_label: customStatusLabel,
        custom_status_color: customStatusColor
      }
    ])
    .select()

  return { data, error }
}

export const updateManualLabel = async (labelId, status, notes, customStatusLabel = null, customStatusColor = null) => {
  const { data, error } = await supabase
    .from('manual_labels')
    .update({
      status,
      notes,
      custom_status_label: customStatusLabel,
      custom_status_color: customStatusColor,
      updated_at: new Date().toISOString()
    })
    .eq('id', labelId)
    .select()

  return { data, error }
}

export const deleteManualLabel = async (labelId) => {
  const { error } = await supabase
    .from('manual_labels')
    .delete()
    .eq('id', labelId)

  return { error }
}

export const voteOnLabel = async (labelId, userId, vote) => {
  // First, check if user has already voted
  const { data: existingVote } = await supabase
    .from('label_votes')
    .select('*')
    .eq('label_id', labelId)
    .eq('user_id', userId)
    .single()

  if (existingVote) {
    // Update existing vote
    if (existingVote.vote === vote) {
      // Remove vote if clicking same button
      const { error } = await supabase
        .from('label_votes')
        .delete()
        .eq('label_id', labelId)
        .eq('user_id', userId)
      return { error }
    } else {
      // Change vote
      const { data, error } = await supabase
        .from('label_votes')
        .update({ vote })
        .eq('label_id', labelId)
        .eq('user_id', userId)
      return { data, error }
    }
  } else {
    // Create new vote
    const { data, error } = await supabase
      .from('label_votes')
      .insert([{ label_id: labelId, user_id: userId, vote }])
    return { data, error }
  }
}

export const getUserVotes = async (userId) => {
  const { data, error } = await supabase
    .from('label_votes')
    .select('label_id, vote')
    .eq('user_id', userId)

  if (error) return {}

  // Convert to map for easy lookup
  const votesMap = {}
  data.forEach(v => {
    votesMap[v.label_id] = v.vote
  })
  return votesMap
}
