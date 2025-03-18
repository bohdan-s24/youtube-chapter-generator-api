// This script runs in the context of YouTube pages

// Notify that the content script has loaded
console.log("YouTube Chapter Generator content script loaded");

// Add a message listener to receive commands from the popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  console.log("Content script received message:", request);
  
  if (request.action === 'getVideoId') {
    // Extract video ID from the current URL
    const videoId = getVideoIdFromUrl(window.location.href);
    console.log("Sending video ID:", videoId);
    sendResponse({ videoId: videoId });
  } else if (request.action === 'getTranscript') {
    // Extract transcript from the page
    console.log("Received request to extract transcript");
    
    // Get current video ID
    const currentVideoId = getVideoIdFromUrl(window.location.href);
    if (!currentVideoId) {
      sendResponse({ 
        success: false, 
        error: 'Could not get video ID from current page' 
      });
      return true;
    }
    
    // Extract transcript
    extractTranscript(currentVideoId)
      .then(transcript => {
        console.log("Transcript extraction successful, length:", 
                   typeof transcript === 'string' ? transcript.length : 
                   Array.isArray(transcript) ? transcript.length : 'unknown');
        sendResponse({ success: true, transcript: transcript });
      })
      .catch(error => {
        console.error('Failed to extract transcript:', error);
        sendResponse({ 
          success: false, 
          error: error.message || 'Unknown error during transcript extraction' 
        });
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Extract video ID from URL
function getVideoIdFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const searchParams = new URLSearchParams(urlObj.search);
    const videoId = searchParams.get('v');
    console.log("Extracted video ID:", videoId);
    return videoId;
  } catch (error) {
    console.error('Error extracting video ID:', error);
    return null;
  }
}

// Function to extract transcript from YouTube page
async function extractTranscript(videoId) {
  console.log("Starting transcript extraction for video:", videoId);
  
  if (!videoId) {
    throw new Error('No video ID provided');
  }
  
  try {
    // First attempt: Direct extraction from YouTube's transcript API
    console.log("Attempting direct extraction...");
    let transcript = await attemptDirectExtraction(videoId);
    if (transcript && 
        (Array.isArray(transcript) && transcript.length > 0) && 
        transcript[0].hasOwnProperty('text')) {
      console.log("Direct extraction successful with text segments");
      return transcript;
    }
    
    // Explicitly try to open the transcript panel
    console.log("Direct extraction failed, trying to open transcript panel...");
    await forceOpenTranscriptPanel();
    
    // Wait for panel to load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Try DOM extraction
    transcript = await tryExtractTranscriptFromDOM();
    if (transcript && Array.isArray(transcript) && transcript.length > 0) {
      console.log("DOM extraction successful");
      return transcript;
    }
    
    throw new Error('Could not extract transcript');
    
  } catch (error) {
    console.error("Error during transcript extraction:", error);
    throw error;
  }
}

// Attempts to extract transcript directly from YouTube's internal data
async function attemptDirectExtraction(videoId) {
  try {
    // Try YouTube's transcript API first
    console.log("Attempting to extract transcript using YouTube's API endpoint...");
    const transcript = await getTranscriptFromAPI(videoId);
    if (transcript && transcript.length > 0) {
      console.log(`Successfully extracted ${transcript.length} segments from API`);
      return transcript;
    }
    
    throw new Error('Direct extraction failed');
  } catch (error) {
    console.error("Direct extraction error:", error);
    throw error;
  }
}

// Function to get transcript from YouTube's API
async function getTranscriptFromAPI(videoId) {
  try {
    console.log(`Fetching transcript for video ${videoId} using API approach...`);
    
    // Get caption tracks from ytInitialPlayerResponse
    const ytInitialData = window.ytInitialPlayerResponse;
    if (!ytInitialData?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
      throw new Error('No caption tracks found in player data');
    }
    
    const captionTracks = ytInitialData.captions.playerCaptionsTracklistRenderer.captionTracks;
    console.log(`Found ${captionTracks.length} caption tracks`);
    
    // Select English track (auto-generated or manual)
    let selectedTrack = captionTracks.find(track => 
      track.languageCode === 'en' && track.kind === 'asr'
    ) || captionTracks.find(track => 
      track.languageCode === 'en'
    ) || captionTracks[0];
    
    if (!selectedTrack?.baseUrl) {
      throw new Error('No valid caption track URL found');
    }
    
    console.log("Selected track:", selectedTrack.name?.simpleText);
    
    // Fetch captions
    const url = `${selectedTrack.baseUrl}&fmt=json3`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch captions: ${response.status}`);
    }
    
    const data = await response.json();
    if (!data.events) {
      throw new Error('Invalid caption data format');
    }
    
    // Convert to our format
    const segments = data.events
      .filter(event => event.segs && event.tStartMs !== undefined)
      .map(event => ({
        text: event.segs.map(seg => seg.utf8).join('').trim(),
        start: event.tStartMs / 1000,
        duration: (event.dDurationMs || 0) / 1000,
        timestamp: formatTimestamp(event.tStartMs / 1000)
      }))
      .filter(segment => segment.text);
    
    console.log(`Processed ${segments.length} transcript segments`);
    return segments;
    
  } catch (error) {
    console.error("API extraction error:", error);
    throw error;
  }
}

// Helper function to format seconds to timestamp
function formatTimestamp(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Function to force open transcript panel
async function forceOpenTranscriptPanel() {
  try {
    // Click the "..." menu button if it exists
    const menuButton = document.querySelector('button[aria-label="More actions"]');
    if (menuButton) {
      menuButton.click();
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Look for and click the "Show transcript" button
    const buttons = Array.from(document.querySelectorAll('button'));
    const transcriptButton = buttons.find(button => 
      button.textContent.toLowerCase().includes('transcript')
    );
    
    if (transcriptButton) {
      transcriptButton.click();
      return true;
    }
    
    return false;
  } catch (error) {
    console.error("Error opening transcript panel:", error);
    return false;
  }
}

// Function to extract transcript from DOM
async function tryExtractTranscriptFromDOM() {
  try {
    // Wait for transcript panel
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Find transcript container
    const container = document.querySelector(
      'ytd-transcript-renderer, ' +
      'ytd-transcript-search-panel-renderer'
    );
    
    if (!container) {
      throw new Error('Transcript container not found');
    }
    
    // Get all transcript segments
    const segments = Array.from(container.querySelectorAll('ytd-transcript-segment-renderer'))
      .map(segment => {
        const timestampEl = segment.querySelector('div[class*="time"]');
        const textEl = segment.querySelector('yt-formatted-string');
        
        if (!timestampEl || !textEl) return null;
        
        const timestamp = timestampEl.textContent.trim();
        const text = textEl.textContent.trim();
        const seconds = getTimestampSeconds(timestamp);
        
        return {
          timestamp,
          text,
          start: seconds,
          duration: 0
        };
      })
      .filter(Boolean);
    
    if (segments.length === 0) {
      throw new Error('No transcript segments found');
    }
    
    // Calculate durations
    for (let i = 0; i < segments.length - 1; i++) {
      segments[i].duration = segments[i + 1].start - segments[i].start;
    }
    // Set last segment duration to 5 seconds if unknown
    segments[segments.length - 1].duration = 5;
    
    return segments;
    
  } catch (error) {
    console.error("DOM extraction error:", error);
    throw error;
  }
}

// Helper function to convert timestamp to seconds
function getTimestampSeconds(timestamp) {
  const parts = timestamp.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return parts[0] * 60 + parts[1];
} 