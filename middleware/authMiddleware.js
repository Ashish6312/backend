const jwt = require('jsonwebtoken');

const verifyAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('Received Auth Header:', authHeader); // Debug header
  
  if (!authHeader) return res.status(403).json({ msg: 'Access denied - No auth header' });
  
  // Extract the token from "Bearer <token>" format
  const token = authHeader.split(' ')[1];
  
  if (!token) return res.status(403).json({ msg: 'Access denied - Invalid auth format' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('Decoded Token:', decoded); // Debug decoded token
    
    if (decoded.role !== 'admin') {
      console.log('Role verification failed:', decoded.role);
      return res.status(403).json({ msg: 'Insufficient privileges - Not admin role' });
    }
    
    // Add user info to request object for use in routes
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    res.status(403).json({ msg: 'Invalid token - JWT verification failed' });
  }
};

module.exports = { verifyAdmin };