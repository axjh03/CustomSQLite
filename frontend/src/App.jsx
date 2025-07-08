import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import { api } from './services/api';

const databases = {
  'sample.db': {
    name: 'Sample Database',
    description: 'A simple database with a few tables.',
    tables: ['apples', 'oranges'],
    suggestions: [
      'SELECT * FROM apples LIMIT 10;',
      'SELECT * FROM apples WHERE color = "Red";',
      'SELECT * FROM oranges;',
      'INSERT INTO apples (name, color) VALUES ("Pink Lady", "pink");',
    ],
  },
  'chinook.db': {
    name: 'Chinook',
    description: 'A sample database for a music store.',
    tables: [
      'artists',
      'albums',
      'tracks',
      'customers',
      'invoices',
      'invoice_items',
    ],
    suggestions: [
      'SELECT * FROM artists LIMIT 5;',
      "SELECT Name FROM artists WHERE ArtistId = 10;",
      "SELECT * FROM albums WHERE ArtistId = 15;",
      "SELECT artists.Name, albums.Title FROM artists JOIN albums ON artists.ArtistId = albums.ArtistId LIMIT 5;",
      "SELECT COUNT(*) AS NumberOfTracks FROM tracks;",
    ],
  },
};

export default function App() {
  const [selectedDatabase, setSelectedDatabase] = useState('sample.db');
  const [sqlQuery, setSqlQuery] = useState(
    databases['sample.db'].suggestions[0],
  );
  const [queryResult, setQueryResult] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showBackendModal, setShowBackendModal] = useState(false);
  const [backendStatus, setBackendStatus] = useState('checking'); // 'checking', 'starting', 'ready', 'error'
  const [connectionAttempts, setConnectionAttempts] = useState(0);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 4000); // Auto hide after 4 seconds
  };

  useEffect(() => {
    checkBackendConnection();
    
    // Add event listener for query applied feedback
    const handleQueryApplied = (event) => {
      const query = event.detail.query;
      // Find the clicked suggestion and add visual feedback
      const suggestions = document.querySelectorAll('.query-suggestion');
      suggestions.forEach(suggestion => {
        if (suggestion.querySelector('code').textContent === query) {
          suggestion.classList.add('clicked');
          setTimeout(() => {
            suggestion.classList.remove('clicked');
          }, 300);
        }
      });
    };
    
    window.addEventListener('queryApplied', handleQueryApplied);
    
    return () => {
      window.removeEventListener('queryApplied', handleQueryApplied);
    };
  }, []);

  const checkBackendConnection = async () => {
    try {
      const isHealthy = await api.healthCheck(selectedDatabase);
      if (isHealthy) {
        setBackendStatus('ready');
        setShowBackendModal(false);
        showToast('Backend connected successfully!', 'success');
      } else {
        throw new Error('Health check failed');
      }
    } catch {
      console.log('Backend not ready, showing startup modal');
      setBackendStatus('starting');
      setShowBackendModal(true);
      setConnectionAttempts(0);
      setTimeElapsed(0);
      startBackendPolling();
    }
  };

  const startBackendPolling = () => {
    let attempts = 0;
    let elapsed = 0;
    
    // Update time elapsed every second
    const timeInterval = setInterval(() => {
      elapsed += 1;
      setTimeElapsed(elapsed);
    }, 1000);

    const pollInterval = setInterval(async () => {
      attempts += 1;
      setConnectionAttempts(attempts);
      
      try {
        const isHealthy = await api.healthCheck(selectedDatabase);
        if (isHealthy) {
          setBackendStatus('ready');
          setShowBackendModal(false);
          showToast('Backend connected successfully!', 'success');
          clearInterval(pollInterval);
          clearInterval(timeInterval);
        } else {
          throw new Error('Health check failed');
        }
      } catch {
        // Backend still not ready, continue polling
        console.log(`Connection attempt ${attempts} failed, retrying...`);
      }
    }, 2000); // Check every 2 seconds

    // Stop polling after 60 seconds
    setTimeout(() => {
      clearInterval(pollInterval);
      clearInterval(timeInterval);
      if (backendStatus !== 'ready') {
        setBackendStatus('error');
      }
    }, 60000);
  };

  const retryConnection = () => {
    setBackendStatus('starting');
    setConnectionAttempts(0);
    setTimeElapsed(0);
    startBackendPolling();
  };

  const handleDatabaseChange = (databaseKey) => {
    setSelectedDatabase(databaseKey);
    setSqlQuery(databases[databaseKey].suggestions[0]);
    setQueryResult(null);
    setError(null);
  };

  const handleQuerySuggestionClick = (query) => {
    setSqlQuery(query);
    // Add visual feedback
    const event = new CustomEvent('queryApplied', { detail: { query } });
    window.dispatchEvent(event);
  };

  const executeQuery = async () => {
    if (!sqlQuery.trim()) {
      setError('Please enter a SQL query');
      showToast('Please enter a SQL query', 'error');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.executeQuery(sqlQuery, selectedDatabase);
      console.log('Query result:', result);
      setQueryResult(result);
      
      // Show success message for INSERT, UPDATE, DELETE operations
      if (result.message) {
        showToast(result.message, 'success');
      }
    } catch (err) {
      console.error('Query error:', err);
      const errorMessage = 'Failed to execute query: ' + (err.message || err);
      setError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const currentDb = databases[selectedDatabase];

  return (
    <div>
      <Navbar />
      
      {/* Toast Notification */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <div className="toast-content">
            <span className="toast-message">{toast.message}</span>
            <button 
              className="toast-close" 
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}
      
      {/* Backend Startup Modal */}
      {showBackendModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h2>
                {backendStatus === 'starting' && '🚀 Server Waking Up'}
                {backendStatus === 'error' && '⚠️ Connection Failed'}
              </h2>
            </div>
            <div className="modal-body">
              {backendStatus === 'starting' && (
                <>
                  <div className="loading-spinner"></div>
                  <p>Please wait while the backend server is spinning up...</p>
                  <p className="server-info">
                    This may take up to 50 seconds on services like Render that spin down inactive servers.
                  </p>
                  <div className="connection-stats">
                    <div className="stat">
                      <span className="stat-label">Time Elapsed:</span>
                      <span className="stat-value">{timeElapsed}s</span>
                    </div>
                    <div className="stat">
                      <span className="stat-label">Connection Attempts:</span>
                      <span className="stat-value">{connectionAttempts}</span>
                    </div>
                  </div>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${Math.min((timeElapsed / 50) * 100, 100)}%` }}
                    ></div>
                  </div>
                </>
              )}
              {backendStatus === 'error' && (
                <>
                  <div className="error-icon">❌</div>
                  <div className="error-message">
                    <p>Failed to connect to the backend server after {timeElapsed} seconds.</p>
                    <p>This could be due to:</p>
                    <ul>
                      <li>The server is taking longer than usual to start</li>
                      <li>Network connectivity issues</li>
                      <li>The backend service is down</li>
                    </ul>
                  </div>
                  <div className="modal-actions">
                    <button 
                      className="retry-button" 
                      onClick={retryConnection}
                    >
                      🔄 Retry Connection
                    </button>
                    <button 
                      className="close-button" 
                      onClick={() => setShowBackendModal(false)}
                    >
                      Continue Offline
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="main-container">
        {/* Sidebar: Database Selection & Tables */}
        <div className="sidebar">
          <div className="database-selector">
            <div className="database-selector-title">Choose Database</div>
            <div className="database-options">
              {Object.entries(databases).map(([key, db]) => (
                <button
                  key={key}
                  className={`database-option ${selectedDatabase === key ? 'active' : ''}`}
                  onClick={() => handleDatabaseChange(key)}
                >
                  <div className="database-name">{db.name}</div>
                  <div className="database-description">{db.description}</div>
                </button>
              ))}
            </div>
          </div>
          
          <div className="current-database">
            <div className="current-database-title">Current Database</div>
            <div className="current-database-info">
              <div className="current-database-name">{currentDb.name}</div>
              <div className="current-database-description">{currentDb.description}</div>
            </div>
          </div>

          <div className="sidebar-title">Available Tables</div>
          <div className="table-chips">
            {currentDb.tables.map((table) => (
              <span key={table} className="table-chip">
                {table}
              </span>
            ))}
          </div>
          <div className="query-tips">
            <div className="query-tips-title">Try these queries:</div>
            <div className="query-suggestions">
              {currentDb.suggestions.map((query, index) => (
                <div
                  key={index}
                  className="query-suggestion"
                  onClick={() => handleQuerySuggestionClick(query)}
                  title="Apply this query"
                >
                  <code>{query}</code>
                  <span className="apply-text">Apply</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Main: SQL Editor & Results */}
        <div className="main-content">
          <div className="sql-editor">
            <div className="editor-title">SQL Editor</div>
            <textarea
              className="sql-input"
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              placeholder="Enter your SQL query here..."
              rows="4"
            ></textarea>
            <button
              className="run-query-button"
              onClick={executeQuery}
              disabled={isLoading}
            >
              {isLoading ? 'Executing...' : 'Run Query'}
            </button>
            {error && (
              <div className="error-message">{error}</div>
            )}
          </div>
          <div className="results">
            <div className="results-title">Results</div>
            {queryResult && (
              <div>
                {/* Handle { columns, values } format */}
                {Array.isArray(queryResult.values) && Array.isArray(queryResult.columns) ? (
                  <div>
                    <table className="results-table">
                      <thead>
                        <tr>
                          {queryResult.columns.map((col, idx) => (
                            <th key={idx}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queryResult.values.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {row.map((cell, colIdx) => (
                              <td key={colIdx}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="row-count">{queryResult.values.length} rows</div>
                  </div>
                ) : queryResult.success && typeof queryResult === 'object' && !Array.isArray(queryResult) ? (
                  <div>
                    {/* Handle object with numeric keys */}
                    {(() => {
                      const dataKeys = Object.keys(queryResult).filter(key => !isNaN(key) && key !== 'success');
                      if (dataKeys.length > 0) {
                        const firstRow = queryResult[dataKeys[0]];
                        const columns = Object.keys(firstRow);
                        const rows = dataKeys.map(key => queryResult[key]);
                        
                        return (
                          <div>
                            <table className="results-table">
                              <thead>
                                <tr>
                                  {columns.map((col, idx) => (
                                    <th key={idx}>{col}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, rowIdx) => (
                                  <tr key={rowIdx}>
                                    {columns.map((col, colIdx) => (
                                      <td key={colIdx}>{row[col]}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="row-count">{rows.length} rows</div>
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ) : Array.isArray(queryResult) && queryResult.length > 0 ? (
                  <div>
                    <table className="results-table">
                      <thead>
                        <tr>
                          {Object.keys(queryResult[0]).map((col, idx) => (
                            <th key={idx}>{col}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {queryResult.map((row, rowIdx) => (
                          <tr key={rowIdx}>
                            {Object.values(row).map((cell, cellIdx) => (
                              <td key={cellIdx}>{cell}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="row-count">{queryResult.length} rows</div>
                  </div>
                ) : Array.isArray(queryResult) && queryResult.length === 0 ? (
                  <div className="empty-state">No rows returned</div>
                ) : queryResult.message ? (
                  <div className="message">{queryResult.message}</div>
                ) : (
                  <div className="empty-state">No results to display</div>
                )}
              </div>
            )}
            {!queryResult && !error && (
              <div className="empty-state">Run a query to see results here.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
