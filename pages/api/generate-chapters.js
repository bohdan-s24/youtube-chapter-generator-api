import axios from 'axios';

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

// Main API handler
export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Generation-Method');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transcript, videoId, openai_api_key, use_openai_direct } = req.body;
    
    if (!transcript) {
      return res.status(400).json({ 
        error: 'Transcript is required',
        shouldUseLocalGeneration: true
      });
    }

    // Get OpenAI API key with proper error handling
    const apiKey = use_openai_direct ? openai_api_key : process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('No OpenAI API key available');
      return res.status(401).json({ 
        error: 'OpenAI API key is required',
        shouldUseLocalGeneration: true
      });
    }

    // Process transcript and get duration
    let formattedTranscript = '';
    let totalDuration = 0;
    let debugInfo = {
      transcriptType: typeof transcript,
      isArray: Array.isArray(transcript),
      length: Array.isArray(transcript) ? transcript.length : (typeof transcript === 'string' ? transcript.length : 'unknown')
    };

    if (typeof transcript === 'string') {
      const lines = transcript.split('\n');
      formattedTranscript = transcript;
      
      // Extract timestamps
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
      if (transcript.length === 0) {
        return res.status(400).json({
          error: 'Empty transcript array',
          shouldUseLocalGeneration: true
        });
      }

      // Get duration from last segment
      const lastSegment = transcript[transcript.length - 1];
      if (lastSegment.start !== undefined) {
        totalDuration = lastSegment.start + (lastSegment.duration || 0);
      }

      // Format transcript with timestamps
      formattedTranscript = transcript
        .map(segment => {
          const timestamp = segment.timestamp || 
                          (segment.start !== undefined ? formatTimestamp(segment.start) : '');
          return `[${timestamp}] ${segment.text}`;
        })
        .join('\n');

      debugInfo.segmentCount = transcript.length;
    } else {
      return res.status(400).json({
        error: 'Invalid transcript format',
        shouldUseLocalGeneration: true
      });
    }

    if (totalDuration === 0) {
      console.error('Could not determine video duration');
      return res.status(400).json({
        error: 'Could not determine video duration',
        shouldUseLocalGeneration: true
      });
    }

    debugInfo.totalDuration = formatTimestamp(totalDuration);
    console.log(`Processing video ${videoId}, duration: ${debugInfo.totalDuration}, transcript length: ${formattedTranscript.length}`);

    // Call OpenAI API
    try {
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: "gpt-3.5-turbo-16k",
          messages: [
            {
              role: "system",
              content: `You are a YouTube chapter generator. Analyze transcripts and create meaningful chapters.

Rules:
1. Generate 5-10 chapters based on actual content transitions
2. First chapter must be at 00:00 titled "Introduction"
3. Last chapter must not exceed ${formatTimestamp(totalDuration)}
4. Use MM:SS or HH:MM:SS format for timestamps
5. Make titles descriptive (3-6 words)
6. Find natural topic transitions
7. Ensure chronological order
8. Titles should clearly indicate the topic`
            },
            {
              role: "user",
              content: `Generate chapters for this transcript:

VIDEO DURATION: ${formatTimestamp(totalDuration)}

${formattedTranscript}

Create 5-10 chapters that reflect natural topic changes.
Format: "MM:SS Title" or "HH:MM:SS Title"
Start with "00:00 Introduction"`
            }
          ],
          temperature: 0.5,
          max_tokens: 2000
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!openaiResponse.data?.choices?.[0]?.message?.content) {
        throw new Error('Invalid response from OpenAI API');
      }

      const content = openaiResponse.data.choices[0].message.content;
      console.log('OpenAI Response:', content);

      // Parse chapters
      const chapterRegex = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:-\s*)?(.+)/;
      const titles = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const match = line.match(chapterRegex);
          if (!match) return null;

          const timestamp = match[1].trim();
          const title = match[2].trim();
          const timestampSeconds = getTimestampSeconds(timestamp);

          if (timestampSeconds > totalDuration) {
            console.log(`Skipping chapter at ${timestamp} - exceeds duration ${formatTimestamp(totalDuration)}`);
            return null;
          }

          return { timestamp, title };
        })
        .filter(Boolean);

      // Ensure we have the introduction chapter
      if (titles.length === 0) {
        titles.push({ timestamp: "00:00", title: "Introduction" });
      } else if (titles[0].timestamp !== "00:00") {
        titles.unshift({ timestamp: "00:00", title: "Introduction" });
      }

      // Sort by timestamp
      titles.sort((a, b) => getTimestampSeconds(a.timestamp) - getTimestampSeconds(b.timestamp));

      // Return response
      return res.status(200).json({
        titles,
        chapters: titles.map(({ timestamp, title }) => ({ time: timestamp, title })),
        debug: debugInfo
      });

    } catch (openaiError) {
      console.error('OpenAI API Error:', openaiError.response?.data || openaiError);
      
      if (openaiError.response?.status === 401) {
        return res.status(401).json({
          error: 'Invalid OpenAI API key',
          shouldUseLocalGeneration: true
        });
      }
      
      if (openaiError.response?.status === 429) {
        return res.status(429).json({
          error: 'OpenAI API rate limit exceeded',
          shouldUseLocalGeneration: true
        });
      }

      return res.status(500).json({
        error: 'OpenAI API error',
        details: openaiError.response?.data?.error?.message || openaiError.message,
        shouldUseLocalGeneration: true
      });
    }

  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message,
      shouldUseLocalGeneration: true
    });
  }
}
