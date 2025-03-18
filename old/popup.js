document.addEventListener('DOMContentLoaded', function() {
  const generateBtn = document.getElementById('generate-btn');
  const copyBtn = document.getElementById('copy-btn');
  const statusElement = document.getElementById('status');
  const statusContainer = document.getElementById('status-container');
  const loadingElement = document.getElementById('loading');
  const resultsElement = document.getElementById('results');
  const chaptersContainer = document.getElementById('chapters-container');
  const copyMessage = document.getElementById('copy-message');
  const errorMessage = document.getElementById('error-message');
  const debugInfo = document.getElementById('debug-info');
  const debugContent = document.getElementById('debug-content');
  
  // Add settings UI elements
  const settingsDiv = document.createElement('div');
  settingsDiv.className = 'settings-container hidden';
  settingsDiv.innerHTML = `
    <h3>Settings</h3>
    <div class="settings-row">
      <label for="openai-api-key">OpenAI API Key:</label>
      <input type="password" id="openai-api-key" placeholder="sk-...">
    </div>
    <div class="settings-info">
      Your API key is stored locally and only used when the server API fails.
    </div>
    <div class="settings-controls">
      <button id="save-settings-btn" class="secondary-btn">Save</button>
      <button id="cancel-settings-btn" class="secondary-btn">Cancel</button>
    </div>
  `;
  
  // Add settings icon
  const settingsIcon = document.createElement('button');
  settingsIcon.className = 'settings-icon';
  settingsIcon.innerHTML = '⚙️';
  settingsIcon.title = 'Settings';
  
  // Add settings to the container right after the header
  const container = document.querySelector('.container');
  const header = document.querySelector('h1');
  container.insertBefore(settingsIcon, header.nextSibling);
  container.insertBefore(settingsDiv, statusContainer);
  
  // Settings elements
  const apiKeyInput = settingsDiv.querySelector('#openai-api-key');
  const saveSettingsBtn = settingsDiv.querySelector('#save-settings-btn');
  const cancelSettingsBtn = settingsDiv.querySelector('#cancel-settings-btn');
  
  // Settings event listeners
  settingsIcon.addEventListener('click', function() {
    // Load saved API key from storage
    chrome.storage.sync.get(['openai_api_key'], function(result) {
      if (result.openai_api_key) {
        apiKeyInput.value = result.openai_api_key;
      }
    });
    
    settingsDiv.classList.remove('hidden');
    statusContainer.classList.add('hidden');
  });
  
  saveSettingsBtn.addEventListener('click', function() {
    const apiKey = apiKeyInput.value.trim();
    
    // Save API key to Chrome's sync storage
    chrome.storage.sync.set({ openai_api_key: apiKey }, function() {
      console.log('API key saved');
    });
    
    settingsDiv.classList.add('hidden');
    statusContainer.classList.remove('hidden');
  });
  
  cancelSettingsBtn.addEventListener('click', function() {
    settingsDiv.classList.add('hidden');
    statusContainer.classList.remove('hidden');
  });
  
  // Add debug toggle button
  const debugToggleBtn = document.createElement('button');
  debugToggleBtn.textContent = 'Show Debug Info';
  debugToggleBtn.className = 'secondary-btn';
  debugToggleBtn.style.marginTop = '10px';
  debugToggleBtn.style.display = 'none'; // Hidden by default
  
  // Insert after the copy button
  copyBtn.parentNode.insertBefore(debugToggleBtn, copyBtn.nextSibling);
  
  // Current transcript data
  let currentTranscriptData = null;
  
  // Debug toggle event
  debugToggleBtn.addEventListener('click', function() {
    if (debugInfo.classList.contains('hidden')) {
      debugInfo.classList.remove('hidden');
      debugToggleBtn.textContent = 'Hide Debug Info';
    } else {
      debugInfo.classList.add('hidden');
      debugToggleBtn.textContent = 'Show Debug Info';
    }
  });

  // Function to show debug information with timestamp verification
  function showDebugInfo(transcript, error = null) {
    let debugText = '';
    currentTranscriptData = transcript;
    
    if (typeof transcript === 'string') {
      debugText = "Plain text transcript (no timestamps):\n\n" + transcript.substring(0, 500) + "...";
    } else if (Array.isArray(transcript)) {
      debugText = `Transcript with ${transcript.length} segments:\n\n`;
      
      // Show the first 10 segments with their timestamps
      const samplesToShow = Math.min(10, transcript.length);
      for (let i = 0; i < samplesToShow; i++) {
        const segment = transcript[i];
        if (segment.timestamp && segment.text) {
          debugText += `[${segment.timestamp}] ${segment.text}\n`;
        } else if (segment.start !== undefined && segment.text) {
          debugText += `[${formatTimestamp(segment.start)}] ${segment.text}\n`;
        } else {
          debugText += `[Format unknown] ${JSON.stringify(segment)}\n`;
        }
      }
      
      // Add info about what we're doing with the data
      debugText += `\n...and ${transcript.length - samplesToShow} more segments\n\n`;
      
      // Add error message if one was provided
      if (error) {
        debugText += `NOTE: API is failing with error: ${error}\n`;
        debugText += `This is a server-side issue. Using local chapter generation instead.\n`;
      }
    } else {
      debugText = "Unknown transcript format: " + JSON.stringify(transcript).substring(0, 500);
    }
    
    debugContent.textContent = debugText;
    debugToggleBtn.style.display = 'block';
  }

  // API endpoint
  const API_ENDPOINT = 'https://youtube-chapter-generator-qwtz6ye0h-bohdans-projects-7ca0eede.vercel.app/api/generate-chapters';

  // Check if we're on a YouTube page
  function checkYouTubePage(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const activeTab = tabs[0];
      const isYouTube = activeTab.url.includes('youtube.com/watch');
      
      if (isYouTube) {
        callback(activeTab);
      } else {
        statusElement.textContent = 'Please navigate to a YouTube video page to use this extension.';
        generateBtn.disabled = true;
      }
    });
  }

  // Extract video ID from YouTube URL
  function getVideoId(url) {
    const urlParams = new URLSearchParams(new URL(url).search);
    return urlParams.get('v');
  }

  // Format seconds to HH:MM:SS
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

  // Function to get video transcript from the content script
  async function getVideoTranscript(tabId) {
    return new Promise((resolve, reject) => {
      // First, ensure that the content script is injected
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      }, async (injectionResults) => {
        // Check for injection errors
        if (chrome.runtime.lastError) {
          console.error('Error injecting content script:', chrome.runtime.lastError.message);
          reject(new Error(`Could not inject content script: ${chrome.runtime.lastError.message}`));
          return;
        }
        
        console.log('Content script injection results:', injectionResults);
        
        // Wait a moment for the script to initialize
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Now send message to the content script
        console.log(`Requesting transcript from tab ${tabId}`);
        chrome.tabs.sendMessage(
          tabId, 
          { action: 'getTranscript' },
          (response) => {
            if (chrome.runtime.lastError) {
              const errorMessage = chrome.runtime.lastError.message || 'Unknown error';
              console.error('Error sending message:', errorMessage);
              reject(new Error(`Failed to communicate with YouTube page: ${errorMessage}`));
              return;
            }
            
            console.log('Received transcript response:', response);
            
            if (!response) {
              reject(new Error('No response from content script. The page may need to be refreshed.'));
              return;
            }
            
            if (!response.success) {
              reject(new Error(response.error || 'Failed to extract transcript'));
              return;
            }
            
            resolve(response);
          }
        );
      });
    });
  }

  // Helper function to format transcript data for the API
  function formatTranscriptForAPI(transcript, videoId) {
    console.log("Formatting transcript for API:", typeof transcript, Array.isArray(transcript) ? transcript.length : 'not an array');
    
    // Common parameters for all formats
    const baseParams = {
      videoId: videoId,
      useTimestamps: true, // Explicitly indicate timestamps should be used if available
      clientVersion: '1.0', // Add client version for API compatibility tracking
    };
    
    // If transcript is already a string, return it directly with metadata
    if (typeof transcript === 'string') {
      return {
        ...baseParams,
        transcript: transcript,
        format: "plain_text"
      };
    }
    
    // If transcript is an array of objects with text and timestamps
    if (Array.isArray(transcript)) {
      // Sort transcript by start time if available to ensure proper sequence
      const formattedSegments = [];
      
      transcript.forEach(segment => {
        // Handle different transcript formats to ensure we include timestamps
        if (typeof segment === 'object') {
          let formattedSegment = { text: "" };
          
          // Extract the text
          if ('text' in segment) {
            formattedSegment.text = segment.text;
          }
          
          // Extract and include timestamps in multiple formats to ensure API can use them
          if ('start' in segment) {
            // Include the raw seconds for precise calculations
            formattedSegment.start_seconds = segment.start;
            // Include formatted timestamp
            formattedSegment.timestamp = segment.timestamp || formatTimestamp(segment.start);
          } else if ('timestamp' in segment) {
            // Convert timestamp string to seconds for better use by the API
            formattedSegment.timestamp = segment.timestamp;
            formattedSegment.start_seconds = getTimestampSecondsFromString(segment.timestamp);
          }
          
          if (formattedSegment.text) {
            formattedSegments.push(formattedSegment);
          }
        }
      });
      
      // Sort by start time to ensure chronological order
      if (formattedSegments.length > 0 && 'start_seconds' in formattedSegments[0]) {
        formattedSegments.sort((a, b) => (a.start_seconds || 0) - (b.start_seconds || 0));
      }
      
      // If we got no valid segments, try a more lenient approach
      if (formattedSegments.length === 0 && transcript.length > 0) {
        console.log("No valid segments found with strict parsing, trying lenient approach");
        
        // Try a more permissive approach
        for (const item of transcript) {
          if (typeof item === 'object') {
            const segment = { text: "" };
            
            // Get text from any available field
            for (const key of ['text', 'content', 'caption', 'value']) {
              if (typeof item[key] === 'string' && item[key].trim()) {
                segment.text = item[key].trim();
                break;
              }
            }
            
            // Get timestamp from any available field
            for (const key of ['timestamp', 'time', 'startTime', 'start_time']) {
              if (typeof item[key] === 'string' && item[key].trim()) {
                segment.timestamp = item[key].trim();
                break;
              } else if (typeof item[key] === 'number') {
                segment.start_seconds = item[key];
                segment.timestamp = formatTimestamp(item[key]);
                break;
              }
            }
            
            if (segment.text) {
              formattedSegments.push(segment);
            }
          }
        }
      }
      
      if (formattedSegments.length > 0) {
        return {
          ...baseParams,
          transcript: formattedSegments,
          segmentCount: formattedSegments.length,
          format: "timestamped_segments"
        };
      }
    }
    
    // Fallback for unexpected transcript format - try to convert to string if possible
    try {
      const stringifiedTranscript = typeof transcript === 'object' ? 
        JSON.stringify(transcript) : String(transcript);
        
      return {
        ...baseParams,
        transcript: stringifiedTranscript,
        format: "unknown_converted_to_string"
      };
    } catch (e) {
      console.error("Error stringifying transcript:", e);
      return {
        ...baseParams,
        transcript: "Error formatting transcript: " + e.message,
        format: "error",
        originalFormat: typeof transcript
      };
    }
  }

  // Helper function to convert timestamp string to seconds
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

  // Display the generated chapters
  function displayChapters(data) {
    chaptersContainer.innerHTML = '';
    resultsElement.classList.remove('hidden');
    statusContainer.classList.add('hidden');
    loadingElement.classList.add('hidden');
    
    // Normalize the data structure - handle both 'chapters' and 'titles' formats
    let normalizedChapters = [];
    
    if (data.chapters && Array.isArray(data.chapters)) {
      normalizedChapters = data.chapters;
    } else if (data.titles && Array.isArray(data.titles)) {
      // Convert titles format to chapters format
      normalizedChapters = data.titles.map(item => ({
        time: item.timestamp,
        title: item.title
      }));
    } else {
      // Use items directly if available (for backward compatibility)
      const items = data.chapters || data.titles || [];
      if (Array.isArray(items)) {
        normalizedChapters = items;
      }
    }
    
    let chaptersText = '';
    const isLocal = data.source === "local";
    const isOpenAIDirect = data.source === "openai_direct";
    
    if (normalizedChapters.length === 0) {
      // Display a message if no chapters were found
      const noChaptersElement = document.createElement('div');
      noChaptersElement.className = 'error-item';
      noChaptersElement.textContent = 'No chapters could be generated for this video. Try again or use a different video.';
      chaptersContainer.appendChild(noChaptersElement);
    } else {
      // If this was generated locally or with direct OpenAI, add an info message
      if (isLocal) {
        const sourceInfo = document.createElement('div');
        sourceInfo.className = 'info-item';
        sourceInfo.textContent = 'Chapters generated locally from transcript timestamps (API unavailable)';
        chaptersContainer.appendChild(sourceInfo);
      } else if (isOpenAIDirect) {
        const sourceInfo = document.createElement('div');
        sourceInfo.className = 'info-item openai-item';
        sourceInfo.textContent = 'Chapters generated directly with your OpenAI API key';
        chaptersContainer.appendChild(sourceInfo);
      }
      
      normalizedChapters.forEach(chapter => {
        // Handle both formats
        const timeString = chapter.time || chapter.timestamp;
        const title = chapter.title;
        
        if (timeString && title) {
          const chapterElement = document.createElement('div');
          chapterElement.className = 'chapter-item';
          chapterElement.textContent = `${timeString} ${title}`;
          chaptersContainer.appendChild(chapterElement);
          
          chaptersText += `${timeString} ${title}\n`;
        }
      });
      
      // Store the formatted text for copying
      chaptersContainer.dataset.fullText = chaptersText.trim();
    }
    
    // Enable the Generate button again
    generateBtn.disabled = false;
  }

  // Show loading state
  function showLoading(message = 'Generating chapters...') {
    generateBtn.disabled = true;
    statusContainer.classList.add('hidden');
    loadingElement.querySelector('p').textContent = message;
    loadingElement.classList.remove('hidden');
    resultsElement.classList.add('hidden');
    errorMessage.classList.add('hidden');
  }

  // Hide loading state
  function hideLoading() {
    generateBtn.disabled = false;
    loadingElement.classList.add('hidden');
    statusContainer.classList.remove('hidden');
    statusElement.textContent = 'Ready to generate chapters. Open a YouTube video and click the button below.';
  }

  // Show error message
  function showError(message = 'An error occurred. Please try again.') {
    loadingElement.classList.add('hidden');
    statusContainer.classList.remove('hidden');
    errorMessage.querySelector('p').textContent = message;
    errorMessage.classList.remove('hidden');
    generateBtn.disabled = false;
    
    setTimeout(() => {
      errorMessage.classList.add('hidden');
    }, 10000); // Longer timeout to read error messages
  }

  // Handle the Generate button click
  generateBtn.addEventListener('click', function() {
    checkYouTubePage(function(tab) {
      const videoId = getVideoId(tab.url);
      if (videoId) {
        generateChapters(tab, videoId);
      } else {
        statusElement.textContent = 'Could not extract video ID. Please try again.';
      }
    });
  });

  // Handle the Copy button click
  copyBtn.addEventListener('click', function() {
    const textToCopy = chaptersContainer.dataset.fullText;
    navigator.clipboard.writeText(textToCopy).then(function() {
      copyMessage.classList.remove('hidden');
      setTimeout(function() {
        copyMessage.classList.add('hidden');
      }, 2000);
    });
  });

  // Initialize: check if we're on a YouTube page
  checkYouTubePage(function() {
    generateBtn.disabled = false;
  });

  // Function to generate chapters
  async function generateChapters(tab, videoId) {
    showLoading('Extracting video transcript...');
    
    try {
      // Get the transcript from the content script
      const transcriptResponse = await getVideoTranscript(tab.id);
      console.log('Transcript response:', transcriptResponse);
      
      if (!transcriptResponse || !transcriptResponse.transcript) {
        throw new Error('Failed to extract transcript');
      }
      
      const transcript = transcriptResponse.transcript;
      showDebugInfo(transcript);
      
      // Define generation methods with priorities and conditions
      const methods = [
        {
          name: 'server',
          priority: 1,
          condition: () => true, // Always try server first
          fn: generateWithServerAPI
        },
        {
          name: 'openai',
          priority: 2,
          condition: async () => {
            const result = await chrome.storage.sync.get(['openai_api_key']);
            return !!result.openai_api_key;
          },
          fn: generateWithOpenAI
        },
        {
          name: 'local',
          priority: 3,
          condition: () => Array.isArray(transcript) && transcript.length > 0,
          fn: generateChaptersLocally
        }
      ];

      // Sort methods by priority
      methods.sort((a, b) => a.priority - b.priority);

      let lastError = null;
      let methodsAttempted = 0;

      // Try each method in sequence
      for (const method of methods) {
        try {
          // Check if this method should be attempted
          const shouldTry = await method.condition();
          if (!shouldTry) {
            console.log(`Skipping ${method.name} generation - conditions not met`);
            continue;
          }

          methodsAttempted++;
          showLoading(`Generating chapters using ${method.name} method...`);
          console.log(`Attempting ${method.name} generation method`);

          const result = await method.fn(videoId, transcript);
          
          if (result && result.chapters && result.chapters.length > 0) {
            console.log(`Successfully generated chapters using ${method.name} method`);
            displayChapters({
              ...result,
              source: method.name
            });
            return;
          } else {
            console.log(`${method.name} method returned no chapters`);
            throw new Error(`${method.name} method returned no chapters`);
          }
        } catch (error) {
          console.error(`${method.name} generation failed:`, error);
          lastError = error;
          
          // Show intermediate error for user feedback
          showError(`${method.name} generation failed: ${error.message}. Trying next method...`);
          
          // If this was the last method, don't continue
          if (methodsAttempted === methods.length) {
            throw new Error(`All generation methods failed. Last error: ${error.message}`);
          }
          
          // Wait a bit before trying next method
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }

      // If we get here and haven't returned, all methods failed
      throw new Error(lastError?.message || 'All generation methods failed');

    } catch (error) {
      console.error('Generate chapters error:', error);
      showError(error.message || 'Failed to generate chapters');
      hideLoading();
    }
  }
  
  // Generate chapters using server API
  async function generateWithServerAPI(videoId, transcript) {
    // Format the transcript data properly
    const formattedData = formatTranscriptForAPI(transcript, videoId);
    console.log('Sending formatted data to API:', formattedData);

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(formattedData)
      });

      // First try to parse the response as JSON
      let data;
      const textResponse = await response.text();
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        console.error('Failed to parse API response:', textResponse);
        throw new Error(`API response parsing failed: ${textResponse.substring(0, 100)}`);
      }

      // Log the complete response for debugging
      console.log('API Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data
      });

      if (!response.ok) {
        // Throw a detailed error with all available information
        throw new Error(
          `API error (${response.status}): ${data.error || data.message || response.statusText}`
        );
      }

      // Validate the response has either chapters or titles
      if ((!data.chapters || !Array.isArray(data.chapters) || data.chapters.length === 0) && 
          (!data.titles || !Array.isArray(data.titles) || data.titles.length === 0)) {
        throw new Error('API returned no chapters or titles');
      }

      // Convert titles to chapters format if needed
      if (!data.chapters && data.titles && Array.isArray(data.titles)) {
        data.chapters = data.titles.map(item => ({
          time: item.timestamp,
          title: item.title
        }));
      }

      // Add source information to the response
      return {
        ...data,
        source: 'server_api'
      };
    } catch (error) {
      // If it's a network error, provide a clearer message
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('Could not connect to the API server. Please check your internet connection.');
      }
      throw error;
    }
  }
  
  // Generate chapters using OpenAI directly
  async function generateWithOpenAI(videoId, transcript) {
    // Get the API key
    const result = await chrome.storage.sync.get(['openai_api_key']);
    const apiKey = result.openai_api_key;
    
    if (!apiKey) {
      throw new Error('No OpenAI API key found. Please add your API key in the settings.');
    }

    // Format the transcript data
    const formattedData = formatTranscriptForAPI(transcript, videoId);
    console.log('Sending formatted data to OpenAI:', {
      ...formattedData,
      openai_api_key: '***' // Hide the actual key in logs
    });

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Generation-Method': 'openai_direct'
        },
        body: JSON.stringify({
          ...formattedData,
          openai_api_key: apiKey,
          use_openai_direct: true
        })
      });

      // Parse response carefully
      let data;
      const textResponse = await response.text();
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        console.error('Failed to parse OpenAI response:', textResponse);
        throw new Error(`OpenAI response parsing failed: ${textResponse.substring(0, 100)}`);
      }

      // Log the complete response for debugging (excluding sensitive data)
      console.log('OpenAI Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data: data ? {
          ...data,
          openai_api_key: data.openai_api_key ? '***' : undefined
        } : null
      });

      if (!response.ok) {
        // Handle specific OpenAI error cases
        if (response.status === 401) {
          throw new Error('Invalid OpenAI API key. Please check your API key in the settings.');
        } else if (response.status === 429) {
          throw new Error('OpenAI API rate limit exceeded. Please try again later.');
        } else if (response.status === 500) {
          throw new Error('OpenAI API server error. Please try again later.');
        }
        
        throw new Error(
          `OpenAI API error (${response.status}): ${data.error || data.message || response.statusText}`
        );
      }

      // Validate the response has either chapters or titles
      if ((!data.chapters || !Array.isArray(data.chapters) || data.chapters.length === 0) && 
          (!data.titles || !Array.isArray(data.titles) || data.titles.length === 0)) {
        throw new Error('OpenAI returned no chapters or titles');
      }

      // Convert titles to chapters format if needed
      if (!data.chapters && data.titles && Array.isArray(data.titles)) {
        data.chapters = data.titles.map(item => ({
          time: item.timestamp,
          title: item.title
        }));
      }

      // Validate chapter format
      const invalidChapters = data.chapters.filter(
        chapter => !chapter.time || !chapter.title
      );
      
      if (invalidChapters.length > 0) {
        console.error('Invalid chapters in response:', invalidChapters);
        throw new Error('OpenAI returned invalid chapter format');
      }

      // Add source information
      return {
        ...data,
        source: 'openai_direct'
      };
    } catch (error) {
      // If it's a network error, provide a clearer message
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('Could not connect to the API server. Please check your internet connection.');
      }
      throw error;
    }
  }
  
  // Function to generate chapters locally
  async function generateChaptersLocally(transcript) {
    console.log('Generating chapters locally from transcript');
    showLoading('Generating chapters locally...');
    
    try {
      // If transcript is a string, we can't generate timestamped chapters
      if (typeof transcript === 'string') {
        throw new Error('Cannot generate chapters from plain text transcript');
      }
      
      // Ensure transcript is an array with timestamps
      if (!Array.isArray(transcript) || transcript.length === 0) {
        throw new Error('Invalid transcript format for local generation');
      }
      
      // Get total duration from last segment
      const lastSegment = transcript[transcript.length - 1];
      const totalDuration = lastSegment.start + (lastSegment.duration || 0);
      
      // Calculate roughly 5-8 chapters based on video length
      const numChapters = Math.min(8, Math.max(5, Math.floor(totalDuration / 300))); // One chapter every ~5 minutes
      const interval = Math.floor(transcript.length / numChapters);
      
      const chapters = [];
      let currentIndex = 0;
      
      // Always include the first segment as "Introduction"
      chapters.push({
        time: formatTimestamp(transcript[0].start),
        title: "Introduction"
      });
      
      // Generate chapters at intervals
      for (let i = 1; i < numChapters - 1; i++) {
        currentIndex += interval;
        if (currentIndex >= transcript.length) break;
        
        const segment = transcript[currentIndex];
        const surroundingText = transcript
          .slice(Math.max(0, currentIndex - 2), Math.min(transcript.length, currentIndex + 3))
          .map(s => s.text)
          .join(' ');
        
        const title = createTitleFromText(surroundingText);
        chapters.push({
          time: formatTimestamp(segment.start),
          title: title
        });
      }
      
      // Add a final chapter if we have room and haven't reached the end
      if (chapters.length < numChapters && 
          currentIndex + interval < transcript.length - 10) {
        const finalIndex = transcript.length - 10;
        const finalSegment = transcript[finalIndex];
        const finalText = transcript
          .slice(finalIndex, Math.min(transcript.length, finalIndex + 5))
          .map(s => s.text)
          .join(' ');
        
        chapters.push({
          time: formatTimestamp(finalSegment.start),
          title: createTitleFromText(finalText)
        });
      }
      
      // Display the locally generated chapters
      displayChapters({
        chapters: chapters,
        source: 'local'
      });
      
    } catch (error) {
      console.error('Error in local generation:', error);
      showError('Failed to generate chapters locally: ' + error.message);
      hideLoading();
    }
  }

  // Helper to create a chapter title from transcript text
  function createTitleFromText(text) {
    if (!text || text.length === 0) {
      return "Section";
    }
    
    // Remove filler words and clean up text
    const fillerWords = ["um", "uh", "like", "you know", "so", "basically", "actually"];
    let cleaned = text;
    
    fillerWords.forEach(word => {
      cleaned = cleaned.replace(new RegExp(`\\b${word}\\b`, 'gi'), "");
    });
    
    // Split into sentences and take the first one
    const sentences = cleaned.split(/[.!?]+/);
    let title = sentences[0].trim();
    
    // Limit length and ensure it starts with a capital letter
    if (title.length > 40) {
      title = title.substring(0, 37).split(" ").slice(0, -1).join(" ") + "...";
    }
    
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    
    // Default fallback
    if (title.length < 3) {
      title = "Section";
    }
    
    return title;
  }
}); 