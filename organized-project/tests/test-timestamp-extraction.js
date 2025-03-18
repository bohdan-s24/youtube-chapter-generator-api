// Test script for transcript timestamp extraction
const fs = require('fs');

// Sample transcript data (first few segments from user's example)
const sampleTranscript = [
  { start: 0, text: "so I see a lot of KDP strategies that" },
  { start: 2, text: "are taught by other gurus that are" },
  { start: 3, text: "extremely outdated and does not work" },
  { start: 5, text: "anymore whenever I hear these advice" },
  { start: 7, text: "it's so clear to me that they haven't" },
  { start: 9, text: "published a book since 2016 advice is" },
  { start: 11, text: "like publish a bunch of 5 to 10K word" },
  { start: 14, text: "mini book post three times a day on" },
  { start: 16, text: "Instagram and Twitter use the same" },
  { start: 17, text: "Interiors like Journal Interiors with a" }
];

// Function to create timestamps array
function generateFullTranscript(count) {
  const result = [];
  for (let i = 0; i < count; i++) {
    // Create segments starting from 0 and incrementing by 1-3 seconds each time
    const start = i * 2;
    result.push({
      start,
      text: `Sample text at timestamp ${formatTimestamp(start)}`
    });
  }
  return result;
}

// Create a 526-segment transcript to match the user's example
const fullTranscript = generateFullTranscript(526);

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

// Extract key segments from transcript
function extractKeySegments(transcript) {
  const numSegments = transcript.length;
  const targetPoints = 6; // We want roughly 6 chapters
  const interval = Math.max(1, Math.floor(numSegments / targetPoints));
  
  const keySegments = [];
  
  // Always include the first segment
  keySegments.push(transcript[0]);
  
  // Sample segments at regular intervals
  for (let i = interval; i < numSegments - interval; i += interval) {
    keySegments.push(transcript[i]);
  }
  
  // Always include the last segment if it's not too close to the previous one
  const lastSegment = transcript[numSegments - 1];
  if (lastSegment && (!keySegments.length || 
      Math.abs(getTimestampSeconds(formatTimestamp(lastSegment.start || 0)) - 
               getTimestampSeconds(formatTimestamp(keySegments[keySegments.length - 1].start || 0))) > 60)) {
    keySegments.push(lastSegment);
  }
  
  return keySegments;
}

// Format transcript for API
function formatTranscriptForAPI(transcript, keySegments) {
  const totalDuration = transcript.length > 0 
    ? transcript[transcript.length - 1].start + 2 // Add a small amount for the duration of last segment
    : 0;
  
  const numSegments = transcript.length;
  const contextWindow = 2; // Number of segments before and after for context
  const processedSegments = new Set();
  
  // Format transcript text
  let transcriptText = keySegments.map(keySegment => {
    const keyIndex = transcript.indexOf(keySegment);
    const start = Math.max(0, keyIndex - contextWindow);
    const end = Math.min(numSegments, keyIndex + contextWindow + 1);
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
  
  // Add some additional context about available timestamps
  const availableTimestamps = keySegments
    .map(segment => segment.timestamp || (segment.start !== undefined ? formatTimestamp(segment.start) : ''))
    .filter(Boolean);
  
  transcriptText = `VIDEO DURATION: ${formatTimestamp(totalDuration)}
KEY TIMESTAMPS AVAILABLE: ${availableTimestamps.join(', ')}

TRANSCRIPT SEGMENTS:
${transcriptText}`;
  
  return {
    text: transcriptText,
    totalDuration,
    availableTimestamps
  };
}

// Main function to test timestamp extraction
function testTimestampExtraction() {
  console.log("Testing with sample transcript (10 segments):");
  const sampleKeySegments = extractKeySegments(sampleTranscript);
  const sampleResult = formatTranscriptForAPI(sampleTranscript, sampleKeySegments);
  
  console.log("\nSample Transcript Key Segments:");
  console.log(sampleKeySegments.map(seg => `[${formatTimestamp(seg.start)}] ${seg.text}`));
  
  console.log("\nSample Available Timestamps:");
  console.log(sampleResult.availableTimestamps);
  
  console.log("\nTesting with full transcript (526 segments):");
  const fullKeySegments = extractKeySegments(fullTranscript);
  const fullResult = formatTranscriptForAPI(fullTranscript, fullKeySegments);
  
  console.log("\nFull Transcript Key Segments:");
  console.log(fullKeySegments.map(seg => `[${formatTimestamp(seg.start)}] ${seg.text}`));
  
  console.log("\nFull Available Timestamps:");
  console.log(fullResult.availableTimestamps);
  
  // Write results to file for inspection
  fs.writeFileSync('sample-transcript-format.txt', sampleResult.text);
  fs.writeFileSync('full-transcript-format.txt', fullResult.text);
  
  console.log("\nResults written to sample-transcript-format.txt and full-transcript-format.txt");
  
  // Check if timestamps are being distributed throughout the video
  const timestampValues = fullResult.availableTimestamps.map(ts => getTimestampSeconds(ts));
  const minTimestamp = Math.min(...timestampValues);
  const maxTimestamp = Math.max(...timestampValues);
  const range = maxTimestamp - minTimestamp;
  
  console.log("\nTimestamp Distribution Analysis:");
  console.log(`Minimum Timestamp: ${formatTimestamp(minTimestamp)}`);
  console.log(`Maximum Timestamp: ${formatTimestamp(maxTimestamp)}`);
  console.log(`Range: ${range} seconds`);
  
  // Check if timestamps are evenly distributed
  console.log("\nTimestamp Spacing:");
  for (let i = 1; i < timestampValues.length; i++) {
    const gap = timestampValues[i] - timestampValues[i-1];
    console.log(`Gap between timestamp ${i-1} and ${i}: ${gap} seconds`);
  }
}

// Run the test
testTimestampExtraction(); 