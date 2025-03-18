const axios = require('axios');

// Last deployment trigger: Today's date - with improved transcript debugging
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
    let totalDuration = 0;
    let keySegments = [];
    let debugInfo = { 
      transcriptType: typeof transcript,
      isArray: Array.isArray(transcript),
      length: Array.isArray(transcript) ? transcript.length : (typeof transcript === 'string' ? transcript.length : 'unknown'),
      sampleSegment: Array.isArray(transcript) && transcript.length > 0 ? JSON.stringify(transcript[0]) : 'N/A'
    };
    
    if (typeof transcript === 'string') {
      // Handle string transcript - try to parse timestamps if it contains [00:00] format
      const lines = transcript.split('\n');
      const timestampRegex = /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/;
      
      // Extract timestamps if available in the format [00:00]
      const timestamps = lines
        .map(line => {
          const match = line.match(timestampRegex);
          return match ? match[1] : null;
        })
        .filter(Boolean);
      
      // Estimate total duration from the last timestamp
      if (timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        totalDuration = getTimestampSeconds(lastTimestamp);
      }
      
      // For string transcripts, we'll send it directly with a note about timestamps
      transcriptText = transcript;
      
      // Add info about available timestamps if found
      if (timestamps.length > 0) {
        // Sample timestamps evenly throughout the transcript
        const numTimestamps = timestamps.length;
        const targetPoints = Math.min(6, numTimestamps);
        const interval = Math.max(1, Math.floor(numTimestamps / targetPoints));
        
        let keyTimestamps = [];
        // Always include the first timestamp
        keyTimestamps.push(timestamps[0]);
        
        // Sample timestamps at regular intervals
        for (let i = interval; i < numTimestamps - interval; i += interval) {
          keyTimestamps.push(timestamps[i]);
        }
        
        // Always include the last timestamp if not too close to previous
        if (timestamps[numTimestamps - 1] !== keyTimestamps[keyTimestamps.length - 1]) {
          keyTimestamps.push(timestamps[numTimestamps - 1]);
        }
        
        // Prepend the information
        transcriptText = `VIDEO DURATION: ${formatTimestamp(totalDuration)}
KEY TIMESTAMPS AVAILABLE: ${keyTimestamps.join(', ')}

TRANSCRIPT:
${transcriptText}`;
      }
      
      debugInfo.timestampsFound = timestamps.length;
      debugInfo.totalDuration = formatTimestamp(totalDuration);
      
    } else if (Array.isArray(transcript)) {
      debugInfo.segmentTypes = transcript.slice(0, 3).map(seg => ({
        hasStart: seg.start !== undefined,
        hasTimestamp: !!seg.timestamp,
        startType: typeof seg.start,
        startValue: seg.start,
        hasDuration: seg.duration !== undefined
      }));
      
      // Calculate total duration from the last segment
      if (transcript.length > 0) {
        const lastSegment = transcript[transcript.length - 1];
        if (lastSegment.start !== undefined) {
          totalDuration = lastSegment.start + (lastSegment.duration || 0);
        }
      }

      // Select key segments from the transcript
      const numSegments = transcript.length;
      const targetPoints = 6; // We want roughly 6 chapters
      const interval = Math.max(1, Math.floor(numSegments / targetPoints));
      
      // Always include the first segment
      keySegments.push(transcript[0]);
      
      // Sample segments at regular intervals
      for (let i = interval; i < numSegments - interval; i += interval) {
        keySegments.push(transcript[i]);
      }
      
      // Always include the last segment if it's not too close to the previous one
      const lastSegment = transcript[numSegments - 1];
      if (lastSegment && (!keySegments.length || 
          Math.abs(getTimestampSeconds(formatTimestamp(lastSegment.start || 0)) - 
                   getTimestampSeconds(formatTimestamp(keySegments[keySegments.length - 1].start || 0))) > 60)) {
        keySegments.push(lastSegment);
      }
      
      // Format transcript for API use, including context around key segments
      const contextWindow = 2; // Number of segments before and after for context
      const processedSegments = new Set();
      
      // Add debugging for key segments
      debugInfo.keySegmentsSelected = keySegments.length;
      debugInfo.keySegmentTimestamps = keySegments.map(seg => {
        if (seg.timestamp) return seg.timestamp;
        if (seg.start !== undefined) return formatTimestamp(seg.start);
        return 'unknown';
      });
      
      transcriptText = keySegments.map(keySegment => {
        const keyIndex = transcript.indexOf(keySegment);
        const start = Math.max(0, keyIndex - contextWindow);
        const end = Math.min(numSegments, keyIndex + contextWindow + 1);
        let segmentText = '';
        
        for (let i = start; i < end; i++) {
          if (!processedSegments.has(i)) {
            const segment = transcript[i];
            const timestamp = segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : '');
            segmentText += `[${timestamp}] ${segment.text}\n`;
            processedSegments.add(i);
          }
        }
        
        return segmentText;
      }).join('\n');
      
      // Add some additional context about available timestamps
      const availableTimestamps = keySegments
        .map(segment => segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : ''))
        .filter(Boolean);
      
      debugInfo.availableTimestamps = availableTimestamps;
      
      transcriptText = `VIDEO DURATION: ${formatTimestamp(totalDuration)}
KEY TIMESTAMPS AVAILABLE: ${availableTimestamps.join(', ')}

TRANSCRIPT SEGMENTS:
${transcriptText}`;
      
    } else {
      transcriptText = JSON.stringify(transcript);
      debugInfo.fallbackUsed = true;
    }
    
    console.log(`Generating chapters for video: ${videoId}, transcript length: ${transcriptText.length}, duration: ${formatTimestamp(totalDuration)}`);
    console.log('Debug info:', JSON.stringify(debugInfo));
    
    // Generate chapters using OpenAI API
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: `You are a YouTube chapter generator. Your task is to analyze video transcripts and create meaningful chapter titles with accurate timestamps. Important rules:
1. Use ONLY timestamps that appear in the transcript (provided in KEY TIMESTAMPS AVAILABLE)
2. First chapter must be at 00:00
3. Generate 5-7 chapters
4. Ensure timestamps are in chronological order
5. Last chapter must not exceed video duration: ${formatTimestamp(totalDuration)}
6. Make titles concise and descriptive (3-6 words)
7. Use actual transcript content for context
8. DO NOT make up timestamps - use only those provided in KEY TIMESTAMPS AVAILABLE
9. DO NOT use the same timestamp more than once
10. Distribute chapters throughout the video - do not cluster all chapters at the start`
          },
          {
            role: "user",
            content: transcriptText + "\n\nGenerate chapters using ONLY the timestamps provided above. Format: MM:SS Title or HH:MM:SS Title"
          }
        ],
        temperature: 0.3 // Lower temperature for more precise timestamp usage
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
          const timestamp = match[1].trim();
          // Convert timestamp to seconds for validation
          const timestampSeconds = getTimestampSeconds(timestamp);
          if (timestampSeconds <= totalDuration) {
            return {
              timestamp: timestamp,
              title: match[2].trim()
            };
          }
          console.log(`Skipping chapter with timestamp ${timestamp} as it exceeds video duration ${formatTimestamp(totalDuration)}`);
        }
        return null;
      })
      .filter(item => item !== null);

    // Ensure we have at least the introduction chapter
    if (titles.length === 0) {
      titles.push({
        timestamp: "00:00",
        title: "Introduction"
      });
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
