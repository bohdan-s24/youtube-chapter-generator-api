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
  
  // Add download debug info button
  const downloadDebugBtn = document.createElement('button');
  downloadDebugBtn.textContent = 'Download Full Debug Report';
  downloadDebugBtn.className = 'secondary-btn';
  downloadDebugBtn.style.marginTop = '10px';
  downloadDebugBtn.style.marginLeft = '10px';
  downloadDebugBtn.style.display = 'none'; // Hidden by default
  
  // Insert buttons
  copyBtn.parentNode.insertBefore(debugToggleBtn, copyBtn.nextSibling);
  copyBtn.parentNode.insertBefore(downloadDebugBtn, debugToggleBtn.nextSibling);
  
  // Current transcript data
  let currentTranscriptData = null;
  let currentFormattedData = null;
  
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

  // Download debug report event
  downloadDebugBtn.addEventListener('click', function() {
    if (!currentTranscriptData) return;
    
    // Create a comprehensive debug report
    let report = "# YouTube Chapter Generator Debug Report\n\n";
    report += `Generated: ${new Date().toISOString()}\n\n`;
    
    if (Array.isArray(currentTranscriptData)) {
      // Add transcript details
      report += `## Transcript Information\n\n`;
      report += `Total segments: ${currentTranscriptData.length}\n`;
      
      if (currentTranscriptData.length > 0) {
        const firstSegment = currentTranscriptData[0];
        const lastSegment = currentTranscriptData[currentTranscriptData.length - 1];
        
        const firstTimestamp = firstSegment.timestamp || (firstSegment.start !== undefined ? formatTimestamp(firstSegment.start) : 'unknown');
        const lastTimestamp = lastSegment.timestamp || (lastSegment.start !== undefined ? formatTimestamp(lastSegment.start) : 'unknown');
        
        report += `Time range: ${firstTimestamp} - ${lastTimestamp}\n\n`;
      }
      
      // Add formatted data information if available
      if (currentFormattedData) {
        report += `## API Request Information\n\n`;
        report += `Format: ${currentFormattedData.format}\n`;
        report += `Use timestamps: ${currentFormattedData.useTimestamps}\n`;
        report += `Video ID: ${currentFormattedData.videoId}\n\n`;
        
        // Add server debug information if available
        if (currentFormattedData.serverDebug) {
          report += `## Server Debug Information\n\n`;
          report += `Transcript Type: ${currentFormattedData.serverDebug.transcriptType || 'unknown'}\n`;
          report += `Is Array: ${currentFormattedData.serverDebug.isArray !== undefined ? currentFormattedData.serverDebug.isArray : 'unknown'}\n`;
          report += `Length: ${currentFormattedData.serverDebug.length || 'unknown'}\n`;
          report += `Timestamps Found: ${currentFormattedData.serverDebug.timestampsFound || 'unknown'}\n`;
          report += `Total Duration: ${currentFormattedData.serverDebug.totalDuration || 'unknown'}\n`;
          
          if (currentFormattedData.serverDebug.keySegmentsSelected) {
            report += `Key Segments Selected: ${currentFormattedData.serverDebug.keySegmentsSelected}\n`;
          }
          
          if (currentFormattedData.serverDebug.keySegmentTimestamps) {
            report += `Key Timestamps: ${currentFormattedData.serverDebug.keySegmentTimestamps.join(', ')}\n`;
          }
          
          if (currentFormattedData.serverDebug.availableTimestamps) {
            report += `Available Timestamps: ${currentFormattedData.serverDebug.availableTimestamps.join(', ')}\n`;
          }
          
          if (currentFormattedData.serverDebug.segmentTypes) {
            report += `\nSegment Types Information:\n`;
            currentFormattedData.serverDebug.segmentTypes.forEach((segment, i) => {
              report += `Segment ${i}:\n`;
              report += `  - Has Start: ${segment.hasStart}\n`;
              report += `  - Has Timestamp: ${segment.hasTimestamp}\n`;
              report += `  - Start Type: ${segment.startType}\n`;
              report += `  - Start Value: ${segment.startValue}\n`;
              report += `  - Has Duration: ${segment.hasDuration}\n`;
            });
            report += '\n';
          }
        }
      }
      
      // Add complete transcript
      report += `## Complete Transcript\n\n`;
      currentTranscriptData.forEach((segment, index) => {
        const timestamp = segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : 'unknown');
        report += `[${timestamp}] ${segment.text}\n`;
      });
    } else {
      // Plain text transcript
      report += `## Plain Text Transcript\n\n${currentTranscriptData}\n`;
    }
    
    // Create blob and download
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube-chapters-debug-report.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // Function to show debug information with timestamp verification
  function showDebugInfo(transcript, error = null, apiData = null) {
    let debugText = '';
    currentTranscriptData = transcript;
    currentFormattedData = apiData;
    
    if (typeof transcript === 'string') {
      debugText = "Plain text transcript (no timestamps):\n\n" + transcript.substring(0, 500) + "...";
    } else if (Array.isArray(transcript)) {
      debugText = `Transcript with ${transcript.length} segments:\n\n`;
      
      // Show timestamp distribution
      if (transcript.length > 0) {
        // Get first segment timestamp
        const firstSegment = transcript[0];
        const firstTimestamp = firstSegment.timestamp || (firstSegment.start !== undefined ? formatTimestamp(firstSegment.start) : 'unknown');
        
        // Get last segment timestamp
        const lastSegment = transcript[transcript.length - 1];
        const lastTimestamp = lastSegment.timestamp || (lastSegment.start !== undefined ? formatTimestamp(lastSegment.start) : 'unknown');
        
        // Calculate some middle segments for distribution analysis
        const quarterIndex = Math.floor(transcript.length / 4);
        const halfIndex = Math.floor(transcript.length / 2);
        const threeQuarterIndex = Math.floor(transcript.length * 3 / 4);
        
        const quarterSegment = transcript[quarterIndex];
        const halfSegment = transcript[halfIndex];
        const threeQuarterSegment = transcript[threeQuarterIndex];
        
        const quarterTimestamp = quarterSegment.timestamp || (quarterSegment.start !== undefined ? formatTimestamp(quarterSegment.start) : 'unknown');
        const halfTimestamp = halfSegment.timestamp || (halfSegment.start !== undefined ? formatTimestamp(halfSegment.start) : 'unknown');
        const threeQuarterTimestamp = threeQuarterSegment.timestamp || (threeQuarterSegment.start !== undefined ? formatTimestamp(threeQuarterSegment.start) : 'unknown');
        
        debugText += `Transcript Spans: ${firstTimestamp} to ${lastTimestamp}\n`;
        debugText += `Key timestamps throughout transcript:\n`;
        debugText += `- Start (0%): ${firstTimestamp}\n`;
        debugText += `- 25%: ${quarterTimestamp}\n`;
        debugText += `- Middle (50%): ${halfTimestamp}\n`;
        debugText += `- 75%: ${threeQuarterTimestamp}\n`;
        debugText += `- End (100%): ${lastTimestamp}\n\n`;
      }
      
      // Show the first 15 segments with their timestamps
      const headSamplesToShow = Math.min(15, transcript.length);
      debugText += `First ${headSamplesToShow} segments:\n`;
      for (let i = 0; i < headSamplesToShow; i++) {
        const segment = transcript[i];
        if (segment.timestamp && segment.text) {
          debugText += `[${segment.timestamp}] ${segment.text}\n`;
        } else if (segment.start !== undefined && segment.text) {
          debugText += `[${formatTimestamp(segment.start)}] ${segment.text}\n`;
        } else {
          debugText += `[Format unknown] ${JSON.stringify(segment)}\n`;
        }
      }
      
      // Show some middle segments
      const midStart = Math.floor(transcript.length / 2) - 5;
      const midEnd = Math.min(transcript.length, midStart + 10);
      if (midStart > headSamplesToShow) {
        debugText += `\n... (skipping ${midStart - headSamplesToShow} segments) ...\n\n`;
        debugText += `Middle segments (${midStart}-${midEnd}):\n`;
        for (let i = midStart; i < midEnd; i++) {
          const segment = transcript[i];
          if (segment.timestamp && segment.text) {
            debugText += `[${segment.timestamp}] ${segment.text}\n`;
          } else if (segment.start !== undefined && segment.text) {
            debugText += `[${formatTimestamp(segment.start)}] ${segment.text}\n`;
          } else {
            debugText += `[Format unknown] ${JSON.stringify(segment)}\n`;
          }
        }
      }
      
      // Show the last 15 segments
      const tailSamplesToShow = Math.min(15, transcript.length);
      const tailStart = Math.max(midEnd, transcript.length - tailSamplesToShow);
      if (tailStart > midEnd) {
        debugText += `\n... (skipping ${tailStart - midEnd} segments) ...\n\n`;
        debugText += `Last ${transcript.length - tailStart} segments:\n`;
        for (let i = tailStart; i < transcript.length; i++) {
          const segment = transcript[i];
          if (segment.timestamp && segment.text) {
            debugText += `[${segment.timestamp}] ${segment.text}\n`;
          } else if (segment.start !== undefined && segment.text) {
            debugText += `[${formatTimestamp(segment.start)}] ${segment.text}\n`;
          } else {
            debugText += `[Format unknown] ${JSON.stringify(segment)}\n`;
          }
        }
      }
      
      // Add a note about using the download button
      debugText += `\n\nFor the complete transcript with all ${transcript.length} segments, use the "Download Full Debug Report" button.\n`;
      
      // Add error message if one was provided
      if (error) {
        debugText += `\nNOTE: API is failing with error: ${error}\n`;
        debugText += `This is a server-side issue. Using local chapter generation instead.\n`;
      }
      
      // Add information about what was formatted and sent to the API
      if (apiData) {
        debugText += `\nData formatted and sent to API:\n`;
        debugText += `- Format: ${apiData.format}\n`;
        debugText += `- Use Timestamps: ${apiData.useTimestamps}\n`;
        
        if (apiData.format === "timestamped_segments" && Array.isArray(apiData.transcript)) {
          debugText += `- Number of segments sent: ${apiData.transcript.length}\n`;
          
          const sampleSegments = apiData.transcript.slice(0, 3);
          debugText += `- Sample of formatted data (first 3):\n`;
          sampleSegments.forEach((seg, i) => {
            debugText += `  [${i}]: ${JSON.stringify(seg)}\n`;
          });
        }
        
        // Add server debug information if available
        if (apiData.serverDebug) {
          debugText += `\n## Server Debug Information\n\n`;
          
          if (apiData.serverDebug.transcriptType) {
            debugText += `Transcript Type: ${apiData.serverDebug.transcriptType}\n`;
          }
          
          if (apiData.serverDebug.isArray !== undefined) {
            debugText += `Is Array: ${apiData.serverDebug.isArray}\n`;
          }
          
          if (apiData.serverDebug.length) {
            debugText += `Length: ${apiData.serverDebug.length}\n`;
          }
          
          if (apiData.serverDebug.timestampsFound) {
            debugText += `Timestamps Found: ${apiData.serverDebug.timestampsFound}\n`;
          }
          
          if (apiData.serverDebug.totalDuration) {
            debugText += `Total Duration: ${apiData.serverDebug.totalDuration}\n`;
          }
          
          if (apiData.serverDebug.keySegmentsSelected) {
            debugText += `Key Segments Selected: ${apiData.serverDebug.keySegmentsSelected}\n`;
          }
          
          if (apiData.serverDebug.keySegmentTimestamps) {
            debugText += `Key Timestamps: ${apiData.serverDebug.keySegmentTimestamps.join(', ')}\n`;
          }
          
          if (apiData.serverDebug.availableTimestamps) {
            debugText += `Available Timestamps: ${apiData.serverDebug.availableTimestamps.join(', ')}\n`;
          }
          
          if (apiData.serverDebug.segmentTypes) {
            debugText += `\nSegment Types Information:\n`;
            apiData.serverDebug.segmentTypes.forEach((segment, i) => {
              debugText += `Segment ${i}:\n`;
              debugText += `  - Has Start: ${segment.hasStart}\n`;
              debugText += `  - Has Timestamp: ${segment.hasTimestamp}\n`;
              debugText += `  - Start Type: ${segment.startType}\n`;
              debugText += `  - Start Value: ${segment.startValue}\n`;
              debugText += `  - Has Duration: ${segment.hasDuration}\n`;
            });
          }
        }
      }
    } else {
      debugText = "Unknown transcript format: " + JSON.stringify(transcript).substring(0, 500);
    }
    
    debugContent.textContent = debugText;
    debugToggleBtn.style.display = 'block';
    downloadDebugBtn.style.display = transcript ? 'inline-block' : 'none';
  }

  // API endpoint
  const API_ENDPOINT = 'https://youtube-chapter-generator-api.vercel.app/api/generate-chapters';

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
    
    // If transcript is already a string, convert it to a more useful format
    if (typeof transcript === 'string') {
      // For plain text transcripts, we can't reliably generate timestamped chapters
      // Return a simple object with the transcript text
      return {
        videoId: videoId,
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
      formattedSegments.sort((a, b) => (a.start_seconds || 0) - (b.start_seconds || 0));
      
      return {
        videoId: videoId,
        transcript: formattedSegments,
        format: "timestamped_segments",
        useTimestamps: true // Explicit instruction to use timestamps
      };
    }
    
    // Fallback for unexpected transcript format
    return {
      videoId: videoId,
      transcript: transcript,
      format: "unknown"
    };
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

  // Function to display chapters
  function displayChapters(data) {
    // Clear previous results
    chaptersContainer.innerHTML = '';
    let formattedText = '';
    
    // Show source of generation
    let sourceMessage = '';
    if (data.source === 'openai_direct') {
      sourceMessage = 'Chapters generated directly with your OpenAI API key';
    } else if (data.source === 'server_api') {
      sourceMessage = 'Chapters generated with server API';
    } else if (data.source === 'local') {
      sourceMessage = 'Chapters generated locally from transcript timestamps';
    }
    
    if (sourceMessage) {
      const sourceDiv = document.createElement('div');
      sourceDiv.className = 'source-message';
      sourceDiv.textContent = sourceMessage;
      chaptersContainer.appendChild(sourceDiv);
    }
    
    // Display each chapter
    data.chapters.forEach(chapter => {
      const chapterDiv = document.createElement('div');
      chapterDiv.className = 'chapter-item';
      
      const text = `${chapter.time} ${chapter.title}`;
      chapterDiv.textContent = text;
      formattedText += text + '\n';
      
      chaptersContainer.appendChild(chapterDiv);
    });
    
    // Store the formatted text for copying
    chaptersContainer.dataset.copyText = formattedText.trim();
    
    // Show the results
    resultsElement.classList.remove('hidden');
    copyBtn.disabled = false;
    hideLoading();
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
    const textToCopy = chaptersContainer.dataset.copyText;
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
      
      // Format transcript properly for the API
      const formattedData = formatTranscriptForAPI(transcript, videoId);
      console.log("Formatted transcript for API:", formattedData);
      
      // Update debug info with formatted data
      showDebugInfo(transcript, null, formattedData);
      
      // First try the server API
      showLoading('Generating chapters with AI...');
      try {
        const requestData = {
          videoId: videoId,
          transcript: formattedData.transcript,
          useTimestamps: true,
          format: formattedData.format
        };
        
        console.log("Sending to API:", requestData);
        
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestData)
        });
        
        const data = await response.json();
        console.log("API response:", data);
        
        // Display debug information if available in the response
        if (data.debug) {
          const debugNote = "Server Debug Info: " + JSON.stringify(data.debug, null, 2);
          console.log(debugNote);
          
          // Append server debug info to our debug display
          showDebugInfo(transcript, null, {
            ...formattedData,
            serverDebug: data.debug
          });
        }
        
        // Check if we should use local generation
        if (!response.ok && data.shouldUseLocalGeneration) {
          console.log('Server API failed, falling back to local generation');
          showDebugInfo(transcript, data.error || 'API error', formattedData);
          return await generateChaptersLocally(transcript);
        }
        
        // If response is not ok and we shouldn't use local generation, throw error
        if (!response.ok) {
          throw new Error(data.error || 'Failed to generate chapters');
        }
        
        // If we got chapters, display them
        if (data.chapters && data.chapters.length > 0) {
          // Add a source property to indicate where the chapters came from
          data.source = 'server_api';
          displayChapters(data);
          return;
        }
        
        // If we got here, something went wrong
        throw new Error('No chapters generated');
        
      } catch (apiError) {
        console.error('API Error:', apiError);
        
        // Try using OpenAI directly if we have an API key
        try {
          const result = await chrome.storage.sync.get(['openai_api_key']);
          if (result.openai_api_key) {
            console.log('Trying direct OpenAI generation...');
            showLoading('Trying direct OpenAI generation...');
            
            const openaiResponse = await fetch(API_ENDPOINT, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                videoId: videoId,
                transcript: formattedData.transcript,
                useTimestamps: true,
                format: formattedData.format,
                openai_api_key: result.openai_api_key,
                use_openai_direct: true
              })
            });
            
            const openaiData = await openaiResponse.json();
            console.log("OpenAI direct response:", openaiData);
            
            if (openaiResponse.ok && openaiData.chapters) {
              // Add source info to the response
              openaiData.source = 'openai_direct';
              displayChapters(openaiData);
              return;
            }
            
            // If OpenAI direct fails, fall back to local
            console.log('OpenAI direct failed, falling back to local');
            showDebugInfo(transcript, 'OpenAI direct generation failed', formattedData);
            return await generateChaptersLocally(transcript);
          }
        } catch (openaiError) {
          console.error('OpenAI Direct Error:', openaiError);
        }
        
        // If all else fails, use local generation
        console.log('All API attempts failed, using local generation');
        showDebugInfo(transcript, apiError.message, formattedData);
        return await generateChaptersLocally(transcript);
      }
    } catch (error) {
      console.error('Error:', error);
      showError(error.message);
      hideLoading();
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