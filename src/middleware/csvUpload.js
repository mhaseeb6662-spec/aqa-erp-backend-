const multer = require('multer');
const AppError = require('../utils/appError');

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const isCsvExt = file.originalname && file.originalname.toLowerCase().endsWith('.csv');
  const isCsvMime = [
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'text/plain',
    'application/octet-stream',
    'text/x-csv',
  ].includes(file.mimetype);

  if (isCsvExt || isCsvMime) {
    cb(null, true);
  } else {
    cb(new AppError('Please upload a valid CSV file (.csv).', 400), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

module.exports = upload;
