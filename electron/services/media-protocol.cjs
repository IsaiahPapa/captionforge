const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Readable } = require("node:stream");

const MEDIA_TYPES = {
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

function mediaType(filePath) {
  return MEDIA_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function parseRange(value, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value?.trim() || "");
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function serveMediaFile(request, filePath) {
  const stat = await fsp.stat(filePath);
  const type = mediaType(filePath);
  const rangeHeader = request.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, stat.size) : null;

  if (rangeHeader && !range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${stat.size}`
      }
    });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Length": String(end - start + 1),
    "Content-Type": type,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {})
  };
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const body = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
  return new Response(body, { status: range ? 206 : 200, headers });
}

module.exports = { mediaType, parseRange, serveMediaFile };
