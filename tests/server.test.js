const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set isolated test database and upload directory before requiring server
process.env.DB_PATH = path.join(__dirname, 'test_donations.json');
process.env.UPLOAD_DIR = path.join(__dirname, 'test_uploads');

const { app, db } = require('../server');

describe('Jeeva Mitra Foundation Donor Form Backend API', () => {
  let createdDonationId = null;
  const testImagePath = path.join(__dirname, 'test_screenshot.png');

  beforeAll((done) => {
    // Create dummy image file for upload testing
    const dummyPngBase64 =
      'iVBORw0KGgoAAAANSU5ErkJggg=='; // minimal base64 png
    fs.writeFileSync(testImagePath, Buffer.from(dummyPngBase64, 'base64'));

    setTimeout(done, 100);
  });

  afterAll((done) => {
    // Clean up test files and DB
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
    expect(res.text).toContain('Submitted Donor Details Admin Dashboard');
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
});
