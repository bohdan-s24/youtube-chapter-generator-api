export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    // Return environment info
    return res.status(200).json({
      status: 'ok',
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      openaiVersion: require('openai/package.json').version,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Test endpoint error',
      details: error.message,
      stack: error.stack
    });
  }
} 