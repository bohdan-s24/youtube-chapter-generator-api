const { YoutubeTranscript } = require('youtube-transcript');

// Helper function to extract video ID from YouTube URL
function extractVideoId(url) {
  if (!url) return null;
  
  try {
    const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[7].length === 11) ? match[7] : null;
  } catch (error) {
    console.error('Error extracting video ID:', error);
    return null;
  }
}

// Helper function to format timestamp from seconds
function formatTimestamp(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { videoUrl } = req.body;
    console.log('Fetching transcript for URL:', videoUrl);

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    // Get transcript using YouTube Transcript API
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (!transcript || transcript.length === 0) {
      return res.status(404).json({ error: 'No transcript found for this video' });
    }
    
    // Format transcript with timestamps
    const formattedTranscript = transcript.map(entry => ({
      timestamp: formatTimestamp(entry.offset / 1000),
      text: entry.text.trim()
    }));

    console.log(`Successfully fetched transcript with ${formattedTranscript.length} segments`);
    return res.status(200).json({ success: true, transcript: formattedTranscript });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    const errorMessage = error.message.includes('Could not find transcript') 
      ? 'No transcript available for this video'
      : 'Failed to fetch transcript';
    return res.status(500).json({ error: errorMessage });
  }
};
