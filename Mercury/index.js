const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Data file path - Replit persists files in the project directory
const DATA_FILE = path.join(__dirname, 'data', 'mercury-data.json');

// Ensure data directory exists
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  const initialData = {
    version: 1,
    initialBalances: {},
    payrolls: [],
    recurringExpenses: [],
    oneOffExpenses: [],
    balanceOverrides: {},
    currentYear: new Date().getFullYear(),
    archivedYears: [],
    lastBackup: null
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
}

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(__dirname));

// API Routes

// Get all data
app.get('/api/data', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    res.json(data);
  } catch (error) {
    console.error('Error reading data:', error);
    res.status(500).json({ error: 'Failed to read data' });
  }
});

// Save all data
app.post('/api/data', (req, res) => {
  try {
    const data = req.body;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error saving data:', error);
    res.status(500).json({ error: 'Failed to save data' });
  }
});

// Update specific field
app.patch('/api/data/:field', (req, res) => {
  try {
    const { field } = req.params;
    const { value } = req.body;

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data[field] = value;
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating field:', error);
    res.status(500).json({ error: 'Failed to update field' });
  }
});

// Serve the main app
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Mercury is running on port ${PORT}`);
});
