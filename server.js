const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'donations.db');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname) || '.png';
    cb(null, 'screenshot-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed as payment screenshots!'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files securely
app.use('/uploads', express.static(UPLOAD_DIR));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Jeeva_Mitra_Foundation_DAY4_WHATSAPP_DEMO_FIXED.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to connect to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', DB_PATH);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT NOT NULL,
      contactNumber TEXT NOT NULL,
      address TEXT NOT NULL,
      donationAmount REAL NOT NULL,
      screenshotFilename TEXT NOT NULL,
      screenshotOriginalName TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// API Routes

/**
 * POST /api/donations
 * Accepts donor details & payment screenshot file
 */
app.post('/api/donations', upload.single('paymentScreenshot'), (req, res) => {
  try {
    const fullName = (req.body.fullName || req.body.donorName || '').trim();
    const contactNumber = (req.body.contactNumber || req.body.donorPhone || req.body.phone || '').trim();
    const address = (req.body.address || req.body.donorAddress || '').trim();
    const donationAmount = parseFloat(req.body.donationAmount || req.body.amount || 0);

    if (!fullName || !contactNumber || !address || !donationAmount || isNaN(donationAmount) || donationAmount <= 0) {
      if (req.file) {
        fs.unlinkSync(req.file.path); // Clean up uploaded file if validation fails
      }
      return res.status(400).json({
        success: false,
        error: 'Validation failed. Please provide full name, contact number, address, and a valid donation amount.'
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Payment screenshot image is required.'
      });
    }

    const query = `
      INSERT INTO donations (fullName, contactNumber, address, donationAmount, screenshotFilename, screenshotOriginalName)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const params = [
      fullName,
      contactNumber,
      address,
      donationAmount,
      req.file.filename,
      req.file.originalname
    ];

    db.run(query, params, function (err) {
      if (err) {
        console.error('Error saving donation:', err);
        return res.status(500).json({
          success: false,
          error: 'Database error occurred while saving donation details.'
        });
      }

      const donationId = this.lastID;
      res.status(201).json({
        success: true,
        message: 'Donation details recorded successfully.',
        data: {
          id: donationId,
          fullName,
          contactNumber,
          address,
          donationAmount,
          screenshotUrl: `/uploads/${req.file.filename}`,
          createdAt: new Date().toISOString()
        }
      });
    });
  } catch (error) {
    console.error('Error handling donation submission:', error);
    res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred.'
    });
  }
});

/**
 * GET /api/donations
 * Retrieves all donor submissions
 */
app.get('/api/donations', (req, res) => {
  const query = `SELECT * FROM donations ORDER BY createdAt DESC`;
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Error fetching donations:', err);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve donation records.'
      });
    }

    const donations = rows.map((row) => ({
      ...row,
      screenshotUrl: `/uploads/${row.screenshotFilename}`
    }));

    res.json({
      success: true,
      count: donations.length,
      donations
    });
  });
});

/**
 * GET /api/donations/:id
 * Retrieves a single donor submission
 */
app.get('/api/donations/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT * FROM donations WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database error.' });
    }
    if (!row) {
      return res.status(404).json({ success: false, error: 'Donation record not found.' });
    }
    res.json({
      success: true,
      donation: {
        ...row,
        screenshotUrl: `/uploads/${row.screenshotFilename}`
      }
    });
  });
});

/**
 * DELETE /api/donations/:id
 * Deletes a donation record and its screenshot file
 */
app.delete('/api/donations/:id', (req, res) => {
  const id = req.params.id;
  db.get(`SELECT screenshotFilename FROM donations WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Database query error.' });
    }
    if (!row) {
      return res.status(404).json({ success: false, error: 'Record not found.' });
    }

    const filePath = path.join(UPLOAD_DIR, row.screenshotFilename);

    db.run(`DELETE FROM donations WHERE id = ?`, [id], (deleteErr) => {
      if (deleteErr) {
        return res.status(500).json({ success: false, error: 'Failed to delete record.' });
      }

      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fileErr) {
          console.error('Failed to delete file:', fileErr);
        }
      }

      res.json({
        success: true,
        message: 'Donation record deleted successfully.'
      });
    });
  });
});

// Multer error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

// Only start listening if executed directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}

module.exports = { app, db };
