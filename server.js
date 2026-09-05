const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'donations.json');
const TIPS_DB_PATH = process.env.TIPS_DB_PATH || path.join(__dirname, 'tips.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Pure JS File-Backed Database Store (Zero C++ native binaries, GLIBC-independent)
class JsonStore {
  constructor(filePath, storeKey) {
    this.filePath = filePath;
    this.storeKey = storeKey || 'items';
    this.data = { nextId: 1, [this.storeKey]: [] };
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        if (fileContent.trim()) {
          this.data = JSON.parse(fileContent);
          if (!this.data[this.storeKey]) {
            const foundKey = Object.keys(this.data).find((k) => Array.isArray(this.data[k])) || this.storeKey;
            if (foundKey !== this.storeKey && Array.isArray(this.data[foundKey])) {
              this.storeKey = foundKey;
            } else {
              this.data[this.storeKey] = [];
            }
          }
          const list = this.getItems();
          if (!this.data.nextId) {
            const maxId = list.reduce((max, d) => Math.max(max, d.id || 0), 0);
            this.data.nextId = maxId + 1;
          }
        }
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Error reading JSON database, initializing fresh store:', err);
      this.save();
    }
  }

  save() {
    try {
      const tempPath = this.filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error('Error saving to JSON database:', err);
    }
  }

  getItems() {
    return this.data[this.storeKey] || [];
  }

  insert(record) {
    const id = this.data.nextId++;
    const item = {
      id,
      ...record,
      createdAt: record.createdAt || new Date().toISOString()
    };
    this.getItems().push(item);
    this.save();
    return item;
  }

  getAll() {
    return [...this.getItems()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getById(id) {
    const numericId = parseInt(id, 10);
    return this.getItems().find((d) => d.id === numericId) || null;
  }

  deleteById(id) {
    const numericId = parseInt(id, 10);
    const items = this.getItems();
    const index = items.findIndex((d) => d.id === numericId);
    if (index === -1) return null;
    const deleted = items.splice(index, 1)[0];
    this.save();
    return deleted;
  }
}

const db = new JsonStore(DB_PATH, 'donations');
const tipsDb = new JsonStore(TIPS_DB_PATH, 'tips');

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

const uploadSingleScreenshot = (req, res, next) => {
  upload.fields([
    { name: 'paymentScreenshot', maxCount: 1 },
    { name: 'screenshot', maxCount: 1 }
  ])(req, res, (err) => {
    if (err) return next(err);
    if (req.files) {
      if (req.files.paymentScreenshot && req.files.paymentScreenshot[0]) {
        req.file = req.files.paymentScreenshot[0];
      } else if (req.files.screenshot && req.files.screenshot[0]) {
        req.file = req.files.screenshot[0];
      }
    }
    next();
  });
};

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

// API Routes - Donations

/**
 * POST /api/donations
 * Accepts donor details & payment screenshot file
 */
app.post('/api/donations', uploadSingleScreenshot, (req, res) => {
  try {
    const fullName = (req.body.fullName || req.body.donorName || '').trim();
    const contactNumber = (req.body.contactNumber || req.body.donorPhone || req.body.phone || '').trim();
    const address = (req.body.address || req.body.donorAddress || '').trim();
    const donationAmount = parseFloat(req.body.donationAmount || req.body.amount || 0);

    if (!fullName || !contactNumber || !address || !donationAmount || isNaN(donationAmount) || donationAmount <= 0) {
      if (req.file) {
        try {
          fs.unlinkSync(req.file.path); // Clean up uploaded file if validation fails
        } catch (e) {}
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

    const inserted = db.insert({
      fullName,
      contactNumber,
      address,
      donationAmount,
      screenshotFilename: req.file.filename,
      screenshotOriginalName: req.file.originalname
    });

    res.status(201).json({
      success: true,
      message: 'Donation details recorded successfully.',
      data: {
        ...inserted,
        screenshotUrl: `/uploads/${req.file.filename}`
      }
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
  try {
    const rows = db.getAll();
    const donations = rows.map((row) => ({
      ...row,
      screenshotUrl: `/uploads/${row.screenshotFilename}`
    }));

    res.json({
      success: true,
      count: donations.length,
      donations
    });
  } catch (err) {
    console.error('Error fetching donations:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve donation records.'
    });
  }
});

/**
 * GET /api/donations/:id
 * Retrieves a single donor submission
 */
app.get('/api/donations/:id', (req, res) => {
  const donation = db.getById(req.params.id);
  if (!donation) {
    return res.status(404).json({ success: false, error: 'Donation record not found.' });
  }
  res.json({
    success: true,
    donation: {
      ...donation,
      screenshotUrl: `/uploads/${donation.screenshotFilename}`
    }
  });
});

/**
 * DELETE /api/donations/:id
 * Deletes a donation record and its screenshot file
 */
app.delete('/api/donations/:id', (req, res) => {
  const deleted = db.deleteById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Record not found.' });
  }

  const filePath = path.join(UPLOAD_DIR, deleted.screenshotFilename);
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

// API Routes - Tips

/**
 * POST /api/tips
 * Accepts tip details & payment screenshot file
 */
app.post('/api/tips', uploadSingleScreenshot, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Payment screenshot image is required.'
      });
    }

    const fullName = (req.body.fullName || req.body.donorName || req.body.name || 'Anonymous').trim();
    const contactNumber = (req.body.contactNumber || req.body.donorPhone || req.body.phone || '').trim();
    const tipAmount = parseFloat(req.body.tipAmount || req.body.amount || 0);
    const notes = (req.body.notes || req.body.message || req.body.comment || '').trim();

    const inserted = tipsDb.insert({
      fullName: fullName || 'Anonymous',
      contactNumber,
      tipAmount: isNaN(tipAmount) ? 0 : tipAmount,
      notes,
      screenshotFilename: req.file.filename,
      screenshotOriginalName: req.file.originalname
    });

    res.status(201).json({
      success: true,
      message: 'Tip details recorded successfully.',
      data: {
        ...inserted,
        screenshotUrl: `/uploads/${req.file.filename}`
      }
    });
  } catch (error) {
    console.error('Error handling tip submission:', error);
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    res.status(500).json({
      success: false,
      error: 'An unexpected server error occurred.'
    });
  }
});

/**
 * GET /api/tips
 * Retrieves all tip submissions
 */
app.get('/api/tips', (req, res) => {
  try {
    const rows = tipsDb.getAll();
    const tips = rows.map((row) => ({
      ...row,
      screenshotUrl: `/uploads/${row.screenshotFilename}`
    }));

    res.json({
      success: true,
      count: tips.length,
      tips
    });
  } catch (err) {
    console.error('Error fetching tips:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve tip records.'
    });
  }
});

/**
 * GET /api/tips/:id
 * Retrieves a single tip submission
 */
app.get('/api/tips/:id', (req, res) => {
  const tip = tipsDb.getById(req.params.id);
  if (!tip) {
    return res.status(404).json({ success: false, error: 'Tip record not found.' });
  }
  res.json({
    success: true,
    tip: {
      ...tip,
      screenshotUrl: `/uploads/${tip.screenshotFilename}`
    }
  });
});

/**
 * DELETE /api/tips/:id
 * Deletes a tip record and its screenshot file
 */
app.delete('/api/tips/:id', (req, res) => {
  const deleted = tipsDb.deleteById(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Record not found.' });
  }

  const filePath = path.join(UPLOAD_DIR, deleted.screenshotFilename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (fileErr) {
      console.error('Failed to delete file:', fileErr);
    }
  }

  res.json({
    success: true,
    message: 'Tip record deleted successfully.'
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

module.exports = { app, db, tipsDb };
