const Razorpay = require("razorpay");
const RAZORPAY_KEY_ID='rzp_test_tCkC2xdxoDsNsP'
const RAZORPAY_SECRET='6vNLaRJlLVQMczbNja5FTkur'
const razorpayInstance = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_SECRET,
});

module.exports = razorpayInstance;
