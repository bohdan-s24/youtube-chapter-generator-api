// Remove static import
// import { OpenAI } from 'openai';

// Add version check
const REQUIRED_NODE_VERSION = '18.0.0';
const currentVersion = process.version;
if (!require('semver').gte(currentVersion, REQUIRED_NODE_VERSION)) {
  throw new Error(`Node.js version ${REQUIRED_NODE_VERSION} or higher is required. Current version: ${currentVersion}`);
}

// OpenAI version check - we'll do this dynamically instead of requiring the package.json
let OPENAI_VERSION;
try {
  // Try to get the version from the openai package
  OPENAI_VERSION = require('openai').version || '4.0.0';
} catch (e) {
  // If we can't get the version, assume it's compatible
  OPENAI_VERSION = '4.0.0';
  console.warn('Could not determine OpenAI package version, proceeding anyway.');
}

// Verify OpenAI version is compatible
if (!OPENAI_VERSION.startsWith('4.')) {
  console.warn(`OpenAI package version 4.x is recommended. Current version: ${OPENAI_VERSION}`);
}

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

// Import required modules
import { OpenAI } from 'openai';
import { YouTubeTranscript } from 'youtube-transcript';

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
    console.log('Request body:', {
      hasVideoId: !!req.body.videoId,
      hasTranscript: !!req.body.transcript,
      transcriptType: typeof req.body.transcript,
      transcriptLength: req.body.transcript ? (Array.isArray(req.body.transcript) ? req.body.transcript.length : req.body.transcript.length) : 0,
      hasApiKey: !!req.body.openai_api_key
    });

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
        transcriptResponse = await YouTubeTranscript.fetchTranscript(videoId);
        if (!transcriptResponse || transcriptResponse.length === 0) {
          throw new Error('No transcript found for this video');
        }
        console.log(`Successfully fetched transcript with ${transcriptResponse.length} segments`);
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
          const time = typeof entry.offset === 'number' ? entry.offset : 
                      typeof entry.start === 'number' ? entry.start : 0;
          const duration = typeof entry.duration === 'number' ? entry.duration : 0;
          
          return {
            time: Math.floor(time / 1000), // Convert milliseconds to seconds
            duration: Math.floor(duration / 1000),
            text: entry.text || '',
            formattedTime: formatTime(Math.floor(time / 1000))
          };
        }).filter(entry => entry.text.trim() !== '') // Remove empty entries
      : typeof transcriptResponse === 'string' 
          ? [{ time: 0, text: transcriptResponse, formattedTime: '00:00' }]
          : [];

    console.log('Processed transcript:', {
      segmentCount: transcriptWithTimestamps.length,
      firstSegment: transcriptWithTimestamps[0],
      lastSegment: transcriptWithTimestamps[transcriptWithTimestamps.length - 1]
    });

    // Validate that we have enough transcript data
    if (transcriptWithTimestamps.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid transcript data', 
        details: 'No valid transcript segments found',
        shouldUseLocalGeneration: true 
      });
    }

    // Initialize OpenAI with better error handling
    try {
      const apiKey = req.body.openai_api_key || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.error('OpenAI API key not provided');
        return res.status(400).json({ 
          error: 'OpenAI API key not provided', 
          shouldUseLocalGeneration: true 
        });
      }

      console.log('Initializing OpenAI client...');
      console.log('Environment:', {
        nodeVersion: process.version,
        environment: process.env.NODE_ENV
      });

      let openai;
      try {
        openai = new OpenAI({
          apiKey: apiKey,
          dangerouslyAllowBrowser: true
        });

        // Test the client with a simple completion
        const testCompletion = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: "Test" }],
          max_tokens: 1
        });

        if (!testCompletion) {
          throw new Error('OpenAI test completion failed');
        }

        console.log('OpenAI client initialized and tested successfully');
      } catch (initError) {
        console.error('OpenAI initialization error:', initError);
        throw new Error(`Failed to initialize OpenAI client: ${initError.message}`);
      }

      // Create a condensed version of the transcript for the prompt
      const totalDuration = transcriptWithTimestamps[transcriptWithTimestamps.length - 1].time;
      const segmentCount = transcriptWithTimestamps.length;
      
      // Sample transcript segments at regular intervals
      const sampleSize = 20;
      const sampledSegments = [];
      const interval = Math.floor(segmentCount / sampleSize);
      
      for (let i = 0; i < segmentCount; i += interval) {
        if (sampledSegments.length < sampleSize) {
          sampledSegments.push(transcriptWithTimestamps[i]);
        }
      }

      console.log('Sampled segments:', {
        sampleSize,
        actualSamples: sampledSegments.length,
        firstSample: sampledSegments[0],
        lastSample: sampledSegments[sampledSegments.length - 1]
      });

      // Prepare a more structured prompt for OpenAI
      const prompt = `
      Create YouTube chapters based on this video transcript.
      Video duration: ${formatTime(totalDuration)}
      Total segments: ${segmentCount}

      Rules:
      1. Create 5-8 evenly spaced chapters
      2. First chapter must be "00:00 Introduction"
      3. Each chapter must start with a timestamp in MM:SS format
      4. Titles should be concise and descriptive (3-7 words)
      5. Use actual timestamps from the transcript segments
      6. Last chapter should not exceed ${formatTime(totalDuration)}

      Sample transcript segments:
      ${sampledSegments.map(seg => 
        `[${seg.formattedTime}] ${seg.text}`
      ).join('\n')}

      Format each line exactly as: "MM:SS Title"
      `;

      console.log('Sending prompt to OpenAI:', {
        promptLength: prompt.length,
        model: "gpt-3.5-turbo",
        temperature: 0.7,
        maxTokens: 500
      });

      // Call OpenAI API with better error handling
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { 
            role: "system", 
            content: "You are a YouTube chapter generator. Create precise, well-timed chapters that follow the exact format: MM:SS Title. Ensure chapters are evenly distributed throughout the video duration." 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      // Process OpenAI response with updated response format
      const chaptersText = completion.choices[0].message.content.trim();
      console.log("Generated chapters text:", chaptersText);

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

      console.log("Parsed chapters:", chapters);

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
      console.error('OpenAI Error:', {
        name: openaiError.name,
        message: openaiError.message,
        stack: openaiError.stack,
        response: openaiError.response?.data
      });

      return res.status(500).json({ 
        error: 'Failed to initialize or use OpenAI', 
        details: openaiError.message,
        name: openaiError.name,
        openaiError: openaiError.response?.data,
        shouldUseLocalGeneration: true
      });
    }
  } catch (error) {
    console.error('Error generating chapters:', {
      error: error.toString(),
      stack: error.stack
    });
    return res.status(500).json({ 
      error: 'Failed to generate chapters', 
      details: error.message,
      stack: error.stack,
      shouldUseLocalGeneration: true
    });
  }
} 