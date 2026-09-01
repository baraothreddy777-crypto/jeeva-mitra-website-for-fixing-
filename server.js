const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'donations.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Pure JS File-Backed Database Store (Zero C++ native binaries, GLIBC-independent)
class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { nextId: 1, donations: [] };
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf8');
        if (fileContent.trim()) {
          this.data = JSON.parse(fileContent);
          if (!this.data.donations) this.data.donations = [];
          if (!this.data.nextId) {
            const maxId = this.data.donations.reduce((max, d) => Math.max(max, d.id || 0), 0);
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

  insert(record) {
    const id = this.data.nextId++;
    const donation = {
      id,
      fullName: record.fullName,
      contactNumber: record.contactNumber,
      address: record.address,
      donationAmount: record.donationAmount,
      screenshotFilename: record.screenshotFilename,
      screenshotOriginalName: record.screenshotOriginalName,
      createdAt: new Date().toISOString()
    };
    this.data.donations.push(donation);
    this.save();
    return donation;
  }

  getAll() {
    // Return sorted by createdAt DESC
    return [...this.data.donations].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  getById(id) {
    const numericId = parseInt(id, 10);
    return this.data.donations.find((d) => d.id === numericId) || null;
  }

  deleteById(id) {
    const numericId = parseInt(id, 10);
    const index = this.data.donations.findIndex((d) => d.id === numericId);
    if (index === -1) return null;
    const deleted = this.data.donations.splice(index, 1)[0];
    this.save();
    return deleted;
  }
}

const db = new JsonStore(DB_PATH);

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
