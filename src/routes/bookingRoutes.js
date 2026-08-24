const express = require('express');
const bookingController = require('../controllers/bookingController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.use(protect);

router
  .route('/')
  .get(bookingController.getBookings)
  .post(bookingController.createBooking);

router.put('/:id/cancel', bookingController.cancelBooking);

module.exports = router;
