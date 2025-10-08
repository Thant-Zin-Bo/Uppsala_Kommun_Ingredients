import { useState, useEffect } from 'react';
import { supabase, deleteManualLabel } from '../supabaseClient';

function UserProfile({ user, onBack, onEditLabel }) {
  const [communityLabels, setCommunityLabels] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUserData();
  }, [user]);

  const fetchUserData = async () => {
    try {
      setLoading(true);

      // Fetch community labels
      const { data: labels, error: labelsError } = await supabase
        .from('manual_labels')
        .select('*')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });

      if (labelsError) {
        console.error('Error fetching labels:', labelsError);
        setCommunityLabels([]);
      } else {
        setCommunityLabels(labels || []);
      }

      // Fetch latest 3 search histories
      const { data: searches, error: searchesError } = await supabase
        .from('search_history')
        .select('*')
        .eq('user_id', user.id)
        .order('searched_at', { ascending: false })
        .limit(3);

      if (searchesError) {
        console.error('Error fetching search history:', searchesError);
        setSearchHistory([]);
      } else {
        setSearchHistory(searches || []);
      }
    } catch (error) {
      console.error('Error fetching user data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (labelId) => {
    if (!confirm('Are you sure you want to delete this label?')) return;

    try {
      const { error } = await deleteManualLabel(labelId);
      if (error) {
        console.error('Delete failed:', error);
        alert('Failed to delete label: ' + error.message);
      } else {
        // Refresh the labels list
        await fetchUserData();
      }
    } catch (error) {
      console.error('Error deleting label:', error);
      alert('Failed to delete label');
    }
  };

  const handleEdit = (label) => {
    // Create ingredient object that matches the expected format
    const ingredient = {
      name: label.ingredient_name,
      status: label.status
    };
    // Close profile and open edit modal
    onBack();
    onEditLabel(label, ingredient);
  };

  if (loading) {
    return (
      <div className="profile-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <button onClick={onBack} className="btn-back">
            <span className="material-symbols-outlined">arrow_back</span> Back
          </button>
          <h2 style={{ margin: 0 }}>My Profile</h2>
        </div>
        <p style={{ textAlign: 'center', color: '#6b7280', padding: '2rem' }}>Loading...</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button onClick={onBack} className="btn-back">
          <span className="material-symbols-outlined">arrow_back</span> Back
        </button>
        <h2 style={{ margin: 0 }}>My Profile</h2>
      </div>

      {/* User Info */}
      <div className="profile-section">
        <h3>
          <span className="material-symbols-outlined">person</span>
          Account Information
        </h3>
        <p><strong>Email:</strong> {user.email}</p>
      </div>

      {/* Community Labels */}
      <div className="profile-section">
        <h3>
          <span className="material-symbols-outlined">label</span>
          My Community Labels ({communityLabels.length})
        </h3>
        {communityLabels.length > 0 ? (
          <div className="community-labels-list">
            {communityLabels.map((label) => (
              <div key={label.id} className="label-item">
                <div className="label-header">
                  <strong>{label.ingredient_name}</strong>
                  <span className={`label-badge label-badge-${label.status}`}>
                    {label.custom_status_label || label.status.toUpperCase()}
                  </span>
                </div>
                {label.notes && <p className="label-notes">{label.notes}</p>}
                <div className="label-footer-profile">
                  <p className="label-date">
                    Added on {new Date(label.created_at).toLocaleDateString()}
                  </p>
                  <div className="label-actions-profile">
                    <button onClick={() => handleEdit(label)} className="btn-edit-profile">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(label.id)} className="btn-delete-profile">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
            No community labels yet. Start adding labels to help others!
          </p>
        )}
      </div>

      {/* Search History */}
      <div className="profile-section">
        <h3>
          <span className="material-symbols-outlined">history</span>
          Recent Searches
        </h3>
        {searchHistory.length > 0 ? (
          <div className="search-history-list">
            {searchHistory.map((search) => (
              <div key={search.id} className="search-item">
                <div className="search-header">
                  <span className="material-symbols-outlined">search</span>
                  <strong>{new Date(search.searched_at).toLocaleDateString()}</strong>
                </div>
                <div className="search-ingredients">
                  {search.ingredients_list && search.ingredients_list.length > 0 ? (
                    search.ingredients_list.slice(0, 5).map((ing, idx) => (
                      <span key={idx} className="ingredient-pill">
                        {ing}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>No ingredients</span>
                  )}
                  {search.ingredients_list && search.ingredients_list.length > 5 && (
                    <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
                      +{search.ingredients_list.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: '#6b7280', fontStyle: 'italic' }}>
            No search history yet. Start analyzing ingredients!
          </p>
        )}
      </div>
    </div>
  );
}

export default UserProfile;
