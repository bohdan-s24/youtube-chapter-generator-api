// Script to package the extension for distribution
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Source and destination paths
const SRC_DIR = path.join(__dirname, '../src');
const PUBLIC_DIR = path.join(__dirname, '../public');
const DIST_DIR = path.join(__dirname, '../../dist');

// Create dist directory if it doesn't exist
if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR);
}

// Create a write stream for the zip file
const output = fs.createWriteStream(path.join(DIST_DIR, 'extension.zip'));
const archive = archiver('zip', {
  zlib: { level: 9 } // Maximum compression
});

// Listen for archive events
output.on('close', () => {
  console.log(`Extension packaged successfully: ${archive.pointer()} total bytes`);
  console.log('The extension zip file is ready in the dist/ directory');
});

archive.on('error', (err) => {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Add source files
archive.directory(SRC_DIR, false);

// Add public files
archive.directory(PUBLIC_DIR, false);

// Finalize the archive
archive.finalize(); 