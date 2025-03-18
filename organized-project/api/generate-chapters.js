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
    let allTimestamps = [];
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
      
      // Store all timestamps for content-based selection
      allTimestamps = timestamps;
      
      // Estimate total duration from the last timestamp
      if (timestamps.length > 0) {
        const lastTimestamp = timestamps[timestamps.length - 1];
        totalDuration = getTimestampSeconds(lastTimestamp);
      }
      
      // For string transcripts, we'll send it directly with a note about timestamps
      transcriptText = transcript;
      
      // Add info about available timestamps if found
      if (timestamps.length > 0) {
        // Instead of fixed intervals, select timestamps at content transitions
        // Always include first and last timestamp
        let contentBasedTimestamps = selectContentBasedTimestamps(lines, timestamps);
        
        // Prepend the information
        transcriptText = `VIDEO DURATION: ${formatTimestamp(totalDuration)}
ALL AVAILABLE TIMESTAMPS: ${timestamps.join(', ')}
RECOMMENDED CHAPTER POINTS: ${contentBasedTimestamps.join(', ')}

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

      // Extract all timestamps for content-based selection
      allTimestamps = transcript.map(segment => {
        if (segment.timestamp) return segment.timestamp;
        if (segment.start !== undefined) return formatTimestamp(segment.start);
        return null;
      }).filter(Boolean);

      // Select key segments based on content analysis rather than fixed intervals
      keySegments = selectKeySegmentsBasedOnContent(transcript);
      
      // Format transcript for API use, including context around key segments
      const contextWindow = 5; // Larger context window to understand content better
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
        const end = Math.min(transcript.length, keyIndex + contextWindow + 1);
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
      
      // Also include a representative sample of additional segments for context
      if (transcript.length > keySegments.length * contextWindow * 2) {
        const additionalSamples = sampleAdditionalSegments(transcript, processedSegments, 20);
        if (additionalSamples && additionalSamples.length > 0) {
          transcriptText += "\n\nADDITIONAL CONTEXT SEGMENTS:\n" + additionalSamples.map(segment => {
            const timestamp = segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : '');
            return `[${timestamp}] ${segment.text}`;
          }).join('\n');
        }
      }
      
      // Add all available timestamps for flexibility
      debugInfo.availableTimestamps = allTimestamps;
      
      transcriptText = `VIDEO DURATION: ${formatTimestamp(totalDuration)}
ALL AVAILABLE TIMESTAMPS: ${allTimestamps.join(', ')}
RECOMMENDED CHAPTER POINTS: ${debugInfo.keySegmentTimestamps.join(', ')}

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
1. Create chapters at timestamps where the topic or focus changes in the video
2. First chapter must be at 00:00
3. Generate 5-7 chapters based on content transitions
4. Ensure timestamps are in chronological order
5. Last chapter must not exceed video duration: ${formatTimestamp(totalDuration)}
6. Make titles concise and descriptive (3-6 words)
7. Use actual transcript content for context
8. Use any timestamps from ALL AVAILABLE TIMESTAMPS 
9. DO NOT use the same timestamp more than once
10. Consider RECOMMENDED CHAPTER POINTS as suggestions, but prioritize actual content transitions`
          },
          {
            role: "user",
            content: transcriptText + "\n\nGenerate chapters that reflect the actual content and topics in the video. Format: MM:SS Title or HH:MM:SS Title"
          }
        ],
        temperature: 0.5 // Slightly higher temperature for more creative titles based on content
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
        const match = line.match(/^([\d:]+)\s*-?\s*(.+)$/);
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

// Helper function to select key segments based on content analysis
function selectKeySegmentsBasedOnContent(transcript) {
  const segments = [];
  const numSegments = transcript.length;
  
  // Always include the first segment
  segments.push(transcript[0]);
  
  // Analyze transcript for topic changes and significant shifts
  let prevKeywords = new Set();
  let prevSpeaker = null;
  let significantGapThreshold = 60; // 60 seconds gap is significant
  let lastSelectedSegmentIndex = 0;
  let minSegmentsBetweenChapters = Math.floor(numSegments / 20); // Avoid chapters too close together
  
  for (let i = 10; i < numSegments - 5; i++) {
    if (i - lastSelectedSegmentIndex < minSegmentsBetweenChapters) {
      continue; // Skip if too close to previous key segment
    }
    
    const segment = transcript[i];
    let isSignificant = false;
    
    // Check for significant time gap from previous segment
    if (i > 0 && segment.start !== undefined && transcript[i-1].start !== undefined) {
      const timeGap = segment.start - transcript[i-1].start;
      if (timeGap > significantGapThreshold) {
        isSignificant = true;
      }
    }
    
    // Check for topic change based on keywords
    if (!isSignificant && segment.text) {
      // Extract keywords from current segment and surrounding context
      const contextWindow = 3;
      const contextText = transcript
        .slice(Math.max(0, i - contextWindow), Math.min(numSegments, i + contextWindow + 1))
        .map(s => s.text)
        .join(' ');
      
      const currentKeywords = extractKeywords(contextText);
      
      // Check keyword overlap with previous key segment
      const overlap = [...currentKeywords].filter(k => prevKeywords.has(k)).length;
      const overlapRatio = prevKeywords.size > 0 ? overlap / prevKeywords.size : 0;
      
      if (overlapRatio < 0.3) { // Less than 30% keyword overlap indicates topic change
        isSignificant = true;
        prevKeywords = currentKeywords;
      }
    }
    
    // If speaker changed (if speaker information is available)
    if (!isSignificant && segment.speaker && prevSpeaker && segment.speaker !== prevSpeaker) {
      isSignificant = true;
      prevSpeaker = segment.speaker;
    }
    
    // Check for sentence structure that indicates a new section
    if (!isSignificant && segment.text) {
      const sectionIndicators = [
        "next", "now let's", "moving on", "let's talk about", "turning to", 
        "another", "additionally", "furthermore", "in addition", "next point",
        "let me show you", "as you can see", "new topic", "chapter", "section"
      ];
      
      if (sectionIndicators.some(indicator => segment.text.toLowerCase().includes(indicator))) {
        isSignificant = true;
      }
    }
    
    if (isSignificant) {
      segments.push(segment);
      lastSelectedSegmentIndex = i;
    }
  }
  
  // Always include the last segment if not too close to the previous segment
  const lastSegment = transcript[numSegments - 1];
  if (lastSegment && numSegments - lastSelectedSegmentIndex > minSegmentsBetweenChapters) {
    segments.push(lastSegment);
  }
  
  // If we didn't find enough segments through content analysis, supplement with some evenly spaced ones
  if (segments.length < 5) {
    const desiredCount = 6;
    const missingCount = desiredCount - segments.length;
    
    if (missingCount > 0) {
      const existingIndices = segments.map(seg => transcript.indexOf(seg));
      const interval = Math.floor(numSegments / (desiredCount + 1));
      
      for (let i = 1; i <= missingCount; i++) {
        const targetIndex = i * interval;
        // Avoid duplicates
        if (!existingIndices.includes(targetIndex)) {
          segments.push(transcript[targetIndex]);
        }
      }
    }
  }
  
  // Sort by timestamp/position and ensure we don't have too many
  segments.sort((a, b) => {
    const aIndex = transcript.indexOf(a);
    const bIndex = transcript.indexOf(b);
    return aIndex - bIndex;
  });
  
  // Limit to a reasonable number
  if (segments.length > 8) {
    // Keep first and last, evenly sample the rest
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const middleSegments = segments.slice(1, segments.length - 1);
    
    const sampledMiddle = sampleEvenlySpaced(middleSegments, 6);
    return [firstSegment, ...sampledMiddle, lastSegment];
  }
  
  return segments;
}

// Helper function to extract keywords from text
function extractKeywords(text) {
  if (!text) return new Set();
  
  // Remove common filler words, punctuation
  const cleanedText = text.toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ');
  
  // Filter out common stop words
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'on', 'at', 'to', 'by', 'is', 'am', 'are', 
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 
    'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'so', 'such', 'that', 'which', 'who', 
    'whom', 'this', 'these', 'those', 'then', 'than', 'when', 'why', 'how', 'what', 'where', 'with',
    'um', 'uh', 'like', 'you know', 'just', 'very', 'really', 'quite', 'actually', 'basically'
  ]);
  
  // Extract words, filter stop words, and return as Set
  return new Set(
    cleanedText.split(' ')
      .filter(word => word.length > 3) // Only meaningful words
      .filter(word => !stopWords.has(word))
  );
}

// Helper function to sample evenly spaced items from an array
function sampleEvenlySpaced(array, count) {
  if (!array || array.length <= count) return array;
  
  const result = [];
  const interval = array.length / (count + 1);
  
  for (let i = 1; i <= count; i++) {
    const index = Math.floor(interval * i);
    result.push(array[Math.min(index, array.length - 1)]);
  }
  
  return result;
}

// Helper function to sample additional segments for context
function sampleAdditionalSegments(transcript, alreadyProcessed, count) {
  const unprocessedSegments = transcript.filter((_, index) => !alreadyProcessed.has(index));
  if (unprocessedSegments.length <= count) return unprocessedSegments;
  
  return sampleEvenlySpaced(unprocessedSegments, count);
}

// Helper function to select content-based timestamps
function selectContentBasedTimestamps(lines, timestamps) {
  // Always include first timestamp (00:00)
  const selectedTimestamps = [timestamps[0]];
  
  // Calculate average words per line as a heuristic for paragraph detection
  const avgWordsPerLine = lines.reduce((sum, line) => {
    return sum + (line.split(' ').length);
  }, 0) / lines.length;
  
  // Detect potentially important timestamps
  for (let i = 1; i < timestamps.length - 1; i++) {
    const timestampIndex = lines.findIndex(line => line.includes(`[${timestamps[i]}]`));
    if (timestampIndex === -1) continue;
    
    // Check surrounding context for topic change indicators
    const contextBefore = lines.slice(Math.max(0, timestampIndex - 3), timestampIndex).join(' ');
    const contextAfter = lines.slice(timestampIndex, Math.min(lines.length, timestampIndex + 5)).join(' ');
    const combinedContext = contextBefore + ' ' + contextAfter;
    
    // Topic change indicators
    const topicChangeIndicators = [
      "next", "now let's", "moving on", "let's talk about", "turning to", 
      "another", "additionally", "furthermore", "in addition", "next point",
      "let me show you", "as you can see", "new topic", "chapter", "section"
    ];
    
    const isTopicChange = topicChangeIndicators.some(indicator => 
      combinedContext.toLowerCase().includes(indicator)
    );
    
    // Paragraph change detection - a longer than average line may indicate a new paragraph
    const currentLineWords = lines[timestampIndex].split(' ').length;
    const isParagraphStart = currentLineWords > avgWordsPerLine * 1.5;
    
    // Significant gap detection
    const currentSeconds = getTimestampSeconds(timestamps[i]);
    const prevSeconds = getTimestampSeconds(selectedTimestamps[selectedTimestamps.length - 1]);
    const isSignificantGap = (currentSeconds - prevSeconds) > 120; // More than 2 minutes
    
    if (isTopicChange || isParagraphStart || isSignificantGap) {
      selectedTimestamps.push(timestamps[i]);
    }
  }
  
  // Ensure we have 5-7 timestamps distributed through the video
  if (selectedTimestamps.length < 5 && timestamps.length > 5) {
    const targetCount = Math.min(7, timestamps.length) - selectedTimestamps.length;
    const unselectedTimestamps = timestamps.filter(ts => !selectedTimestamps.includes(ts));
    
    // Add evenly spaced unselected timestamps
    const additionalTimestamps = sampleEvenlySpaced(unselectedTimestamps, targetCount);
    selectedTimestamps.push(...additionalTimestamps);
  }
  
  // Always include the last timestamp
  if (!selectedTimestamps.includes(timestamps[timestamps.length - 1])) {
    selectedTimestamps.push(timestamps[timestamps.length - 1]);
  }
  
  // Sort chronologically
  return selectedTimestamps.sort((a, b) => getTimestampSeconds(a) - getTimestampSeconds(b));
}

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
