import { Configuration, OpenAIApi } from 'openai';

// Helper function to format seconds to MM:SS or HH:MM:SS
function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// Import youtube-transcript with better error handling
let YouTubeTranscript;
try {
  const { YouTubeTranscript: YTTranscript } = require('youtube-transcript');
  YouTubeTranscript = YTTranscript;
} catch (error) {
  console.error('Error importing youtube-transcript:', error);
  // Create a placeholder with better error messaging
  YouTubeTranscript = {
    fetchTranscript: async () => {
      throw new Error('YouTube Transcript module not available. Using provided transcript instead.');
    }
  };
}

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

  // Only process POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, please use POST' });
  }

  try {
    console.log('Request body:', req.body);
    const { videoId, transcript, openai_api_key } = req.body;

    if (!videoId && !transcript) {
      return res.status(400).json({ error: 'Either videoId or transcript is required' });
    }

    let transcriptResponse;
    
    // If transcript is provided directly, use that
    if (transcript) {
      console.log('Using provided transcript');
      transcriptResponse = transcript;
    } 
    // Otherwise fetch the transcript using the videoId
    else if (videoId) {
      console.log(`Fetching transcript for video ID: ${videoId}`);
      try {
        // Check if YouTubeTranscript is properly initialized
        if (!YouTubeTranscript || typeof YouTubeTranscript.fetchTranscript !== 'function') {
          throw new Error('YouTube Transcript API is not available, please provide transcript directly');
        }
        
        transcriptResponse = await YouTubeTranscript.fetchTranscript(videoId);
        if (!transcriptResponse || transcriptResponse.length === 0) {
          throw new Error('No transcript found for this video');
        }
      } catch (transcriptError) {
        console.error('Error fetching transcript:', transcriptError);
        return res.status(500).json({ 
          error: 'Failed to fetch transcript', 
          details: transcriptError.message,
          videoId: videoId,
          shouldUseLocalGeneration: true
        });
      }
    }
    
    // Process the transcript to include timestamps
    const transcriptWithTimestamps = Array.isArray(transcriptResponse) 
      ? transcriptResponse.map(entry => {
          // Ensure we have valid timestamps
          const time = entry.offset || entry.start || 0;
          const duration = entry.duration || 0;
          
          return {
            time: time,
            duration: duration,
            text: entry.text || '',
            formattedTime: formatTime(time)
          };
        }).filter(entry => entry.text.trim() !== '') // Remove empty entries
      : typeof transcriptResponse === 'string' 
          ? [{ time: 0, text: transcriptResponse, formattedTime: '00:00' }]
          : [];

    // Validate that we have enough transcript data
    if (transcriptWithTimestamps.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid transcript data', 
        details: 'No valid transcript segments found',
        shouldUseLocalGeneration: true 
      });
    }

    // Initialize OpenAI with either provided key or environment variable
    const apiKey = openai_api_key || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ 
        error: 'OpenAI API key not provided', 
        shouldUseLocalGeneration: true 
      });
    }

    const configuration = new Configuration({ apiKey });
    const openai = new OpenAIApi(configuration);

    // Prepare a more structured prompt for OpenAI
    const prompt = `
    Create YouTube chapters based on this video transcript.
    Rules:
    1. Create 5-8 evenly spaced chapters
    2. First chapter must be "00:00 Introduction"
    3. Each chapter must start with a timestamp in MM:SS format
    4. Titles should be concise and descriptive (3-7 words)
    5. Use actual timestamps from the transcript segments

    Transcript segments (showing first 100):
    ${transcriptWithTimestamps.slice(0, 100).map(seg => 
      `[${seg.formattedTime}] ${seg.text}`
    ).join('\n')}

    Format each line exactly as: "MM:SS Title"
    `;

    // Call OpenAI API with better error handling
    try {
      const completion = await openai.createChatCompletion({
        model: "gpt-3.5-turbo",
        messages: [
          { 
            role: "system", 
            content: "You are a YouTube chapter generator. Create precise, well-timed chapters that follow the exact format: MM:SS Title" 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      // Process OpenAI response
      const chaptersText = completion.data.choices[0].message.content.trim();
      console.log("Generated chapters: ", chaptersText);

      // Parse the chapters with improved regex
      const chapterLines = chaptersText.split('\n').filter(line => line.trim() !== '');
      const chapters = chapterLines.map(line => {
        // Match both MM:SS and HH:MM:SS formats
        const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);
        if (match) {
          return {
            time: match[1].trim(),
            title: match[2].trim()
          };
        }
        return null;
      }).filter(Boolean);

      // Validate the generated chapters
      if (!chapters || chapters.length === 0) {
        throw new Error('No valid chapters generated from OpenAI response');
      }

      // Ensure first chapter is at 00:00
      if (!chapters[0].time.match(/^00:00/)) {
        chapters.unshift({
          time: '00:00',
          title: 'Introduction'
        });
      }

      return res.status(200).json({ 
        chapters,
        source: openai_api_key ? 'openai_direct' : 'server_api'
      });
    } catch (openaiError) {
      console.error('Error calling OpenAI:', openaiError);
      return res.status(500).json({ 
        error: 'Failed to generate chapters with OpenAI', 
        details: openaiError.message,
        shouldUseLocalGeneration: true
      });
    }
  } catch (error) {
    console.error('Error generating chapters:', error);
    return res.status(500).json({ 
      error: 'Failed to generate chapters', 
      details: error.message,
      shouldUseLocalGeneration: true
    });
  }
} 