import Head from 'next/head';

export default function Home() {
  return (
    <div style={{ 
      fontFamily: 'Arial, sans-serif', 
      maxWidth: '800px', 
      margin: '0 auto', 
      padding: '20px' 
    }}>
      <Head>
        <title>YouTube Chapter Generator API</title>
        <meta name="description" content="API for generating YouTube chapter titles with timestamps using AI" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1 style={{ color: '#d02b1d' }}>YouTube Chapter Generator API</h1>
        <p>This API generates chapter titles with timestamps for YouTube videos using AI.</p>
        
        <h2>API Usage</h2>
        <pre style={{ 
          backgroundColor: '#f5f5f5', 
          padding: '15px', 
          borderRadius: '5px', 
          overflow: 'auto' 
        }}>
{`POST /api/generate-chapters
Content-Type: application/json

{
  "videoId": "your_youtube_video_id"
}`}
        </pre>
        
        <h3>Response Format</h3>
        <pre style={{ 
          backgroundColor: '#f5f5f5', 
          padding: '15px', 
          borderRadius: '5px', 
          overflow: 'auto' 
        }}>
{`{
  "chapters": [
    {
      "time": "00:00",
      "title": "Introduction to the Topic"
    },
    {
      "time": "05:30",
      "title": "Exploring Key Concepts"
    },
    // Additional chapters...
  ]
}`}
        </pre>
      </main>

      <footer style={{ marginTop: '40px', borderTop: '1px solid #eaeaea', paddingTop: '20px' }}>
        <p>YouTube Chapter Generator API - Powered by OpenAI</p>
      </footer>
    </div>
  );
} 