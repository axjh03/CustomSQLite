const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const getDbInfo = async (db) => {
  try {
    const response = await fetch(`${API_URL}/dbinfo?db=${db}`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching DB info:', error);
    throw error;
  }
};

export const getTables = async (db) => {
  try {
    const response = await fetch(`${API_URL}/tables?db=${db}`);
    if (!response.ok) {
      throw new Error('Network response was not ok');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching tables:', error);
    throw error;
  }
};

export const postQuery = async (query, db) => {
  try {
    const response = await fetch(`${API_URL}/query?db=${db}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Network response was not ok');
    }
    return await response.json();
  } catch (error) {
    console.error('Error posting query:', error);
    throw error;
  }
};

export const api = {
  async executeQuery(query, db = 'sample.db') {
    try {
      const response = await fetch(`${API_URL}/query?db=${encodeURIComponent(db)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      // Handle new backend response: { columns, values, ... }
      if (result.columns && Array.isArray(result.values)) {
        return {
          columns: result.columns,
          values: result.values,
          message: result.message || `Query executed successfully. ${result.values.length} rows returned.`
        };
      }
      // Fallback for old or unexpected formats
      if (result.data && result.data.columns && Array.isArray(result.data.rows)) {
        return {
          columns: result.data.columns,
          values: result.data.rows,
          message: `Query executed successfully. ${result.data.rows.length} rows returned.`
        };
      }
      else if (Array.isArray(result.data)) {
        return {
          columns: result.data.length > 0 ? Object.keys(result.data[0]) : [],
          values: result.data,
          message: `Query executed successfully. ${result.data.length} rows returned.`
        };
      }
      // For non-SELECT queries that don't return rows
      return {
        columns: [],
        values: [],
        message: result.message || 'Query executed successfully.'
      };
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  async healthCheck(db = 'sample.db') {
    try {
      const response = await fetch(`${API_URL}/tables?db=${encodeURIComponent(db)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  },

  async getDatabaseInfo() {
    try {
      const [tablesResponse, schemaResponse] = await Promise.all([
        fetch(`${API_URL}/tables`).then(res => res.json()),
        fetch(`${API_URL}/tables/schema`).then(res => res.json())
      ]);

      return {
        tables: tablesResponse.tables || [],
        schema: schemaResponse.schema || {}
      };
    } catch (error) {
      console.error('Error fetching database info:', error);
      return this.getMockData();
    }
  },

  // Mock data for when backend is not available
  getMockData() {
    return {
      tables: ['users'],
      schema: {
        users: ['id', 'name', 'email', 'age']
      }
    };
  }
}; 