// This script runs in the context of YouTube pages

// Notify that the content script has loaded
console.log("YouTube Chapter Generator content script loaded");

(function() {
  // Configuration constants
  const CONFIG = {
    MAX_EXTRACTION_ATTEMPTS: 3,
    INITIAL_RETRY_DELAY: 1000,
    MAX_RETRY_DELAY: 5000,
    TRANSCRIPT_PANEL_WAIT_TIME: 2500,
    DEFAULT_LANGUAGE: 'en'
  };

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
      
      extractTranscript(request.options || {})
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
            error: error.message || 'Unknown error during transcript extraction',
            errorType: error.name || 'ExtractError'
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
      return searchParams.get('v');
    } catch (error) {
      console.error('Error extracting video ID:', error);
      return null;
    }
  }

  // Helper function to implement exponential backoff with jitter
  function getBackoffDelay(attempt) {
    const baseDelay = Math.min(
      CONFIG.MAX_RETRY_DELAY,
      CONFIG.INITIAL_RETRY_DELAY * Math.pow(2, attempt)
    );
    // Add jitter to avoid multiple scripts hitting at the same time
    return baseDelay + Math.floor(Math.random() * 1000);
  }

  // Function to extract transcript from YouTube page
  async function extractTranscript(options = {}) {
    console.log("Starting transcript extraction with options:", options);
    
    // Create a custom error type for transcript extraction failures
    class TranscriptExtractionError extends Error {
      constructor(message, method) {
        super(message);
        this.name = 'TranscriptExtractionError';
        this.extractionMethod = method;
      }
    }
    
    // Get the video ID from the URL
    const videoId = getVideoIdFromUrl(window.location.href);
    if (!videoId) {
      throw new TranscriptExtractionError('Could not extract video ID from URL', 'url_parsing');
    }
    
    const extractionMethods = [
      { name: 'api', fn: attemptDirectExtraction, priority: 1 },
      { name: 'panel', fn: extractFromTranscriptPanel, priority: 2 },
      { name: 'dom', fn: tryExtractTranscriptFromDOM, priority: 3 }
    ];
    
    // Sort methods by priority
    extractionMethods.sort((a, b) => a.priority - b.priority);
    
    let lastError = null;
    
    // Try each extraction method with retries
    for (const method of extractionMethods) {
      console.log(`Attempting extraction using method: ${method.name}`);
      
      for (let attempt = 0; attempt < CONFIG.MAX_EXTRACTION_ATTEMPTS; attempt++) {
        try {
          // If not the first attempt, wait with backoff
          if (attempt > 0) {
            const delay = getBackoffDelay(attempt);
            console.log(`Retry ${attempt+1}/${CONFIG.MAX_EXTRACTION_ATTEMPTS} for ${method.name} method, waiting ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          // Call the extraction method
          const transcript = await method.fn(videoId, options);
          
          // Validate transcript
          if (transcript && 
              ((Array.isArray(transcript) && transcript.length > 0 && transcript[0].hasOwnProperty('text')) ||
               (typeof transcript === 'string' && transcript.length > 100))) {
            console.log(`Extraction successful using ${method.name} method on attempt ${attempt+1}`);
            return transcript;
          }
          
          throw new TranscriptExtractionError(`Invalid transcript format from ${method.name} method`, method.name);
        } catch (error) {
          console.log(`Extraction failed using ${method.name} method on attempt ${attempt+1}: ${error.message}`);
          lastError = error;
        }
      }
    }
    
    // If we get here, all extraction methods have failed
    const errorMessage = lastError ? lastError.message : 'All transcript extraction methods failed';
    console.error("Transcript extraction completely failed:", errorMessage);
    throw new TranscriptExtractionError(errorMessage, 'all_methods');
  }

  // Attempts to extract transcript directly from YouTube's internal data
  async function attemptDirectExtraction(videoId, options = {}) {
    try {
      // METHOD 0: Using YouTube's transcript API directly (most reliable method)
      console.log("Attempting to extract transcript using YouTube's API endpoint...");
      try {
        const transcript = await getTranscriptFromAPI(videoId);
        if (transcript && transcript.length > 0) {
          console.log(`Successfully extracted ${Array.isArray(transcript) ? transcript.length : 'full'} transcript from API`);
          return transcript;
        }
      } catch (apiError) {
        console.error("Error extracting transcript via API:", apiError);
      }
      
      // Method 1: Extract from player response in script tags
      console.log("Trying to extract transcript from player response data...");
      const scriptTags = document.querySelectorAll('script');
      for (const script of scriptTags) {
        const content = script.textContent;
        if (content && content.includes('playerResponse') && content.includes('captionTracks')) {
          const match = content.match(/playerResponse\s*=\s*(\{.+?\}\}\});/);
          if (match && match[1]) {
            try {
              const data = JSON.parse(match[1]);
              if (data.captions && data.captions.playerCaptionsTracklistRenderer) {
                const captionTracks = data.captions.playerCaptionsTracklistRenderer.captionTracks;
                if (captionTracks && captionTracks.length > 0) {
                  const baseUrl = captionTracks[0].baseUrl;
                  if (baseUrl) {
                    // Try to fetch the transcript data directly
                    try {
                      const transcriptData = await fetchTranscriptFromUrl(baseUrl);
                      if (transcriptData) {
                        return transcriptData;
                      }
                    } catch (fetchError) {
                      console.error("Error fetching transcript from URL:", fetchError);
                    }
                    
                    // We can't directly fetch it due to CORS, but this confirms it exists
                    return `Video has available transcript. Video ID: ${videoId}`;
                  }
                }
              }
            } catch (e) {
              console.error("Error parsing player data:", e);
            }
          }
        }
      }
      
      // Method 2: Try to extract from the yt-formatted-string elements directly
      // This can work for auto-generated captions that are already loaded
      console.log("Trying direct extraction from current DOM...");
      
      // Check if auto-captions are visible in the video player
      const captionsRenderer = document.querySelector('.ytp-caption-segment');
      if (captionsRenderer) {
        console.log("Captions are currently showing in the player, will try to extract");
      }
      
      // Try to find captions window
      const captionsWindow = document.querySelector('.ytp-caption-window-container');
      if (captionsWindow) {
        console.log("Found captions window container");
      }
      
      // Try to get auto-generated captions directly from YouTube transcript panel if already open
      const transcriptPanel = document.querySelector(
        'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ' +
        'ytd-transcript-search-panel-renderer, ' +
        'ytd-transcript-renderer'
      );
      
      if (transcriptPanel) {
        console.log("Found transcript panel, trying to extract directly");
        
        // YouTube's new UI - look for specific transcript components
        const transcriptSegments = transcriptPanel.querySelectorAll('ytd-transcript-segment-renderer');
        if (transcriptSegments.length > 0) {
          console.log(`Found ${transcriptSegments.length} transcript segments`);
          
          const segments = [];
          transcriptSegments.forEach(segment => {
            const timestamp = segment.querySelector('div[class*="time"]')?.textContent?.trim();
            const text = segment.querySelector('yt-formatted-string')?.textContent?.trim();
            
            if (timestamp && text) {
              segments.push({ timestamp, text });
            }
          });
          
          if (segments.length > 0) {
            console.log(`Successfully extracted ${segments.length} segments from transcript panel`);
            return segments;
          }
        }
      }
      
      // Method 3: Extract captions from ytInitialPlayerResponse object in window
      try {
        console.log("Trying to extract from window.ytInitialPlayerResponse...");
        // This is a global variable YouTube sets with player information
        const ytInitialPlayerResponse = window.ytInitialPlayerResponse;
        
        if (ytInitialPlayerResponse && ytInitialPlayerResponse.captions) {
          const captionsRenderer = ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer;
          if (captionsRenderer && captionsRenderer.captionTracks && captionsRenderer.captionTracks.length > 0) {
            const captionTrack = captionsRenderer.captionTracks[0];
            if (captionTrack.baseUrl) {
              console.log("Found caption URL in ytInitialPlayerResponse");
              
              // Try to fetch the transcript directly
              try {
                const transcriptData = await fetchTranscriptFromUrl(captionTrack.baseUrl);
                if (transcriptData) {
                  return transcriptData;
                }
              } catch (fetchError) {
                console.error("Error fetching transcript from URL:", fetchError);
              }
              
              return `Video has available transcript from ytInitialPlayerResponse. Video ID: ${videoId}`;
            }
          }
        }
      } catch (e) {
        console.error("Error accessing ytInitialPlayerResponse:", e);
      }
      
      return null;
    } catch (error) {
      console.error("Error in direct extraction:", error);
      return null;
    }
  }

  // Function to get transcript directly from YouTube's API
  async function getTranscriptFromAPI(videoId) {
    try {
      console.log(`Fetching transcript for video ${videoId} using API approach...`);
      
      // Similar to YouTube Transcript API, first get available transcript tracks
      let captionTracks = [];
      
      // Method 1: Extract from ytInitialPlayerResponse (most reliable)
      if (window.ytInitialPlayerResponse && 
          window.ytInitialPlayerResponse.captions && 
          window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer) {
        
        captionTracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
        console.log(`Found ${captionTracks?.length || 0} caption tracks in ytInitialPlayerResponse`);
      }
      
      // Method 2: Look for captions in the player variable
      if ((!captionTracks || captionTracks.length === 0) && window.ytplayer && window.ytplayer.config) {
        try {
          const playerResponse = window.ytplayer.config.args.player_response;
          if (typeof playerResponse === 'string') {
            const data = JSON.parse(playerResponse);
            if (data.captions && data.captions.playerCaptionsTracklistRenderer) {
              captionTracks = data.captions.playerCaptionsTracklistRenderer.captionTracks;
              console.log(`Found ${captionTracks?.length || 0} caption tracks in ytplayer config`);
            }
          }
        } catch (e) {
          console.error("Error parsing player_response:", e);
        }
      }
      
      // Method 3: Use document.scripts to find captions info
      if (!captionTracks || captionTracks.length === 0) {
        try {
          for (const script of document.scripts) {
            const content = script.textContent;
            if (content && content.includes('"captionTracks"')) {
              const match = content.match(/{"captionTracks":(\[.*?\]),"audioTracks"/);
              if (match && match[1]) {
                captionTracks = JSON.parse(match[1]);
                console.log(`Found ${captionTracks?.length || 0} caption tracks in script tags`);
                break;
              }
            }
          }
        } catch (e) {
          console.error("Error parsing script content:", e);
        }
      }
      
      // If we found caption tracks, try to select the best one
      if (captionTracks && captionTracks.length > 0) {
        console.log("Available caption tracks:");
        captionTracks.forEach((track, index) => {
          console.log(`${index}: ${track.name?.simpleText || 'unnamed'} (${track.languageCode}) ${track.kind || ''}`);
        });
        
        // SIMILAR TO YOUTUBE TRANSCRIPT API: Prioritize selection
        let selectedTrack = null;
        
        // 1. First look for English auto-generated captions
        for (const track of captionTracks) {
          if (track.languageCode === 'en' && track.kind === 'asr') {
            selectedTrack = track;
            console.log("Selected English auto-generated captions");
            break;
          }
        }
        
        // 2. Then look for any English captions
        if (!selectedTrack) {
          for (const track of captionTracks) {
            if (track.languageCode === 'en') {
              selectedTrack = track;
              console.log("Selected English captions");
              break;
            }
          }
        }
        
        // 3. Fall back to first available track
        if (!selectedTrack && captionTracks.length > 0) {
          selectedTrack = captionTracks[0];
          console.log(`Selected default caption track: ${selectedTrack.name?.simpleText || 'unnamed'}`);
        }
        
        if (selectedTrack && selectedTrack.baseUrl) {
          // IMPORTANT: Create a proper URL with format parameters, similar to what YouTube Transcript API does
          let url = selectedTrack.baseUrl;
          
          // Add format parameters for best results
          if (!url.includes('&fmt=')) {
            url += '&fmt=json3'; // This format is often more reliable for processing
          }
          
          console.log("Fetching captions from URL:", url);
          
          try {
            // Use XMLHttpRequest to fetch captions (better for content scripts)
            return await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('GET', url, true);
              xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 400) {
                  console.log("Received caption data, length:", xhr.responseText.length);
                  
                  try {
                    // Try parsing as JSON first (json3 format)
                    try {
                      const jsonData = JSON.parse(xhr.responseText);
                      if (jsonData.events) {
                        console.log("Successfully parsed JSON caption data with", jsonData.events.length, "events");
                        
                        // Convert to our standardized format
                        const segments = [];
                        for (const event of jsonData.events) {
                          if (event.segs && event.tStartMs !== undefined) {
                            const text = event.segs.map(seg => seg.utf8).join('').trim();
                            if (text) {
                              const startTime = event.tStartMs / 1000; // Convert to seconds
                              segments.push({
                                text: text,
                                start: startTime,
                                duration: (event.dDurationMs || 0) / 1000,
                                timestamp: formatTimestamp(startTime)
                              });
                            }
                          }
                        }
                        
                        if (segments.length > 0) {
                          console.log(`Successfully extracted ${segments.length} segments from JSON`);
                          resolve(segments);
                          return;
                        }
                      }
                    } catch (jsonError) {
                      console.log("Couldn't parse as JSON, trying XML");
                    }
                    
                    // Fall back to XML parsing if JSON fails
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xhr.responseText, "text/xml");
                    
                    // Extract text elements
                    const textElements = xmlDoc.getElementsByTagName('text');
                    if (textElements.length === 0) {
                      console.log("No text elements found in transcript XML");
                      
                      // Even if we can't parse it properly, return the raw text if it's substantial
                      if (xhr.responseText && xhr.responseText.length > 100) {
                        console.log("Returning raw caption response as it has substantial content");
                        resolve(xhr.responseText);
                      } else {
                        reject(new Error("No text elements found in transcript XML"));
                      }
                      return;
                    }
                    
                    console.log(`Found ${textElements.length} transcript segments in XML`);
                    
                    // Convert to our segment format
                    const segments = [];
                    for (let i = 0; i < textElements.length; i++) {
                      const element = textElements[i];
                      const start = parseFloat(element.getAttribute('start') || '0');
                      const dur = parseFloat(element.getAttribute('dur') || '0');
                      
                      // Get the text content, handling HTML entities
                      let content = element.textContent || element.innerHTML;
                      
                      // Create a temporary element to handle the HTML content
                      const temp = document.createElement('div');
                      temp.innerHTML = content;
                      content = temp.textContent;
                      
                      if (content) {
                        segments.push({
                          text: content.trim(),
                          start: start,
                          duration: dur,
                          timestamp: formatTimestamp(start)
                        });
                      }
                    }
                    
                    console.log(`Successfully parsed ${segments.length} segments from XML`);
                    resolve(segments);
                    
                  } catch (parseError) {
                    console.error("Error parsing caption data:", parseError);
                    
                    // If parsing fails but we have content, return the raw content
                    if (xhr.responseText && xhr.responseText.length > 100) {
                      console.log("Returning raw caption response despite parsing error");
                      resolve(xhr.responseText);
                    } else {
                      reject(parseError);
                    }
                  }
                } else {
                  console.error(`Caption request failed with status ${xhr.status}`);
                  reject(new Error(`XHR failed with status ${xhr.status}`));
                }
              };
              xhr.onerror = function() {
                console.error("XHR request failed");
                reject(new Error('XHR request failed'));
              };
              xhr.send();
            });
            
          } catch (xhrError) {
            console.error("XHR error:", xhrError);
            throw xhrError;
          }
        } else {
          console.log("No baseUrl found for the selected caption track");
        }
      } else {
        console.log("No caption tracks found");
      }
      
      return null;
    } catch (error) {
      console.error("Error in getTranscriptFromAPI:", error);
      throw error;
    }
  }

  // Function to fetch and parse transcript from a YouTube transcript URL
  async function fetchTranscriptFromUrl(url) {
    try {
      console.log("Fetching transcript from URL:", url);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch transcript: ${response.status}`);
      }
      
      const text = await response.text();
      console.log("Transcript response length:", text.length);
      
      // Parse the XML response
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(text, "text/xml");
      
      // Extract text elements
      const textElements = xmlDoc.getElementsByTagName('text');
      if (textElements.length === 0) {
        throw new Error("No text elements found in transcript XML");
      }
      
      console.log(`Found ${textElements.length} transcript segments in XML`);
      
      // Convert to our segment format - following YouTube Transcript API format
      const segments = [];
      for (let i = 0; i < textElements.length; i++) {
        const element = textElements[i];
        const start = parseFloat(element.getAttribute('start') || '0');
        const dur = parseFloat(element.getAttribute('dur') || '0');
        
        // Get the text content, handling HTML entities
        let content = element.textContent;
        
        // If the element has XML content, get the innerHTML instead
        if (element.innerHTML && element.innerHTML.trim() !== content.trim()) {
          // Create a temporary element to handle the HTML content
          const temp = document.createElement('div');
          temp.innerHTML = element.innerHTML;
          content = temp.textContent;
        }
        
        if (content) {
          segments.push({
            text: content.trim(),
            start: start,  // Original start time in seconds
            duration: dur,
            timestamp: formatTimestamp(start)  // Formatted timestamp for display
          });
        }
      }
      
      console.log(`Successfully parsed ${segments.length} segments from XML with precise timestamps`);
      return segments;
      
    } catch (error) {
      console.error("Error in fetchTranscriptFromUrl:", error);
      throw error;
    }
  }

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

  // Attempts to open the transcript panel
  async function tryOpenTranscriptPanel() {
    try {
      // Try multiple approaches to open the transcript
      
      // 2024 YouTube UI: First try the modern "..." menu
      console.log("Trying to access transcript through modern YouTube menu...");
      const modernMenuButtons = document.querySelectorAll('button[aria-label="More actions"], ytd-menu-renderer button, yt-icon-button[id="button"]');
      
      for (const button of modernMenuButtons) {
        if (button && button.offsetParent !== null) { // Check if button is visible
          console.log("Found and clicking modern menu button");
          button.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // After clicking the menu, look for the transcript option
          const menuItems = document.querySelectorAll('tp-yt-paper-item, ytd-menu-service-item-renderer, [role="menuitem"]');
          for (const item of menuItems) {
            const text = item.textContent.toLowerCase().trim();
            if (text.includes('transcript') || text.includes('caption') || text.includes('subtitles')) {
              console.log("Found transcript option in menu:", text);
              item.click();
              await new Promise(resolve => setTimeout(resolve, 1500));
              
              // Check if transcript panel appeared
              const panel = document.querySelector('#panels [target-id="engagement-panel-searchable-transcript"]');
              if (panel) {
                console.log("Successfully opened transcript panel via menu");
                return;
              }
            }
          }
          
          // Close the menu if we didn't find the transcript option
          document.body.click();
          break;
        }
      }
      
      // Approach 1: Try the "..." button in video description area
      console.log("Trying to find and click More actions button in description...");
      const moreActionsButtons = [
        ...document.querySelectorAll('button[aria-label="More actions"]'),
        ...document.querySelectorAll('button[aria-label="Show more"], button[aria-label="More"]'),
        ...document.querySelectorAll('button.ytp-subtitles-button'),
        ...document.querySelectorAll('button[data-tooltip-target-id="ytp-subtitles-button"]')
      ];
      
      for (const button of moreActionsButtons) {
        if (button && button.offsetParent !== null) { // Check if button is visible
          console.log("Found and clicking More actions button");
          button.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
          break;
        }
      }
      
      // Approach 2: Try to find and click the transcript button in various menus
      console.log("Looking for transcript button...");
      const transcriptButton = findTranscriptButton();
      if (transcriptButton) {
        console.log("Found transcript button, clicking it...");
        transcriptButton.click();
        // Wait for transcript panel to load
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
        console.log("Could not find transcript button");
        
        // Approach 3: Try the CC button in video player
        const ccButtons = [
          document.querySelector('.ytp-subtitles-button'),
          document.querySelector('button[data-title-no-tooltip="Subtitles/closed captions"]'),
          document.querySelector('button[aria-label*="subtitles"]'),
          document.querySelector('button[aria-label*="caption"]')
        ];
        
        for (const button of ccButtons) {
          if (button && button.offsetParent !== null) {
            console.log("Found CC button, clicking it...");
            button.click();
            await new Promise(resolve => setTimeout(resolve, 800));
            
            // Now try to find a "Show transcript" option that might appear
            const showTranscriptOption = document.querySelector('[aria-label*="transcript"], [aria-label*="Transcript"]');
            if (showTranscriptOption) {
              console.log("Found Show transcript option after clicking CC");
              showTranscriptOption.click();
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            break;
          }
        }
      }
      
      // Approach 4: Look for the "Open transcript" button directly
      console.log("Looking for direct Open transcript button...");
      const openTranscriptButtons = document.querySelectorAll('button, tp-yt-paper-button, yt-button-renderer');
      for (const button of openTranscriptButtons) {
        const text = button.textContent.toLowerCase().trim();
        if (text.includes('transcript') || text.includes('open transcript')) {
          console.log("Found direct Open transcript button:", text);
          button.click();
          await new Promise(resolve => setTimeout(resolve, 1500));
          break;
        }
      }
      
      // Check if we successfully opened the transcript panel
      const panel = document.querySelector('#panels [target-id="engagement-panel-searchable-transcript"]');
      if (panel) {
        console.log("Transcript panel is open");
      } else {
        console.log("Could not confirm if transcript panel opened");
      }
      
    } catch (error) {
      console.error("Error opening transcript panel:", error);
      // Continue execution even if we can't open the panel
    }
  }

  // Tries to extract transcript from different possible DOM structures
  async function tryExtractTranscriptFromDOM() {
    console.log("Trying to extract transcript from DOM...");
    
    // Start with checking if the transcript panel is in the sidebar
    const transcriptPanel = document.querySelector('[target-id="engagement-panel-searchable-transcript"]');
    if (transcriptPanel) {
      console.log("Found transcript panel in sidebar");
      
      // Try to get the inner content
      const transcriptContent = getTranscriptContentFromPanel(transcriptPanel);
      if (transcriptContent) {
        return transcriptContent;
      }
    }
    
    // If not found in sidebar, try multiple selectors for transcript containers
    const containerSelectors = [
      '#transcript-scrollbox',
      'ytd-transcript-search-panel-renderer',
      'ytd-transcript-renderer',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
      '.ytd-engagement-panel-section-list-renderer',
      '#panels', // Broader container that might contain the transcript
      'ytd-engagement-panel-container',
      '[target-id="engagement-panel-searchable-transcript"]', // More generic selector
      'ytd-engagement-panel-section-list-renderer' // Even more generic
    ];
    
    let transcriptContainer = null;
    for (const selector of containerSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`Found transcript container with selector: ${selector}`);
        transcriptContainer = container;
        
        // Try to get transcript content from this container
        const transcriptContent = getTranscriptContentFromPanel(container);
        if (transcriptContent) {
          return transcriptContent;
        }
        
        break;
      }
    }
    
    if (!transcriptContainer) {
      console.log("Could not find transcript container");
      return null;
    }
    
    // FIRST ATTEMPT: Try to get the transcript using modern YouTube selectors (2023-2024)
    console.log("Trying modern YouTube transcript selectors...");
    
    // These are likely to work with auto-generated captions
    const modernSelectors = {
      segmentContainers: [
        '#segments-container', 
        'ytd-transcript-segment-list-renderer',
        'ytd-transcript-body-renderer'
      ],
      segmentItems: [
        'ytd-transcript-segment-renderer', 
        'yt-formatted-string.segment-text',
        'div.segment'
      ]
    };
    
    // Try each container selector
    for (const containerSelector of modernSelectors.segmentContainers) {
      console.log(`Checking for segment container: ${containerSelector}`);
      const segmentContainer = transcriptContainer.querySelector(containerSelector) || 
                              document.querySelector(containerSelector);
      
      if (segmentContainer) {
        console.log(`Found segment container: ${containerSelector}`);
        
        // Now try to find all segments inside this container
        for (const itemSelector of modernSelectors.segmentItems) {
          console.log(`Looking for segments with: ${itemSelector}`);
          const segments = segmentContainer.querySelectorAll(itemSelector);
          
          if (segments && segments.length > 0) {
            console.log(`Found ${segments.length} segments with selector: ${itemSelector}`);
            
            // Try to parse these segments
            const transcript = parseSegments(segments);
            if (transcript && transcript.length > 0) {
              console.log(`Successfully parsed ${transcript.length} segments`);
              return transcript;
            }
          }
        }
      }
    }
    
    // SECOND ATTEMPT: Try the YouTube 2024 specific selectors (they keep changing!)
    // This should work with the latest YouTube UI
    console.log("Trying latest YouTube UI selectors...");
    
    // Find any elements that might contain transcript segments
    const listRenderer = transcriptContainer.querySelector('ytd-transcript-segment-list-renderer') || 
                        document.querySelector('ytd-transcript-segment-list-renderer');
    
    if (listRenderer) {
      console.log("Found transcript segment list renderer");
      
      // Try to get all children that might be transcript segments
      const segmentRenderers = listRenderer.querySelectorAll('ytd-transcript-segment-renderer');
      if (segmentRenderers.length > 0) {
        console.log(`Found ${segmentRenderers.length} segment renderers`);
        
        const transcript = [];
        
        segmentRenderers.forEach(renderer => {
          // For YouTube 2024, the structure is typically:
          // - A div with class containing "timestamp"
          // - A yt-formatted-string with the text content
          const timestampEl = renderer.querySelector('div[class*="time"]') || 
                             renderer.querySelector('[class*="timestamp"]');
          
          const textEl = renderer.querySelector('yt-formatted-string') || 
                        renderer.querySelector('span[class*="text"]') || 
                        renderer.querySelector('div[class*="text"]');
          
          if (timestampEl && textEl) {
            const timestamp = timestampEl.textContent.trim();
            const text = textEl.textContent.trim();
            
            if (timestamp && text) {
              transcript.push({ timestamp, text });
            }
          }
        });
        
        if (transcript.length > 0) {
          console.log(`Successfully extracted ${transcript.length} segments from latest UI`);
          return transcript;
        }
      }
    }
    
    // THIRD ATTEMPT: Try pattern matching on all text nodes
    console.log("Trying direct pattern matching on text nodes...");
    
    const textNodes = [];
    const timePattern = /^(\d+:)?(\d+):(\d+)$/;
    
    // Helper function to collect all text nodes in a container
    function collectTextNodes(node) {
      if (node.nodeType === 3) { // Text node
        const text = node.textContent.trim();
        if (text.length > 0) {
          textNodes.push({ node, text });
        }
      } else if (node.nodeType === 1) { // Element node
        for (let i = 0; i < node.childNodes.length; i++) {
          collectTextNodes(node.childNodes[i]);
        }
      }
    }
    
    collectTextNodes(transcriptContainer);
    console.log(`Found ${textNodes.length} text nodes`);
    
    // Find timestamp nodes
    const timestampNodes = textNodes.filter(item => timePattern.test(item.text));
    console.log(`Found ${timestampNodes.length} timestamp-like nodes`);
    
    if (timestampNodes.length > 0) {
      const transcript = [];
      
      for (let i = 0; i < timestampNodes.length; i++) {
        const timestamp = timestampNodes[i].text;
        
        // Find the nearest text node after this timestamp
        let textNodeIndex = textNodes.findIndex(item => item.node === timestampNodes[i].node) + 1;
        
        // Skip other timestamp nodes
        while (textNodeIndex < textNodes.length && timePattern.test(textNodes[textNodeIndex].text)) {
          textNodeIndex++;
        }
        
        if (textNodeIndex < textNodes.length) {
          const text = textNodes[textNodeIndex].text;
          if (text && text.length > 1 && !timePattern.test(text)) {
            transcript.push({ timestamp, text });
          }
        }
      }
      
      if (transcript.length > 0) {
        console.log(`Successfully extracted ${transcript.length} segments from text nodes`);
        return transcript;
      }
    }
    
    // LAST RESORT: If all structured extraction fails, get plain text
    console.log("All structured extraction methods failed, trying plain text extraction...");
    
    // Custom extraction for YouTube's specific layout as a last resort
    return attemptCustomDOMExtraction(transcriptContainer);
  }

  // Helper function to process a transcript panel and get content with precise timestamps
  function getTranscriptContentFromPanel(panel) {
    // Check if panel has the right structure for 2024 YouTube
    const segmentRenderers = panel.querySelectorAll('ytd-transcript-segment-renderer');
    if (segmentRenderers.length > 0) {
      console.log(`Panel contains ${segmentRenderers.length} transcript segments`);
      
      const segments = [];
      segmentRenderers.forEach(renderer => {
        try {
          // Try different possible element combinations for timestamp and text
          const timestampEl = renderer.querySelector('[class*="timestamp"]') || 
                            renderer.querySelector('[class*="time"]') ||
                            Array.from(renderer.querySelectorAll('span, div')).find(el => {
                              const text = el.textContent.trim();
                              return /^\d+:\d+$/.test(text) || /^\d+:\d+:\d+$/.test(text);
                            });
          
          const textEl = renderer.querySelector('yt-formatted-string') || 
                        renderer.querySelector('[class*="content"]') ||
                        renderer.querySelector('[class*="text"]');
          
          if (timestampEl && textEl) {
            const timestampStr = timestampEl.textContent.trim();
            const text = textEl.textContent.trim();
            
            if (timestampStr && text) {
              // Convert timestamp to seconds for accurate sorting and alignment
              const startSeconds = getTimestampSecondsFromString(timestampStr);
              
              segments.push({
                text: text,
                start: startSeconds,  // Store original seconds for comparison and sorting
                timestamp: timestampStr // Keep display format
              });
            }
          }
        } catch (error) {
          console.error("Error processing segment:", error);
        }
      });
      
      if (segments.length > 0) {
        // Sort by timestamp to ensure correct order
        segments.sort((a, b) => a.start - b.start);
        console.log(`Successfully extracted ${segments.length} segments from panel with precise timestamps`);
        return segments;
      }
    }
    
    return null;
  }

  // Custom extraction when other methods fail
  function attemptCustomDOMExtraction(container) {
    // The timestamp pattern we're looking for (MM:SS or HH:MM:SS)
    const timeRegex = /^\s*(\d+:)?(\d+):(\d+)\s*$/;
    
    // Look for specific elements that might contain formatted transcript text
    const allElements = container.querySelectorAll('*');
    let timestampElements = [];
    let textElements = [];
    
    // First pass: identify potential timestamp elements
    for (const el of allElements) {
      const text = el.textContent.trim();
      if (text.length > 0) {
        if (timeRegex.test(text)) {
          timestampElements.push(el);
        } else if (text.length > 5 && !text.includes('transcript')) {
          textElements.push(el);
        }
      }
    }
    
    console.log(`Found ${timestampElements.length} potential timestamp elements and ${textElements.length} text elements`);
    
    // If we have a good number of timestamps, try to pair them with text
    if (timestampElements.length > 3) {
      // Assume timestamps and texts alternate or are in pairs
      const segments = [];
      
      if (timestampElements.length === textElements.length) {
        // Perfect match - pair them directly
        for (let i = 0; i < timestampElements.length; i++) {
          const timestampStr = timestampElements[i].textContent.trim();
          const text = textElements[i].textContent.trim();
          const startSeconds = getTimestampSecondsFromString(timestampStr);
          
          segments.push({
            text: text,
            start: startSeconds, // Store seconds for comparison
            timestamp: timestampStr
          });
        }
        
        console.log(`Successfully paired ${segments.length} segments with precise timestamps`);
        return segments;
      }
      
      // If not a perfect match, try to intelligently pair them
      let textIndex = 0;
      for (let i = 0; i < timestampElements.length && textIndex < textElements.length; i++) {
        // Try to find a text element that's somehow related to this timestamp
        const timestampStr = timestampElements[i].textContent.trim();
        const startSeconds = getTimestampSecondsFromString(timestampStr);
        
        // Check if there's a text element right after the timestamp in the DOM
        let found = false;
        let node = timestampElements[i].nextSibling;
        
        while (node && !found) {
          if (node.nodeType === 1) { // Element
            const text = node.textContent.trim();
            if (text.length > 5 && !timeRegex.test(text)) {
              segments.push({
                text: text,
                start: startSeconds,
                timestamp: timestampStr
              });
              found = true;
              break;
            }
          }
          node = node.nextSibling;
        }
        
        if (!found) {
          // If we couldn't find a related element, use the next text element
          segments.push({
            text: textElements[textIndex].textContent.trim(),
            start: startSeconds,
            timestamp: timestampStr
          });
          textIndex++;
        }
      }
      
      if (segments.length > 0) {
        // Sort by timestamp to ensure correct order
        segments.sort((a, b) => a.start - b.start);
        console.log(`Constructed ${segments.length} segments using element pairing with precise timestamps`);
        return segments;
      }
    }
    
    // If we get here, we've failed to extract structured segments
    // Try to create a useful description that at least captures the video content
    let plainText = '';
    
    // If we can't pair them, use any substantial text we found
    for (const el of allElements) {
      const text = el.textContent.trim();
      if (text.length > 5 && !timeRegex.test(text) && !text.includes('transcript')) {
        plainText += text + '\n';
      }
    }
    
    if (plainText.length > 100) { // Only use if we got something substantial
      console.log(`Extracted detailed plain text, length: ${plainText.length}`);
      return plainText;
    }
    
    // Final fallback: just get all text from the container
    plainText = container.textContent.trim();
    if (plainText.length > 20) {
      console.log(`Extracted plain text from container, length: ${plainText.length}`);
      return plainText;
    }
    
    console.log("Could not extract any useful transcript text");
    return null;
  }

  // Helper function to parse transcript segments
  function parseSegments(segments) {
    const transcript = [];
    
    segments.forEach(segment => {
      try {
        // Try different possible selector combinations
        const timestampElement = 
          segment.querySelector('.segment-timestamp') || 
          segment.querySelector('div[class*="timestamp"]') ||
          segment.querySelector('span[class*="timestamp"]') ||
          segment.querySelector('.ytd-transcript-segment-renderer') ||
          findTimestampElement(segment);
            
        const textElement = 
          segment.querySelector('.segment-text') || 
          segment.querySelector('div[class*="content"]') ||
          segment.querySelector('span[class*="content"]') ||
          segment.querySelector('yt-formatted-string') ||
          findTextElement(segment) ||
          segment;
        
        if (timestampElement && textElement) {
          const timestamp = timestampElement.textContent.trim();
          const text = textElement.textContent.trim().replace(timestamp, '').trim();
          
          if (timestamp && text) {
            transcript.push({
              timestamp: timestamp,
              text: text
            });
          }
        } else if (textElement) {
          // If we can't find a timestamp but have text, this might be a combined element
          const content = textElement.textContent.trim();
          const timeMatch = content.match(/^(\d+:)?(\d+):(\d+)(.+)/);
          
          if (timeMatch) {
            transcript.push({
              timestamp: timeMatch[1] ? timeMatch[1] + timeMatch[2] + ':' + timeMatch[3] : timeMatch[2] + ':' + timeMatch[3],
              text: timeMatch[4].trim()
            });
          }
        }
      } catch (err) {
        console.error("Error processing segment:", err);
      }
    });
    
    return transcript;
  }

  // Helper function to find timestamp element based on content pattern
  function findTimestampElement(parentElement) {
    const allChildren = parentElement.querySelectorAll('*');
    for (const child of allChildren) {
      if (child.childNodes.length === 1 && child.childNodes[0].nodeType === 3) { // Text node
        const text = child.textContent.trim();
        // Check if it matches a timestamp pattern (MM:SS or HH:MM:SS)
        if (/^(\d+:)?(\d+):(\d+)$/.test(text)) {
          return child;
        }
      }
    }
    return null;
  }

  // Helper function to find text element that's likely to contain caption text
  function findTextElement(parentElement) {
    const allChildren = parentElement.querySelectorAll('*');
    for (const child of allChildren) {
      if (child.childNodes.length === 1 && child.childNodes[0].nodeType === 3) { // Text node
        const text = child.textContent.trim();
        // Skip timestamps and look for longer text
        if (text.length > 5 && !/^(\d+:)?(\d+):(\d+)$/.test(text)) {
          return child;
        }
      }
    }
    return null;
  }

  // Function to find and return the transcript button
  function findTranscriptButton() {
    console.log("Looking for transcript button...");
    
    // Look for buttons or menu items with transcript-related text
    const possibleElements = [
      ...document.querySelectorAll('tp-yt-paper-item'),
      ...document.querySelectorAll('ytd-menu-service-item-renderer'),
      ...document.querySelectorAll('button'),
      ...document.querySelectorAll('[role="menuitem"]')
    ];
    
    const transcriptKeywords = ['transcript', 'subtitles', 'cc', 'captions', 'текст видео', 'транскрипт'];
    
    for (const item of possibleElements) {
      const text = item.textContent.trim().toLowerCase();
      if (transcriptKeywords.some(keyword => text.includes(keyword))) {
        console.log("Found transcript button with text:", text);
        return item;
      }
    }
    
    // Look for items with specific aria labels
    const ariaLabelElements = document.querySelectorAll('[aria-label]');
    for (const item of ariaLabelElements) {
      const label = item.getAttribute('aria-label').toLowerCase();
      if (transcriptKeywords.some(keyword => label.includes(keyword))) {
        console.log("Found transcript button with aria-label:", label);
        return item;
      }
    }
    
    console.log("Could not find transcript button");
    return null;
  }

  // Fallback to get a basic transcript when DOM extraction fails
  function getFallbackTranscript(videoId) {
    throw new Error('Could not extract transcript. Please ensure the video has captions enabled.');
  }

  // Function to extract timestamps from YouTube transcript panel
  function getTimestampSecondsFromString(timestampStr) {
    try {
      // Handle timestamps like "1:23" (mm:ss) or "1:23:45" (hh:mm:ss)
      const parts = timestampStr.trim().split(':');
      let hours = 0, minutes = 0, seconds = 0;
      
      if (parts.length === 3) {
        // Format: hh:mm:ss
        hours = parseInt(parts[0]);
        minutes = parseInt(parts[1]);
        seconds = parseInt(parts[2]);
      } else if (parts.length === 2) {
        // Format: mm:ss
        minutes = parseInt(parts[0]);
        seconds = parseInt(parts[1]);
      } else if (parts.length === 1 && !isNaN(parts[0])) {
        // Format: ss
        seconds = parseInt(parts[0]);
      } else {
        console.error("Invalid timestamp format:", timestampStr);
        return 0;
      }
      
      // Convert to seconds
      return hours * 3600 + minutes * 60 + seconds;
    } catch (e) {
      console.error("Error parsing timestamp:", timestampStr, e);
      return 0;
    }
  }

  // New function to extract transcript from panel with improved reliability
  async function extractFromTranscriptPanel(videoId, options = {}) {
    console.log("Attempting to extract transcript by opening the transcript panel...");
    
    try {
      // Try to open the transcript panel
      const panelOpened = await forceOpenTranscriptPanel();
      if (!panelOpened) {
        throw new Error("Failed to open transcript panel");
      }
      
      console.log("Successfully opened transcript panel, waiting for it to load...");
      await new Promise(resolve => setTimeout(resolve, CONFIG.TRANSCRIPT_PANEL_WAIT_TIME));
      
      // Try DOM extraction after panel is opened
      const transcript = await tryExtractTranscriptFromDOM(videoId, options);
      if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
        throw new Error("Failed to extract transcript from opened panel");
      }
      
      console.log(`Successfully extracted ${transcript.length} segments from transcript panel`);
      return transcript;
    } catch (error) {
      console.error("Error extracting transcript from panel:", error);
      throw error;
    }
  }

  // Add this function to directly find and click the CC button and open the transcript panel
  async function forceOpenTranscriptPanel() {
    console.log("Attempting to force open transcript panel...");
    
    // First, try to find the CC button in the video player
    const ccButton = document.querySelector('.ytp-subtitles-button');
    
    // If we found the CC button, click it to ensure captions are enabled
    if (ccButton) {
      console.log("Found CC button, clicking to enable captions");
      ccButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.log("Could not find CC button");
    }
    
    // Now look for the three dots menu button
    const menuButtons = document.querySelectorAll('button.ytp-button:not([aria-disabled="true"])');
    let menuButton = null;
    
    for (const button of menuButtons) {
      if (button.getAttribute('aria-label') && 
          (button.getAttribute('aria-label').includes('More') || 
           button.getAttribute('aria-label').includes('menu'))) {
        menuButton = button;
        break;
      }
    }
    
    if (!menuButton) {
      const allButtons = document.querySelectorAll('button.ytp-button');
      // Try the 5th button which is often the "More" button
      if (allButtons.length >= 5) {
        menuButton = allButtons[4]; // 0-indexed, so the 5th button is at index 4
      }
    }
    
    if (menuButton) {
      console.log("Found video player menu button, clicking it");
      menuButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Now look for the "Open transcript" option in the menu
      const menuItems = document.querySelectorAll('.ytp-menuitem');
      let transcriptMenuItem = null;
      
      for (const item of menuItems) {
        const label = item.textContent.toLowerCase();
        if (label.includes('transcript') || label.includes('caption') || label.includes('subtitle')) {
          transcriptMenuItem = item;
          break;
        }
      }
      
      if (transcriptMenuItem) {
        console.log("Found transcript menu item, clicking it");
        transcriptMenuItem.click();
        // Wait for transcript panel to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        return true;
      } else {
        console.log("Could not find transcript option in menu");
      }
    } else {
      console.log("Could not find menu button");
    }
    
    // Try clicking the "..." button in the description area (new YouTube UI)
    const moreActionsButton = document.querySelector('button[aria-label="More actions"]');
    if (moreActionsButton) {
      console.log("Found 'More actions' button in description, clicking it");
      moreActionsButton.click();
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Look for transcript option
      const menuItems = document.querySelectorAll('ytd-menu-service-item-renderer');
      for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        if (text.includes('transcript') || text.includes('caption')) {
          console.log("Found transcript option, clicking it");
          item.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          return true;
        }
      }
    }
    
    return false;
  }
})(); 