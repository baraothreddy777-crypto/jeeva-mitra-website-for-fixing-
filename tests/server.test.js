const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set isolated test database and upload directory before requiring server
process.env.DB_PATH = path.join(__dirname, 'test_donations.json');
process.env.TIPS_DB_PATH = path.join(__dirname, 'test_tips.json');
process.env.UPLOAD_DIR = path.join(__dirname, 'test_uploads');

const { app, db, tipsDb } = require('../server');

describe('Jeeva Mitra Foundation Donor & Tip Form Backend API', () => {
  let createdDonationId = null;
  let createdTipId = null;
  const testImagePath = path.join(__dirname, 'test_screenshot.png');

  beforeAll((done) => {
    // Create dummy image file for upload testing
    const dummyPngBase64 =
      'iVBORw0KGgoAAAANSU5ErkJggg=='; // minimal base64 png
    fs.writeFileSync(testImagePath, Buffer.from(dummyPngBase64, 'base64'));

    setTimeout(done, 100);
  });

  afterAll((done) => {
    // Clean up test files and DBs
    if (fs.existsSync(testImagePath)) {
      fs.unlinkSync(testImagePath);
    }
    const testUploads = process.env.UPLOAD_DIR;
    if (fs.existsSync(testUploads)) {
      fs.rmSync(testUploads, { recursive: true, force: true });
    }

    const testDbPath = process.env.DB_PATH;
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    const testTipsDbPath = process.env.TIPS_DB_PATH;
    if (fs.existsSync(testTipsDbPath)) {
      fs.unlinkSync(testTipsDbPath);
    }
    done();
  });

  test('GET / should serve the landing page HTML', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Jeeva Mitra Foundation');
  });

  test('GET /admin should serve the admin dashboard page', async () => {
    const res = await request(app).get('/admin');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Admin Dashboard');
  });

  test('POST /api/donations should successfully record donor details with payment screenshot', async () => {
    const res = await request(app)
      .post('/api/donations')
      .field('fullName', 'Ramesh Kumar')
      .field('contactNumber', '+91 9876543210')
      .field('address', '123 Foundation St, Jubilee Hills, Hyderabad')
      .field('donationAmount', '500')
      .attach('paymentScreenshot', testImagePath);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.fullName).toBe('Ramesh Kumar');
    expect(res.body.data.donationAmount).toBe(500);
    expect(res.body.data.screenshotUrl).toMatch(/^\/uploads\/screenshot-/);

    createdDonationId = res.body.data.id;
  });

  test('POST /api/donations should fail if mandatory fields are missing', async () => {
    const res = await request(app)
      .post('/api/donations')
      .field('fullName', '')
      .field('contactNumber', '+91 9876543210')
      .attach('paymentScreenshot', testImagePath);

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Validation failed');
  });

  test('POST /api/donations should fail if payment screenshot is missing', async () => {
    const res = await request(app)
      .post('/api/donations')
      .field('fullName', 'Sita Sharma')
      .field('contactNumber', '+91 9123456789')
      .field('address', '45 Park Road, Bengaluru')
      .field('donationAmount', '1000');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Payment screenshot image is required');
  });

  test('GET /api/donations should return list of submitted donations', async () => {
    const res = await request(app).get('/api/donations');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.donations)).toBe(true);
    expect(res.body.donations.length).toBeGreaterThanOrEqual(1);

    const match = res.body.donations.find((d) => d.id === createdDonationId);
    expect(match).toBeDefined();
    expect(match.fullName).toBe('Ramesh Kumar');
  });

  test('GET /api/donations/:id should return details of specific donation', async () => {
    const res = await request(app).get(`/api/donations/${createdDonationId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.donation.id).toBe(createdDonationId);
    expect(res.body.donation.fullName).toBe('Ramesh Kumar');
  });

  test('DELETE /api/donations/:id should remove donation record', async () => {
    const res = await request(app).delete(`/api/donations/${createdDonationId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app).get(`/api/donations/${createdDonationId}`);
    expect(getRes.statusCode).toBe(404);
  });

  /* Tips API Tests */

  test('POST /api/tips should successfully record tip details with payment screenshot', async () => {
    const res = await request(app)
      .post('/api/tips')
      .field('fullName', 'Priya Patel')
      .field('contactNumber', '+91 9988776655')
      .field('tipAmount', '150')
      .field('notes', 'Keep up the great work!')
      .attach('paymentScreenshot', testImagePath);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.fullName).toBe('Priya Patel');
    expect(res.body.data.tipAmount).toBe(150);
    expect(res.body.data.notes).toBe('Keep up the great work!');
    expect(res.body.data.screenshotUrl).toMatch(/^\/uploads\/screenshot-/);

    createdTipId = res.body.data.id;
  });

  test('POST /api/tips should handle preset amount buttons (e.g., 500) or amount field', async () => {
    const res = await request(app)
      .post('/api/tips')
      .field('fullName', 'Amit Shah')
      .field('amount', '500')
      .attach('paymentScreenshot', testImagePath);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tipAmount).toBe(500);
  });

  test('POST /api/tips should fail if payment screenshot is missing', async () => {
    const res = await request(app)
      .post('/api/tips')
      .field('fullName', 'Anonymous Tipper');

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Payment screenshot image is required');
  });

  test('GET /api/tips should return list of submitted tips', async () => {
    const res = await request(app).get('/api/tips');
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.tips)).toBe(true);
    expect(res.body.tips.length).toBeGreaterThanOrEqual(1);

    const match = res.body.tips.find((t) => t.id === createdTipId);
    expect(match).toBeDefined();
    expect(match.fullName).toBe('Priya Patel');
  });

  test('GET /api/tips/:id should return details of specific tip', async () => {
    const res = await request(app).get(`/api/tips/${createdTipId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.tip.id).toBe(createdTipId);
    expect(res.body.tip.fullName).toBe('Priya Patel');
  });

  test('DELETE /api/tips/:id should remove tip record', async () => {
    const res = await request(app).delete(`/api/tips/${createdTipId}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app).get(`/api/tips/${createdTipId}`);
    expect(getRes.statusCode).toBe(404);
  });
});
