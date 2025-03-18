const axios = require('axios');

// Last deployment trigger: Today's date - with simplified transcript processing
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
    
    let formattedTranscript = '';
    let totalDuration = 0;
    let debugInfo = { 
      transcriptType: typeof transcript,
      isArray: Array.isArray(transcript),
      length: Array.isArray(transcript) ? transcript.length : (typeof transcript === 'string' ? transcript.length : 'unknown'),
      sampleSegment: Array.isArray(transcript) && transcript.length > 0 ? JSON.stringify(transcript[0]) : 'N/A'
    };
    
    // Format transcript for OpenAI, including all timestamps for every segment
    if (typeof transcript === 'string') {
      // String transcript processing
      const lines = transcript.split('\n');
      formattedTranscript = transcript;
      
      // Try to estimate total duration from timestamps in the format [00:00]
      const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;
      const timestamps = lines
        .map(line => {
          const match = line.match(timestampRegex);
          return match ? match[1] : null;
        })
        .filter(Boolean);
      
      if (timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        totalDuration = getTimestampSeconds(lastTimestamp);
        debugInfo.timestampsFound = timestamps.length;
      }
      
    } else if (Array.isArray(transcript)) {
      // Array transcript processing - format all segments with timestamps
      if (transcript.length > 0) {
        // Get total duration from the last segment
        const lastSegment = transcript[transcript.length - 1];
        if (lastSegment.start !== undefined) {
          totalDuration = lastSegment.start + (lastSegment.duration || 0);
        }
        
        // Format every segment with its timestamp
        formattedTranscript = transcript.map(segment => {
          const timestamp = segment.timestamp || 
                          (segment.start !== undefined ? formatTimestamp(segment.start) : '');
          return `[${timestamp}] ${segment.text}`;
        }).join('\n');
      }
    } else {
      // Fallback for unexpected format
      formattedTranscript = JSON.stringify(transcript);
      debugInfo.fallbackUsed = true;
    }
    
    debugInfo.totalDuration = formatTimestamp(totalDuration);
    
    console.log(`Generating chapters for video: ${videoId}, transcript length: ${formattedTranscript.length}, duration: ${formatTimestamp(totalDuration)}`);
    
    // Simple instruction to OpenAI: give it the full transcript and ask for chapters
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo-16k", // Use 16k model to handle longer transcripts
        messages: [
          {
            role: "system",
            content: `You are a YouTube chapter generator. Your task is to analyze video transcripts and create meaningful chapter titles with accurate timestamps.

Rules:
1. Generate 5-10 chapters based on content transitions in the transcript
2. First chapter must be at 00:00 titled "Introduction"
3. Last chapter must not exceed video duration: ${formatTimestamp(totalDuration)}
4. Each timestamp must be in MM:SS or HH:MM:SS format
5. Make titles catchy and descriptive (3-6 words)
6. Use timestamps that correspond to actual topic changes in the content
7. Ensure timestamps are in chronological order
8. Focus on finding natural topic transitions and important moments`
          },
          {
            role: "user",
            content: `Here is a YouTube video transcript with timestamps:

VIDEO DURATION: ${formatTimestamp(totalDuration)}

${formattedTranscript}

Create 5-10 concise and catchy YouTube chapters based on content transitions in this transcript. 
Format each line as: "MM:SS Title" or "HH:MM:SS Title". 
The first chapter must be at 00:00 for "Introduction" and chapters should reflect natural topic changes.`
          }
        ],
        temperature: 0.7, // Higher temperature for more creative titles
        max_tokens: 2000
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
    console.log("Raw OpenAI response:", content);
    
    const chapterRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-\s*)?(.+)/;
    const titles = content.split('\n')
      .filter(line => line.trim())
      .map(line => {
        // Try matching with the regular expression
        const match = line.match(chapterRegex);
        if (match) {
          const timestamp = match[1].trim();
          const title = match[2].trim();
          // Validate timestamp is within video duration
          const timestampSeconds = getTimestampSeconds(timestamp);
          if (timestampSeconds <= totalDuration) {
            return {
              timestamp: timestamp,
              title: title
            };
          }
          console.log(`Skipping chapter with timestamp ${timestamp} as it exceeds video duration ${formatTimestamp(totalDuration)}`);
        }
        return null;
      })
      .filter(item => item !== null);

    // Ensure we have at least the introduction chapter
    if (titles.length === 0 || titles[0].timestamp !== "00:00") {
      if (titles.length === 0) {
        titles.push({
          timestamp: "00:00",
          title: "Introduction"
        });
      } else if (titles[0].timestamp !== "00:00") {
        titles.unshift({
          timestamp: "00:00",
          title: "Introduction"
        });
      }
    }

    // Sort chapters by timestamp to ensure chronological order
    titles.sort((a, b) => getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp));

    // Return consistent format with both titles and chapters for backward compatibility
    return res.status(200).json({ 
      titles: titles,
      chapters: titles.map(item => ({
        time: item.timestamp,
        title: item.title
      })),
      debug: debugInfo
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
  if (seconds === undefined || seconds === null) return "00:00";
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

// Helper function to convert timestamp string to seconds
function getTimestampSeconds(timestamp) {
  if (!timestamp) return 0;
  
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parts[0] * 60 + parts[1];
}
