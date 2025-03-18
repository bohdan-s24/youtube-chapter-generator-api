const axios = require('axios');

module.exports = async (req, res) => {
  // Enable CORS with appropriate headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Generation-Method');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transcript, videoId, openai_api_key, use_openai_direct } = req.body;
    
    // Validate inputs
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }
    
    // Use user-provided API key if available and direct generation is requested
    const apiKey = use_openai_direct && openai_api_key ? openai_api_key : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(401).json({ 
        error: 'No API key available',
        shouldUseLocalGeneration: true
      });
    }
    
    let transcriptText;
    if (typeof transcript === 'string') {
      transcriptText = transcript;
    } else if (Array.isArray(transcript)) {
      // Format transcript for API use
      transcriptText = transcript.map(segment => {
        const timestamp = segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : '');
        return `[${timestamp}] ${segment.text}`;
      }).join('\n');
    } else {
      transcriptText = JSON.stringify(transcript);
    }
    
    console.log(`Generating chapters for video: ${videoId}, transcript length: ${transcriptText.length}`);
    
    // Generate chapters using OpenAI API
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
            content: transcriptText
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    // Parse the response and format titles
    const content = response.data.choices[0].message.content;
    const titles = content.split('\n')
      .filter(line => line.trim())
      .map(line => {
        const match = line.match(/^([\d:]+)\s*-\s*(.+)$/);
        if (match) {
          return {
            timestamp: match[1].trim(),
            title: match[2].trim()
          };
        }
        return null;
      })
      .filter(item => item !== null);

    // Return consistent format with both titles and chapters for backward compatibility
    return res.status(200).json({ 
      titles: titles,
      chapters: titles.map(item => ({
        time: item.timestamp,
        title: item.title
      }))
    });
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    
    // Handle specific OpenAI API errors
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Invalid OpenAI API key',
        shouldUseLocalGeneration: true
      });
    }
    if (error.response?.status === 429) {
      return res.status(429).json({ 
        error: 'Rate limit exceeded',
        shouldUseLocalGeneration: true
      });
    }
    
    return res.status(500).json({ 
      error: 'Failed to generate chapters',
      details: error.response?.data?.error?.message || error.message,
      shouldUseLocalGeneration: true
    });
  }
};

// Helper function to format seconds to MM:SS or HH:MM:SS
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}
