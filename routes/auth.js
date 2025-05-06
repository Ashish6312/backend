const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const Purchase = require('../models/Purchase'); // Add this import
dotenv.config();
const razorpay = require('../razorpay'); // path should match
 // Import Razorpay instance
const crypto = require('crypto');

// Registration route
const generateInviteCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let inviteCode = '';
  for (let i = 0; i < 6; i++) {
    inviteCode += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return inviteCode;
};

router.post('/register', async (req, res) => {
  const { username, phone, password, withdrawPassword, referredBy } = req.body;

  try {
    // Check if the phone number is already registered
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({ msg: 'Phone number is already registered' });
    }

    // Check if the username is already taken
    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ msg: 'Username is already taken' });
    }

    // Generate a unique random invite code
    let inviteCode;
    let isUnique = false;

    while (!isUnique) {
      inviteCode = generateInviteCode();
      const existingCode = await User.findOne({ inviteCode });
      if (!existingCode) {
        isUnique = true;
      }
    }

    // Hash the passwords
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedWithdrawPassword = await bcrypt.hash(withdrawPassword, 10);

    // Create a new user
    const newUser = new User({
      username,
      phone,
      password: hashedPassword,
      withdrawPassword: hashedWithdrawPassword,
      inviteCode,
      referredBy: referredBy || null, // Optional invite code
    });

    // If an invite code is provided, verify it and add the user to the inviter's team
    if (referredBy) {
      const inviter = await User.findOne({ inviteCode: referredBy });
      if (!inviter) {
        return res.status(400).json({ msg: 'Invalid invite code' });
      }

      // Add the new user to the inviter's team
      inviter.team.push({ _id: newUser._id, phone: newUser.phone });
      await inviter.save();
    }

    // Save the new user
    await newUser.save();

    res.status(201).json({ msg: 'Registration successful', inviteCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Find the user by username
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ msg: 'User not found' });

    // Compare the provided password with the stored hashed password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid password' });

    // Generate a JWT token
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);

    // Send the user data and token in the response
    res.status(200).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        phone: user.phone,
        wallet: user.wallet,
        inviteCode: user.inviteCode,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// POST /api/auth/create-order
router.post('/create-order', async (req, res) => {
  const { amount } = req.body;

  try {
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: `receipt_order_${Date.now()}`,
    };
    const order = await razorpay.orders.create(options);
    res.status(200).json(order);
  } catch (error) {console.error("❌ Razorpay Error:", error); // Add this for full logging
    res.status(500).json({ msg: "Razorpay order creation failed", error: error.message });
      }
});

router.post('/verify-payment', async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, phone, transactionPassword, amount } = req.body;

  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto.createHmac("sha256", '6vNLaRJlLVQMczbNja5FTkur')
    .update(sign)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ msg: "Invalid payment signature" });
  }

  // Verify user and recharge wallet
  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: "User not found" });

    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    user.wallet += parseFloat(amount);
    await user.save();

    const transaction = new Transaction({
      phone,
      type: 'Recharge',
      amount: parseFloat(amount),
      status: 'Success',
      description: `Wallet recharged with ₹${amount} via Razorpay.`,
    });

    await transaction.save();

    res.status(200).json({ msg: "Recharge successful", wallet: user.wallet });
  } catch (err) {
    console.error('Error in payment verification:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});
router.post('/check-username', async (req, res) => {
  const { username } = req.body;

  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ msg: 'Username is already taken' });
  }

  res.status(200).json({ msg: 'Username is available' });
});

// POST /api/transaction/recharge
router.post('/transaction/recharge', async (req, res) => {
  const { phone, amount, transactionPassword } = req.body;

  try {
    // Find the user
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Verify the transaction password
    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    // Update the user's wallet
    user.wallet += parseFloat(amount);
    await user.save();

      // Save the transaction
  // Save the transaction
  const transaction = new Transaction({
    phone,
    type: 'Recharge',
    amount: parseFloat(amount),
    status: 'Success',
    description: `Wallet recharged with ₹${amount}. Thank you for using our service!`,
  });


    await transaction.save();

    res.status(200).json({ msg: 'Recharge successful', wallet: user.wallet });
  } catch (err) {
    console.error('Error processing recharge:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// POST /api/transaction/withdraw
router.post('/transaction/withdraw', async (req, res) => {
  const { phone, amount, transactionPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    const withdrawalAmount = parseFloat(amount);
    const finalAmount = withdrawalAmount * 0.9;

    if (user.wallet < withdrawalAmount) {
      return res.status(400).json({ msg: 'Insufficient balance' });
    }

    user.wallet -= withdrawalAmount;
    await user.save();

    const transaction = new Transaction({
      phone,
      type: 'Withdraw',
      amount: withdrawalAmount,
      status: 'Success',
      description: `Withdrawal of ₹${withdrawalAmount} requested. ₹${finalAmount.toFixed(2)} will be received after 10% processing fee.`,
    });

    await transaction.save();

    res.status(200).json({ msg: 'Withdraw successful', wallet: user.wallet });
  } catch (err) {
    console.error('Error during withdraw:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// POST /api/transaction/buy-plan
router.post('/transaction/buy-plan', async (req, res) => {
  const { phone, planId, planPrice } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (user.wallet < planPrice) {
      return res.status(400).json({ msg: 'Insufficient balance' });
    }

    user.wallet -= planPrice;
    // Here, you can also save the plan purchase in the user's history if needed.
    await user.save();

    res.json({ msg: 'Plan purchased successfully', wallet: user.wallet });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
// POST /api/profile/bank-info
router.post('/profile/update-bank', async (req, res) => {
  const { phone, accountNumber, ifscCode } = req.body;

  try {
    // Check if account number is already used by another user
    const existing = await User.findOne({ 'bankInfo.accountNumber': accountNumber });
    if (existing && existing.phone !== phone) {
      return res.status(400).json({ msg: 'Bank account already in use by another user' });
    }

    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    user.bankInfo = { accountNumber, ifscCode };
    await user.save();

    res.json({ msg: 'Bank info updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
router.post('/profile/change-login-password', async (req, res) => {
  const { phone, oldPassword, newPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isMatch = await bcrypt.compare(oldPassword, user.password); // Use bcrypt to compare passwords
    if (!isMatch) {
      return res.status(400).json({ msg: 'Old password incorrect' });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10); // Hash the new password
    user.password = hashedNewPassword;
    await user.save();

    res.json({ msg: 'Login password updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});
router.post('/profile/change-withdraw-password', async (req, res) => {
  const { phone, oldWithdrawPassword, newWithdrawPassword } = req.body;

  try {
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }

    const isMatch = await bcrypt.compare(oldWithdrawPassword, user.withdrawPassword); // Use bcrypt to compare passwords
    if (!isMatch) {
      return res.status(400).json({ msg: 'Old withdraw password incorrect' });
    }

    const hashedNewWithdrawPassword = await bcrypt.hash(newWithdrawPassword, 10); // Hash the new withdraw password
    user.withdrawPassword = hashedNewWithdrawPassword;
    await user.save();

    res.json({ msg: 'Withdraw password updated successfully' });
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/profile/referrals/:inviteCode', async (req, res) => {
  const { inviteCode } = req.params;

  try {
    // Find the referrer user by inviteCode
    const referrer = await User.findOne({ inviteCode });
    if (!referrer) return res.status(404).json({ msg: 'Referrer not found' });

    // Manually populate team members
    const populatedTeam = await Promise.all(
      referrer.team.map(async (member) => {
        const userDetails = await User.findById(member._id);
        return {
          _id: userDetails._id,
          phone: userDetails.phone,
          username: userDetails.username,  // Fetch full details from the user schema
        };
      })
    );

    // Return populated team
    res.status(200).json({ referrals: populatedTeam });
  } catch (err) {
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});


// Route to fetch transaction history
router.get('/transactions/:phone', async (req, res) => {
  const { phone } = req.params;

  try {
    const transactions = await Transaction.find({ phone }).sort({ date: -1 });

    if (!transactions || transactions.length === 0) {
      return res.status(404).json({ msg: 'No transactions found' });
    }

    res.status(200).json({ transactions });
  } catch (err) {
    console.error('Error fetching transactions:', err.message); // Log the error
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Route to validate transaction password
router.post('/validate-transaction-password', async (req, res) => {
  const { phone, transactionPassword } = req.body;

  try {
    // Find the user by phone
    const user = await User.findOne({ phone });
    if (!user) return res.status(404).json({ msg: 'User not found' });

    // Compare the provided password with the hashed password
    const isMatch = await bcrypt.compare(transactionPassword, user.withdrawPassword);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid transaction password' });

    res.status(200).json({ msg: 'Transaction password is valid' });
  } catch (err) {
    console.error('Error validating transaction password:', err.message);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Admin login route
// In routes/auth.js
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  
  // Verify admin credentials
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ msg: 'Invalid credentials' });
  }
  
  // Create token with admin role
  const token = jwt.sign(
    { username, role: 'admin' }, // Must include role: 'admin'
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  console.log('Generated token:', { token, payload: { username, role: 'admin' } });
  
  res.json({ token });
});

// GET /api/user/investments/:userId
router.get('/investments/:userId', async (req, res) => {
  console.log('Fetching investments for user:', req.params.userId);

  try {
    const purchases = await Purchase.find({ userId: req.params.userId, status: 'active' }).populate('planId');
    
    // Check if purchases exist for the user
    if (!purchases || purchases.length === 0) {
      return res.status(404).json({ error: 'No active investments found' });
    }

    const today = new Date();

    const investmentData = purchases.map(purchase => {
      const daysPassed = Math.floor((today - new Date(purchase.purchaseDate)) / (1000 * 60 * 60 * 24));
      const incomeTillNow = daysPassed * purchase.dailyIncome;

      return {
        planName: purchase.planName,
        planType: purchase.planType,
        investedAmount: purchase.price,
        dailyIncome: purchase.dailyIncome,
        totalEarned: incomeTillNow,
        purchaseDate: purchase.purchaseDate,
        status: purchase.status,
      };
    });

    res.json(investmentData);
  } catch (error) {
    console.error('Error fetching investments:', error);
    res.status(500).json({ error: 'Failed to fetch investments' });
  }
});

// Add this new route to your auth.js file

// Add this new route to your auth.js file
// GET /api/auth/user/:id - Get user by ID
router.get('/user/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Return user data without sensitive information
    res.json({
      id: user._id,
      username: user.username,
      phone: user.phone,
      wallet: user.wallet,
      inviteCode: user.inviteCode
    });
  } catch (err) {
    console.error('Error fetching user data:', err.message);
    res.status(500).json({ msg: 'Server error' });
  }
});


module.exports = router;