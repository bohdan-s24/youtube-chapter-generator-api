const { OpenAI } = require('openai');

async function testOpenAI() {
  try {
    console.log('Testing OpenAI setup...');
    
    // Check environment
    console.log('Node version:', process.version);
    console.log('OpenAI package version:', require('openai/package.json').version);
    
    // Check API key
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    console.log('OpenAI API key is set');
    
    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: apiKey
    });
    console.log('OpenAI client initialized');
    
    // Test API call
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "Say 'test successful'" }
      ],
      max_tokens: 10
    });
    
    console.log('API Response:', completion.choices[0].message);
    console.log('Test completed successfully');
    
  } catch (error) {
    console.error('Test failed:', error);
    console.error('Error details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      response: error.response?.data
    });
  }
}

testOpenAI(); 