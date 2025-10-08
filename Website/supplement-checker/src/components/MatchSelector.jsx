import { useState, useEffect } from 'react';
import './MatchSelector.css';

const MatchSelector = ({ ingredient, fuzzyMatches, onSelectMatch, onCancel }) => {
  const [selectedMatch, setSelectedMatch] = useState(null);

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const handleSelect = () => {
    console.log('handleSelect called, selectedMatch:', selectedMatch);
    if (selectedMatch !== null) {
      const match = fuzzyMatches[selectedMatch];
      console.log('Selected match:', match);
      onSelectMatch({
        database: match.database,
        matchedName: match.database === 'novel_food'
          ? match.item.novel_food_name
          : match.item.name,
        policy_item_code: match.database === 'novel_food'
          ? match.item.policy_item_code
          : null,
        confidence: 'user_selected',
        originalSearchTerm: ingredient,
        fuzzyScore: match.confidence / 100,
        matchData: match
      });
    } else {
      console.log('No match selected');
    }
  };

  return (
    <div className="match-selector-overlay" onClick={onCancel}>
      <div className="match-selector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="match-selector-header">
          <h3
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              margin: 0
            }}
          >
            <span
              className="material-symbols-rounded"
              style={{
                fontSize: '25px',
                lineHeight: 1,
                verticalAlign: 'middle'
              }}
            >
              search
            </span>
            Select Correct Match for "{ingredient}"
          </h3>
          <button onClick={onCancel} className="modal-close">×</button>
        </div>


        <div className="match-selector-body">
          <p className="match-selector-hint">
            We found several possible matches using fuzzy search. Select the correct one or mark as unknown:
          </p>

          <div className="match-options">
            {fuzzyMatches.map((match, idx) => (
              <label
                key={idx}
                className={`match-option ${selectedMatch === idx ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="fuzzy-match"
                  checked={selectedMatch === idx}
                  onChange={() => setSelectedMatch(idx)}
                />
                <div className="match-info">
                  <div className="match-header">
                    <span className="match-name">
                      {match.database === 'novel_food'
                        ? match.item.novel_food_name
                        : match.item.name}
                    </span>
                    <span className={`match-confidence ${match.confidence >= 70 ? 'high' : match.confidence >= 50 ? 'medium' : 'low'}`}>
                      {match.confidence}% match
                    </span>
                  </div>

                  {match.wasTranslated && (
                    <div className="match-translation">
                      🌐 Found via translation: "{match.translatedFrom}" → "{match.searchedTerm}"
                    </div>
                  )}

                  <div className="match-details">
                    <span className="match-database">
                      {match.database === 'novel_food' ? '📋 EU Novel Food' : '💊 Substance Guide'}
                    </span>
                    {match.database === 'novel_food' && match.item.novel_food_status && (
                      <span className="match-status">
                        Status: {match.item.novel_food_status}
                      </span>
                    )}
                    {match.database === 'pharma' && (
                      <span className="match-status">
                        {match.item.is_medicine ? '⚠️ Is Medicine' : '✓ Not Medicine'}
                      </span>
                    )}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="match-selector-actions">
            <button onClick={onCancel} className="btn-secondary">
              Unknown
            </button>
            <button
              onClick={handleSelect}
              className="btn-primary"
              disabled={selectedMatch === null}
            >
              Confirm Selection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MatchSelector;
