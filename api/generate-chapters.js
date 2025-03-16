const axios = require('axios');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transcript } = req.body;

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant that generates YouTube chapter titles with timestamps. Generate 5-7 concise and catchy chapter titles. Format each title as 'timestamp - Title'. Make titles engaging and descriptive of the content. Ensure proper chronological order."
          },
          {
            role: "user",
            content: transcript
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Parse the response and format titles
    const content = response.data.choices[0].message.content;
    const titles = content.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [timestamp, ...titleParts] = line.split('-');
        return {
          timestamp: timestamp.trim(),
          title: titleParts.join('-').trim()
        };
      });

    return res.status(200).json({ titles });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    
    // Handle specific OpenAI API errors
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Invalid OpenAI API key' });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }
    
    return res.status(500).json({ 
      error: 'Failed to generate chapters',
      details: error.response?.data?.error?.message || error.message
    });
  }
};
