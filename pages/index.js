export default function Home() {
  return (
    <div style={{ 
      padding: '2rem',
      maxWidth: '800px',
      margin: '0 auto',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1>YouTube Chapter Generator API</h1>
      <p>This is the API server for the YouTube Chapter Generator Chrome Extension.</p>
      <p>Available endpoints:</p>
      <ul>
        <li><code>/api/generate-chapters</code> - Generates chapters from video transcripts</li>
        <li><code>/api/get-transcript</code> - Retrieves transcripts from YouTube videos</li>
      </ul>
      <p>For more information, please visit the <a href="https://github.com/bohdan-s24/youtube-chapter-generator-api">GitHub repository</a>.</p>
    </div>
  );
} 