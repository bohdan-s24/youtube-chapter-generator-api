# YouTube Chapter Generator API

Backend API for the YouTube Chapter Generator Chrome extension. This API provides endpoints for fetching YouTube video transcripts and generating chapter titles using AI.

## Features

- Fetch YouTube video transcripts using youtube-transcript
- Generate chapter titles using OpenAI GPT-3.5
- Serverless deployment on Vercel
- CORS enabled for Chrome extension

## API Endpoints

### GET /api/get-transcript
Fetches the transcript for a YouTube video.

Request body:
```json
{
  "videoUrl": "https://www.youtube.com/watch?v=..."
}
```

### POST /api/generate-chapters
Generates chapter titles from a transcript.

Request body:
```json
{
  "transcript": "..."
}
```

## Setup

1. Clone the repository:
```bash
git clone https://github.com/your-username/youtube-chapter-generator-api.git
cd youtube-chapter-generator-api
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file with your OpenAI API key:
```
OPENAI_API_KEY=your_api_key_here
```

4. Run locally:
```bash
npm run dev
```

## Deployment

This API is designed to be deployed on Vercel. To deploy:

1. Install Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

## Environment Variables

- `OPENAI_API_KEY`: Your OpenAI API key

## License

MIT
