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
    // Dynamic import OpenAI
    const { OpenAI } = await import('openai');
    
    // Check environment
    const environment = {
      nodeVersion: process.version,
      environment: process.env.NODE_ENV,
      hasOpenaiKey: !!process.env.OPENAI_API_KEY
    };
    
    console.log('Environment:', environment);
    
    // Test OpenAI setup
    try {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        dangerouslyAllowBrowser: true
      });
      
      // Test API call
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a test assistant." },
          { role: "user", content: "Say 'test successful'" }
        ],
        max_tokens: 10
      });
      
      return res.status(200).json({
        status: 'success',
        environment,
        testResponse: completion.choices[0].message
      });
      
    } catch (openaiError) {
      console.error('OpenAI test failed:', openaiError);
      return res.status(500).json({
        status: 'error',
        environment,
        error: 'OpenAI test failed',
        details: openaiError.message,
        response: openaiError.response?.data
      });
    }
    
  } catch (error) {
    console.error('Test endpoint error:', error);
    return res.status(500).json({
      status: 'error',
      error: 'Test endpoint error',
      details: error.message,
      stack: error.stack
    });
  }
} 