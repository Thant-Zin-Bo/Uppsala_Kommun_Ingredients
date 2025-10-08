import { useState } from 'react'
import { createManualLabel, updateManualLabel } from '../supabaseClient'
import './ManualLabelModal.css'

function ManualLabelModal({ ingredient, user, onClose, onSuccess, existingLabel }) {
  const [status, setStatus] = useState(existingLabel?.status || 'safe')
  const [customStatusLabel, setCustomStatusLabel] = useState(existingLabel?.custom_status_label || '')
  const [customStatusColor, setCustomStatusColor] = useState(existingLabel?.custom_status_color || '#3b82f6')
  const [notes, setNotes] = useState(existingLabel?.notes || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const isEditing = !!existingLabel
  const isCustomStatus = !['safe', 'danger', 'unknown'].includes(status)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    // Validate custom status
    if (isCustomStatus && !customStatusLabel.trim()) {
      setError('Please enter a label for your custom status')
      return
    }

    setLoading(true)

    try {
      let data, error

      // Map "custom" status to "unknown" for database storage
      const dbStatus = isCustomStatus ? 'unknown' : status

      if (isEditing) {
        ({ data, error } = await updateManualLabel(
          existingLabel.id,
          dbStatus,
          notes,
          isCustomStatus ? customStatusLabel.trim() : null,
          isCustomStatus ? customStatusColor : null
        ))
      } else {
        ({ data, error } = await createManualLabel(
          ingredient.name,
          dbStatus,
          notes,
          user.id,
          isCustomStatus ? customStatusLabel.trim() : null,
          isCustomStatus ? customStatusColor : null
        ))
      }

      if (error) throw error

      onSuccess(data[0])
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="label-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? 'Edit Label' : 'Add Manual Label'}</h2>
          <button onClick={onClose} className="modal-close">×</button>
        </div>

        <div className="modal-body">
          <div className="ingredient-info">
            <strong>Ingredient:</strong> {ingredient.name}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Status</label>
              <div className="status-options">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="status"
                    value="safe"
                    checked={status === 'safe'}
                    onChange={(e) => setStatus(e.target.value)}
                  />
                  <span className="radio-badge radio-safe">🟢 Approved</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="status"
                    value="danger"
                    checked={status === 'danger'}
                    onChange={(e) => setStatus(e.target.value)}
                  />
                  <span className="radio-badge radio-danger">🔴 Non-Approved</span>
                </label>
                <label className="radio-label radio-label-custom">
                  <input
                    type="radio"
                    name="status"
                    value="custom"
                    checked={isCustomStatus}
                    onChange={(e) => setStatus(e.target.value)}
                  />
                  <div className="custom-status-inline">
                    <input
                      type="text"
                      value={customStatusLabel}
                      onChange={(e) => {
                        setCustomStatusLabel(e.target.value)
                        if (!isCustomStatus) setStatus('custom')
                      }}
                      onFocus={() => setStatus('custom')}
                      placeholder="✨ Custom Status"
                      className="custom-status-input"
                      style={{
                        backgroundColor: customStatusColor + '40',
                        color: '#1f2937',
                        borderColor: customStatusColor
                      }}
                      maxLength={30}
                    />
                    <input
                      type="color"
                      value={customStatusColor}
                      onChange={(e) => {
                        setCustomStatusColor(e.target.value)
                        if (!isCustomStatus) setStatus('custom')
                      }}
                      className="custom-color-picker"
                      title="Pick status color"
                    />
                  </div>
                </label>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="notes">Notes (optional)</label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any relevant information about this ingredient..."
                className="form-textarea"
                rows="4"
              />
            </div>

            {error && (
              <div className="auth-message auth-error">
                {error}
              </div>
            )}

            <div className="form-actions">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? 'Saving...' : isEditing ? 'Update Label' : 'Save Label'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default ManualLabelModal
