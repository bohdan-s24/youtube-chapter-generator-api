// Background script for the YouTube Chapter Generator extension

// Listen for installation events
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First-time installation
    console.log('YouTube Chapter Generator extension installed');
  } else if (details.reason === 'update') {
    // Extension was updated
    console.log('YouTube Chapter Generator extension updated');
  }
});

// Add the background script to manifest.json
chrome.action.onClicked.addListener((tab) => {
  // Only open the popup if we're on a YouTube page
  if (tab.url.includes('youtube.com/watch')) {
    // The popup will be shown automatically when clicking the extension icon
    // This is handled by the "default_popup" in the manifest
  }
}); 