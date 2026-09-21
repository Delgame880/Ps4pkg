#!/usr/bin/env node

'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number.parseInt(process.env.PORT || '8080', 10) || 8080;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const CONFIG_FILE = path.resolve(process.env.CONFIG_FILE || path.join(DATA_DIR, 'config.json'));
const DEFAULT_LIBRARY = path.resolve(process.env.PKG_DIR || '/pkg');
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_TRANSFERS = 100;
const SCAN_INTERVAL_MIN = 5;
const SCAN_INTERVAL_MAX = 3600;
const DEFAULT_SCAN_INTERVAL = 30;
const DEFAULT_PS4_PORT = 12801;
const DEFAULT_REQUEST_TIMEOUT = 60;
const MIN_REQUEST_TIMEOUT = 10;
const DEFAULT_POLL_INTERVAL = 2;
const CONFIG_VERSION = 2;
const LOG_LEVEL = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level, message, details) {
  const normalized = LOG_LEVELS[level] === undefined ? 'info' : level;
  if (LOG_LEVELS[normalized] > (LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info)) return;
  const suffix = details === undefined ? '' : ` ${formatLogDetails(details)}`;
  const line = `[${new Date().toISOString()}] [${normalized.toUpperCase()}] ${message}${suffix}`;
  if (normalized === 'error') console.error(line);
  else console.log(line);
}

function formatLogDetails(details) {
  if (details instanceof Error) return JSON.stringify({ message: details.message, code: details.code, stack: details.stack });
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details);
  } catch {
    return '[unserializable details]';
  }
}

function summarizePs4Payload(requestPath, payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  if (requestPath === '/api/install') {
    // Keep the diagnostic representation identical to the bytes sent to RPI.
    // Do not add packageCount or transfer metadata here.
    return {
      type: payload.type,
      packages: Array.isArray(payload.packages) ? payload.packages : [],
    };
  }
  return payload;
}

// Keep this separate from the transfer record and logging metadata. The RPI
// install endpoint only accepts these two keys in direct mode.
function createDirectInstallPayload(packageUrls) {
  if (!Array.isArray(packageUrls) || packageUrls.length === 0 || packageUrls.some((url) => typeof url !== 'string' || !url.trim())) {
    throw new Error('At least one package URL is required for a direct install.');
  }
  return {
    type: 'direct',
    packages: packageUrls.map((url) => url.trim()),
  };
}

const DEFAULT_CONFIG = {
  libraryPath: DEFAULT_LIBRARY,
  autoScan: true,
  scanIntervalSec: DEFAULT_SCAN_INTERVAL,
  ps4Host: '',
  ps4Port: DEFAULT_PS4_PORT,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',
  requestTimeoutSec: DEFAULT_REQUEST_TIMEOUT,
  pollIntervalSec: DEFAULT_POLL_INTERVAL,
};

let config = loadConfig();
let scanState = {
  scanning: false,
  lastScanAt: null,
  error: null,
  skipped: 0,
  files: [],
  promise: null,
};
const transfers = [];
let activeTransferId = null;
let scanTimer = null;

function loadConfig() {
  try {
    const contents = fs.readFileSync(CONFIG_FILE, 'utf8');
    const saved = JSON.parse(contents);
    const migrated = { ...saved };
    // Earlier builds used a much shorter default. Raise that legacy default
    // once, while still allowing users to choose a lower value afterwards.
    if (!saved.configVersion && Number(saved.requestTimeoutSec) < DEFAULT_REQUEST_TIMEOUT) {
      migrated.requestTimeoutSec = DEFAULT_REQUEST_TIMEOUT;
    }
    return sanitizeConfig({ ...DEFAULT_CONFIG, ...migrated });
  } catch (error) {
    return sanitizeConfig({ ...DEFAULT_CONFIG });
  }
}

function sanitizeConfig(input) {
  const next = { ...DEFAULT_CONFIG, ...input };
  next.configVersion = CONFIG_VERSION;
  next.libraryPath = path.resolve(String(next.libraryPath || DEFAULT_LIBRARY));
  next.autoScan = next.autoScan !== false;
  next.scanIntervalSec = clampInt(next.scanIntervalSec, SCAN_INTERVAL_MIN, SCAN_INTERVAL_MAX, DEFAULT_SCAN_INTERVAL);
  next.ps4Host = String(next.ps4Host || '').trim();
  next.ps4Port = clampInt(next.ps4Port, 1, 65535, DEFAULT_PS4_PORT);
  next.publicBaseUrl = normalizeBaseUrl(next.publicBaseUrl, true);
  next.requestTimeoutSec = clampInt(next.requestTimeoutSec, MIN_REQUEST_TIMEOUT, 300, DEFAULT_REQUEST_TIMEOUT);
  next.pollIntervalSec = clampInt(next.pollIntervalSec, 1, 10, DEFAULT_POLL_INTERVAL);
  return next;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBaseUrl(value, allowEmpty = false) {
  const raw = String(value || '').trim();
  if (!raw && allowEmpty) return '';
  if (!raw) throw new Error('A public URL is required.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Public URL must look like http://192.168.1.10:8080.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Public URL must use http or https.');
  }
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

async function saveConfig() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const temporary = `${CONFIG_FILE}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await fsp.rename(temporary, CONFIG_FILE);
}

function publicConfig(request) {
  return {
    libraryPath: config.libraryPath,
    autoScan: config.autoScan,
    scanIntervalSec: config.scanIntervalSec,
    ps4Host: config.ps4Host,
    ps4Port: config.ps4Port,
    publicBaseUrl: config.publicBaseUrl,
    requestTimeoutSec: config.requestTimeoutSec,
    pollIntervalSec: config.pollIntervalSec,
    libraryExists: existsDirectory(config.libraryPath),
    resolvedPublicUrl: getPublicBaseUrl(request),
  };
}

function existsDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function idForRelativePath(relativePath) {
  return Buffer.from(relativePath, 'utf8').toString('base64url');
}

function relativePathForId(id) {
  if (!id || typeof id !== 'string' || id.length > 4096) {
    throw new Error('Invalid package id.');
  }
  let relativePath;
  try {
    relativePath = Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    throw new Error('Invalid package id.');
  }
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid package path.');
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('Invalid package path.');
  }
  return normalized;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pathForId(id) {
  const relativePath = relativePathForId(id);
  const root = path.resolve(config.libraryPath);
  const absolute = path.resolve(root, relativePath);
  if (!isInside(root, absolute)) throw new Error('Package path is outside the configured library.');
  return { root, absolute, relativePath };
}

function packageKind(filename) {
  const name = filename.toLowerCase();
  if (/(^|[._ -])(dlc|addon|add-on|theme|license)([._ -]|$)/.test(name)) return 'DLC';
  if (/(^|[._ -])(update|patch)([._ -]|$)/.test(name) || /_a\d{4}/i.test(filename)) return 'Update';
  return 'Base';
}

function titleIdFromName(filename) {
  const match = filename.match(/cusa\d{5}/i);
  return match ? match[0].toUpperCase() : '';
}

function multipartInfo(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const filename = path.basename(normalized);
  const match = filename.match(/^(.*)_(\d+)\.pkg$/i);
  if (!match) return null;
  const directory = path.posix.dirname(normalized);
  const stem = match[1].toLowerCase();
  return {
    key: `${directory === '.' ? '' : `${directory}/`}${stem}`,
    index: Number.parseInt(match[2], 10),
  };
}

function fileInfo(relativePath, stat) {
  const filename = path.basename(relativePath);
  return {
    id: idForRelativePath(relativePath),
    name: filename,
    relativePath: relativePath.split(path.sep).join('/'),
    directory: path.dirname(relativePath) === '.' ? '/' : `/${path.dirname(relativePath).split(path.sep).join('/')}`,
    size: stat.size,
    modifiedAt: stat.mtime.toISOString(),
    kind: packageKind(filename),
    titleId: titleIdFromName(filename),
  };
}

async function scanLibrary() {
  if (scanState.scanning && scanState.promise) return scanState.promise;

  scanState.scanning = true;
  scanState.error = null;
  scanState.skipped = 0;
  const startedAt = Date.now();
  scanState.promise = (async () => {
    const root = path.resolve(config.libraryPath);
    const found = [];
    log('debug', 'Library scan started', { root });
    try {
      const rootStat = await fsp.stat(root);
      if (!rootStat.isDirectory()) throw new Error('The configured library path is not a directory.');

      async function walk(directory, relativeDirectory = '') {
        let entries;
        try {
          entries = await fsp.readdir(directory, { withFileTypes: true });
        } catch {
          scanState.skipped += 1;
          return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        for (const entry of entries) {
          const relative = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            await walk(absolute, relative);
            continue;
          }
          if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.pkg')) continue;
          try {
            const stat = await fsp.stat(absolute);
            found.push(fileInfo(relative, stat));
          } catch {
            scanState.skipped += 1;
          }
        }
      }

      await walk(root);
      found.sort((a, b) => a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: 'base', numeric: true }));
      scanState.files = found;
      scanState.lastScanAt = new Date().toISOString();
      scanState.error = null;
      log('info', 'Library scan completed', { root, packages: found.length, skipped: scanState.skipped, durationMs: Date.now() - startedAt });
    } catch (error) {
      scanState.files = [];
      scanState.lastScanAt = new Date().toISOString();
      scanState.error = error && error.message ? error.message : 'The library could not be scanned.';
      log('error', 'Library scan failed', { root, error: error.message, code: error.code, durationMs: Date.now() - startedAt });
    } finally {
      scanState.scanning = false;
      scanState.promise = null;
    }
    return scanState.files;
  })();

  return scanState.promise;
}

function scanSummary() {
  let totalSize = 0;
  for (const file of scanState.files) totalSize += Number(file.size) || 0;
  return {
    scanning: scanState.scanning,
    lastScanAt: scanState.lastScanAt,
    error: scanState.error,
    skipped: scanState.skipped,
    fileCount: scanState.files.length,
    totalSize,
  };
}

function shouldAutoScan() {
  if (!config.autoScan || scanState.scanning || !scanState.lastScanAt) return false;
  return Date.now() - Date.parse(scanState.lastScanAt) >= config.scanIntervalSec * 1000;
}

function startScanTimer() {
  if (scanTimer) clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    if (config.autoScan && !scanState.scanning) scanLibrary().catch(() => {});
  }, Math.max(SCAN_INTERVAL_MIN, config.scanIntervalSec) * 1000);
  if (scanTimer.unref) scanTimer.unref();
}

function getRequestHost(request) {
  const forwardedHost = request.headers['x-forwarded-host'];
  return String(forwardedHost || request.headers.host || `localhost:${PORT}`).split(',')[0].trim();
}

function getPublicBaseUrl(request) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const host = getRequestHost(request);
  const lowerHost = host.toLowerCase();
  const isLoopback = lowerHost.startsWith('localhost') || lowerHost.startsWith('127.0.0.1') || lowerHost.startsWith('[::1]') || lowerHost.startsWith('0.0.0.0');
  const protocol = String(request.headers['x-forwarded-proto'] || 'http').split(',')[0].trim() || 'http';
  if (!isLoopback) return `${protocol}://${host}`.replace(/\/$/, '');

  // A browser may be using localhost while the PS4 needs the host's LAN address.
  const port = server.address() && typeof server.address() === 'object' ? server.address().port : PORT;
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const network of entries || []) {
      if (network && network.family === 'IPv4' && !network.internal) return `http://${network.address}:${port}`;
    }
  }
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function packageUrl(request, id) {
  const base = getPublicBaseUrl(request);
  return `${base}/pkg/${encodeURIComponent(id)}`;
}

function parsePs4Address(overrides = {}) {
  const raw = String(overrides.ps4Host ?? config.ps4Host).trim();
  if (!raw) throw new Error('Set the PS4 IP address in Settings first.');
  let parsed;
  try {
    parsed = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw new Error('PS4 address must be an IP address or hostname.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PS4 address must use http or https.');
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: Number.parseInt(parsed.port, 10) || clampInt(overrides.ps4Port ?? config.ps4Port, 1, 65535, config.ps4Port),
  };
}

function requestPs4(method, requestPath, payload, connectionOverrides = {}) {
  const address = parsePs4Address(connectionOverrides);
  const transport = address.protocol === 'https:' ? https : http;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timeoutMs = config.requestTimeoutSec * 1000;
  const requestStartedAt = Date.now();
  const logLevel = requestPath === '/api/get_task_progress' ? 'debug' : 'info';
  const target = `${address.protocol}//${address.hostname}:${address.port}${requestPath}`;
  const bodyLength = Buffer.byteLength(body, 'utf8');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Content-Length': bodyLength,
    // The embedded RPI server is more reliable when the request is explicit
    // and does not leave a keep-alive socket open after the JSON body.
    Connection: 'close',
  };

  log(logLevel, 'PS4 request started', {
    method,
    target,
    timeoutSec: config.requestTimeoutSec,
    bodyBytes: bodyLength,
    headers,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
    payload: summarizePs4Payload(requestPath, payload),
  });

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: address.protocol,
      hostname: address.hostname,
      port: address.port,
      path: requestPath,
      method,
      timeout: timeoutMs,
      headers,
      agent: false,
      rejectUnauthorized: false,
    }, (response) => {
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length <= 5 * 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = {};
        let parseError = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            parseError = error.message;
            parsed = { raw };
          }
        }
        const statusCode = response.statusCode || 0;
        log(statusCode >= 400 ? 'warn' : logLevel, 'PS4 response received', {
          method,
          target,
          statusCode,
          durationMs: Date.now() - requestStartedAt,
          response: parsed,
          ...(parseError ? { parseError } : {}),
        });
        resolve({ statusCode, body: parsed, raw });
      });
    });
    request.on('timeout', () => {
      const error = new Error(`PS4 request timed out after ${config.requestTimeoutSec} seconds.`);
      error.code = 'ETIMEDOUT';
      log('error', 'PS4 request timed out', { method, target, durationMs: Date.now() - requestStartedAt, code: error.code });
      request.destroy(error);
    });
    request.on('error', (error) => {
      log('error', 'PS4 request failed', {
        method,
        target,
        durationMs: Date.now() - requestStartedAt,
        code: error.code,
        error: error.message,
      });
      reject(error);
    });
    if (body) request.write(body);
    request.end();
  });
}

function jsonNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return 0;
  const trimmed = value.trim();
  const parsed = /^0x/i.test(trimmed) ? Number.parseInt(trimmed, 16) : Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isNonZeroError(value) {
  if (value === undefined || value === null || value === '' || value === false) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'success' || normalized === '0' || normalized === '0x0') return false;
    if (!/^(?:0x[0-9a-f]+|\d+(?:\.\d+)?)$/i.test(normalized)) return true;
  }
  return jsonNumber(value) !== 0;
}

function remoteProgress(transfer, payload) {
  const body = payload && typeof payload === 'object' ? payload : {};
  if (isNonZeroError(body.error) || ['error', 'failed', 'failure'].includes(String(body.state || body.status || '').toLowerCase())) {
    const code = body.error || body.message || body.detail || 'The PS4 reported an installation error.';
    throw new Error(`PS4 installation error: ${code}`);
  }

  const length = jsonNumber(body.length_total || body.length || body.total_size || body.total);
  const transferred = jsonNumber(body.transferred_total || body.transferred || body.downloaded || body.bytes);
  const preparing = jsonNumber(body.preparing_percent || body.preparing || 0);
  const localCopy = jsonNumber(body.local_copy_percent || body.install_percent || body.installation_percent || 0);
  const download = length > 0 ? Math.min(100, (transferred / length) * 100) : jsonNumber(body.download_percent || body.progress || body.percentage);
  const explicit = jsonNumber(body.percent || body.percentage);
  let percent = Math.max(download, explicit);
  if (length > 0 && localCopy > 0) percent = Math.max(percent, download * 0.85 + localCopy * 0.15);
  if (localCopy >= 100 && (length <= 0 || transferred >= length)) percent = 100;

  const taskState = String(body.state || body.task_state || '').toLowerCase();
  const done = ['done', 'complete', 'completed', 'finished', 'success'].includes(taskState) || (localCopy >= 100 && (length <= 0 || transferred >= length));
  const phase = done ? 'Complete' : preparing < 100 ? 'Preparing' : download < 100 ? 'Downloading' : 'Installing';

  transfer.remote = {
    preparingPercent: Math.round(preparing),
    localCopyPercent: Math.round(localCopy),
    restSeconds: Math.round(jsonNumber(body.rest_sec_total || body.rest_sec)),
    state: body.state || body.task_state || body.status || '',
  };
  transfer.totalBytes = length || transfer.totalBytes || transfer.size;
  transfer.bytesTransferred = Math.min(transferred || transfer.bytesTransferred || 0, transfer.totalBytes || Number.MAX_SAFE_INTEGER);
  transfer.percent = Math.max(0, Math.min(100, Math.round(percent || 0)));
  transfer.phase = phase;
  transfer.lastUpdated = new Date().toISOString();
  return done;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTransfer(transfer, request) {
  transfer.status = 'sending';
  transfer.phase = 'Contacting PS4';
  transfer.startedAt = transfer.startedAt || new Date().toISOString();
  transfer.lastUpdated = new Date().toISOString();
  const fileIds = Array.isArray(transfer.fileIds) && transfer.fileIds.length ? transfer.fileIds : [transfer.fileId];
  const packageUrls = fileIds.map((fileId) => packageUrl(request, fileId));
  transfer.packageUrl = packageUrls;
  log('info', 'Starting PS4 package transfer', {
    transferId: transfer.id,
    fileName: transfer.fileName,
    packageCount: packageUrls.length,
    packageUrls,
    size: transfer.size,
  });

  const installPayload = createDirectInstallPayload(packageUrls);
  const installResponse = await requestPs4('POST', '/api/install', installPayload);
  const installBody = installResponse.body || {};
  const taskId = installBody.task_id ?? installBody.taskId ?? installBody.id;
  log('info', 'PS4 install request processed', {
    transferId: transfer.id,
    statusCode: installResponse.statusCode,
    taskId: taskId ?? null,
    response: installBody,
  });
  if (installResponse.statusCode >= 400 || isNonZeroError(installBody.error) || String(installBody.status || '').toLowerCase() === 'error') {
    throw new Error(installBody.message || installBody.detail || `PS4 rejected the install request (${installResponse.statusCode}).`);
  }

  // Older RPI builds accepted the request without returning a task. Keep the
  // item useful rather than treating a successful, task-less response as a failure.
  if (taskId === undefined || taskId === null || taskId === '') {
    transfer.status = 'completed';
    transfer.percent = 100;
    transfer.phase = 'Accepted by PS4';
    transfer.finishedAt = new Date().toISOString();
    transfer.lastUpdated = transfer.finishedAt;
    log('info', 'PS4 accepted task-less install request', { transferId: transfer.id, fileName: transfer.fileName });
    return;
  }

  transfer.taskId = taskId;
  log('info', 'Monitoring PS4 install task', { transferId: transfer.id, taskId });
  transfer.status = 'downloading';
  transfer.phase = 'Preparing';
  transfer.lastUpdated = new Date().toISOString();
  let consecutiveErrors = 0;

  while (transfer.status === 'downloading') {
    await wait(config.pollIntervalSec * 1000);
    if (transfer.status === 'cancelled') return;
    try {
      const progressResponse = await requestPs4('POST', '/api/get_task_progress', { task_id: taskId });
      if (progressResponse.statusCode >= 500) throw new Error(`PS4 returned HTTP ${progressResponse.statusCode}.`);
      const done = remoteProgress(transfer, progressResponse.body);
      consecutiveErrors = 0;
      if (done) {
        transfer.status = 'completed';
        transfer.percent = 100;
        transfer.phase = 'Complete';
        transfer.finishedAt = new Date().toISOString();
        transfer.lastUpdated = transfer.finishedAt;
        log('info', 'PS4 package transfer completed', { transferId: transfer.id, taskId, durationMs: Date.now() - Date.parse(transfer.startedAt) });
      }
    } catch (error) {
      consecutiveErrors += 1;
      log('warn', 'PS4 progress check failed', {
        transferId: transfer.id,
        taskId,
        attempt: consecutiveErrors,
        error: error.message,
        code: error.code,
      });
      transfer.phase = consecutiveErrors >= 4 ? 'Waiting for PS4…' : 'Checking progress…';
      transfer.error = consecutiveErrors >= 8 ? error.message : null;
      transfer.lastUpdated = new Date().toISOString();
      // The RPI can stop answering while it is streaming a large package. Give
      // it a generous window before failing a transfer that may still be active.
      if (consecutiveErrors >= 8) {
        transfer.status = 'failed';
        transfer.finishedAt = new Date().toISOString();
        throw error;
      }
    }
  }
}

function queueTransferProcessing(request) {
  if (activeTransferId) {
    log('debug', 'Transfer queued behind active task', { activeTransferId });
    return;
  }
  const next = transfers.find((item) => item.status === 'queued');
  if (!next) return;
  activeTransferId = next.id;
  log('info', 'Transfer worker picked up task', { transferId: next.id, fileName: next.fileName });
  runTransfer(next, request)
    .catch((error) => {
      log('error', 'PS4 package transfer failed', { transferId: next.id, fileName: next.fileName, code: error.code, error: error.message });
      if (next.status !== 'cancelled') {
        next.status = 'failed';
        next.phase = 'Failed';
        next.error = error.message || 'Transfer failed.';
        next.finishedAt = new Date().toISOString();
        next.lastUpdated = next.finishedAt;
      }
    })
    .finally(() => {
      log('debug', 'Transfer worker released task', { transferId: next.id, status: next.status });
      activeTransferId = null;
      setTimeout(() => queueTransferProcessing(request), 100);
    });
}

function publicTransfer(transfer) {
  const copy = { ...transfer };
  delete copy.packageUrl;
  return copy;
}

function findTransfer(id) {
  return transfers.find((item) => item.id === id);
}

async function cancelTransfer(transfer) {
  if (!transfer || ['completed', 'failed', 'cancelled'].includes(transfer.status)) return;
  log('info', 'Cancelling PS4 package transfer', { transferId: transfer.id, taskId: transfer.taskId, fileName: transfer.fileName });
  transfer.status = 'cancelled';
  transfer.phase = 'Cancelled';
  transfer.finishedAt = new Date().toISOString();
  transfer.lastUpdated = transfer.finishedAt;
  if (transfer.taskId) {
    try {
      await requestPs4('POST', '/api/stop_task', { task_id: transfer.taskId });
    } catch {
      // The local state still reflects the user's cancellation when RPI is offline.
    }
  }
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader || !rangeHeader.startsWith('bytes=')) return null;
  const first = rangeHeader.slice(6).split(',')[0].trim();
  const match = first.match(/^(\d*)-(\d*)$/);
  if (!match) return { invalid: true };
  let start = match[1] ? Number.parseInt(match[1], 10) : NaN;
  let end = match[2] ? Number.parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start)) {
    const suffixLength = Number.parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= size) return { invalid: true };
  end = Math.min(end, size - 1);
  return { start, end };
}

async function servePackage(request, response, id) {
  let packagePath;
  try {
    packagePath = pathForId(id).absolute;
  } catch {
    response.writeHead(404);
    response.end('Package not found');
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(packagePath);
    if (!stat.isFile() || !packagePath.toLowerCase().endsWith('.pkg')) throw new Error('not a package');
  } catch {
    response.writeHead(404);
    response.end('Package not found');
    return;
  }

  const range = parseRange(request.headers.range, stat.size);
  if (range && range.invalid) {
    response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    response.end();
    return;
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : stat.size - 1;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/octet-stream',
    'Content-Length': end - start + 1,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(packagePath))}`,
  };
  if (range) {
    headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    response.writeHead(206, headers);
  } else {
    response.writeHead(200, headers);
  }
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  const stream = fs.createReadStream(packagePath, { start, end });
  request.on('aborted', () => stream.destroy());
  stream.on('error', () => {
    if (!response.headersSent) response.writeHead(500);
    response.destroy();
  });
  stream.pipe(response);
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function sendError(response, statusCode, message, details) {
  sendJson(response, statusCode, { error: message, ...(details ? { details } : {}) });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    let length = 0;
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      length += Buffer.byteLength(chunk);
      if (length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function filteredFiles(url) {
  const search = (url.searchParams.get('search') || '').trim().toLowerCase();
  const kind = (url.searchParams.get('kind') || 'all').toLowerCase();
  const sort = url.searchParams.get('sort') || 'name';
  let result = scanState.files.filter((file) => {
    const matchesSearch = !search || `${file.name} ${file.relativePath} ${file.titleId}`.toLowerCase().includes(search);
    const matchesKind = kind === 'all' || file.kind.toLowerCase() === kind;
    return matchesSearch && matchesKind;
  });
  result = [...result].sort((a, b) => {
    if (sort === 'size') return b.size - a.size;
    if (sort === 'newest') return Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt);
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });
  });
  return result;
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;
  if (request.method === 'GET' && pathname === '/api/bootstrap') {
    if (!scanState.lastScanAt || shouldAutoScan()) await scanLibrary();
    return sendJson(response, 200, {
      settings: publicConfig(request),
      scan: scanSummary(),
      files: filteredFiles(url),
      transfers: transfers.slice(0, MAX_TRANSFERS).map(publicTransfer),
    });
  }

  if (request.method === 'GET' && pathname === '/api/settings') {
    return sendJson(response, 200, { settings: publicConfig(request), scan: scanSummary() });
  }

  if (request.method === 'GET' && pathname === '/api/status') {
    return sendJson(response, 200, {
      settings: publicConfig(request),
      scan: scanSummary(),
      activeTransferId,
      transferCount: transfers.length,
    });
  }

  if (request.method === 'GET' && pathname === '/api/files') {
    if (!scanState.lastScanAt || shouldAutoScan()) await scanLibrary();
    return sendJson(response, 200, { files: filteredFiles(url), scan: scanSummary() });
  }

  if (request.method === 'POST' && pathname === '/api/scan') {
    await scanLibrary();
    return sendJson(response, 200, { files: filteredFiles(url), scan: scanSummary() });
  }

  if ((request.method === 'PUT' || request.method === 'PATCH') && pathname === '/api/settings') {
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendError(response, 400, error.message);
    }
    try {
      const candidate = { ...config };
      if (Object.prototype.hasOwnProperty.call(body, 'libraryPath')) {
        const libraryPath = String(body.libraryPath || '').trim();
        if (!libraryPath) throw new Error('Library folder cannot be empty.');
        candidate.libraryPath = path.resolve(libraryPath);
      }
      if (Object.prototype.hasOwnProperty.call(body, 'autoScan')) candidate.autoScan = Boolean(body.autoScan);
      if (Object.prototype.hasOwnProperty.call(body, 'scanIntervalSec')) candidate.scanIntervalSec = body.scanIntervalSec;
      if (Object.prototype.hasOwnProperty.call(body, 'ps4Host')) candidate.ps4Host = String(body.ps4Host || '').trim();
      if (Object.prototype.hasOwnProperty.call(body, 'ps4Port')) candidate.ps4Port = body.ps4Port;
      if (Object.prototype.hasOwnProperty.call(body, 'publicBaseUrl')) candidate.publicBaseUrl = normalizeBaseUrl(body.publicBaseUrl, true);
      if (Object.prototype.hasOwnProperty.call(body, 'requestTimeoutSec')) candidate.requestTimeoutSec = body.requestTimeoutSec;
      if (Object.prototype.hasOwnProperty.call(body, 'pollIntervalSec')) candidate.pollIntervalSec = body.pollIntervalSec;
      config = sanitizeConfig(candidate);
      await saveConfig();
      log('info', 'Settings updated', {
        libraryPath: config.libraryPath,
        autoScan: config.autoScan,
        scanIntervalSec: config.scanIntervalSec,
        ps4Host: config.ps4Host,
        ps4Port: config.ps4Port,
        publicBaseUrl: config.publicBaseUrl || '(auto-detect)',
        requestTimeoutSec: config.requestTimeoutSec,
        pollIntervalSec: config.pollIntervalSec,
      });
      startScanTimer();
      await scanLibrary();
      return sendJson(response, 200, { settings: publicConfig(request), scan: scanSummary() });
    } catch (error) {
      return sendError(response, 422, error.message || 'Settings could not be saved.');
    }
  }

  if (request.method === 'POST' && (pathname === '/api/connection/test' || pathname === '/api/ps4/test')) {
    log('info', 'PS4 connection test requested');
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendError(response, 400, error.message);
    }
    try {
      // Accept the values currently in the form so users can test a new PS4
      // address before saving it. Other PS4 requests continue using the
      // persisted settings.
      const connectionOverrides = {
        ...(Object.prototype.hasOwnProperty.call(body, 'ps4Host') ? { ps4Host: body.ps4Host } : {}),
        ...(Object.prototype.hasOwnProperty.call(body, 'ps4Port') ? { ps4Port: body.ps4Port } : {}),
      };
      log('info', 'Testing PS4 Remote Package Installer endpoint', {
        host: connectionOverrides.ps4Host ?? config.ps4Host,
        port: connectionOverrides.ps4Port ?? config.ps4Port,
      });
      const result = await requestPs4('POST', '/api/is_exists', { title_id: 'CUSA00000' }, connectionOverrides);
      const reachable = result.statusCode > 0 && result.statusCode < 500;
      log(reachable ? 'info' : 'warn', 'PS4 connection test completed', {
        reachable,
        statusCode: result.statusCode,
        response: result.body,
      });
      return sendJson(response, reachable ? 200 : 502, {
        ok: reachable,
        statusCode: result.statusCode,
        response: result.body,
        message: reachable ? 'PS4 Remote Package Installer responded.' : 'The PS4 did not accept the request.',
      });
    } catch (error) {
      log('error', 'PS4 connection test failed', { code: error.code, error: error.message });
      return sendError(response, 502, error.message || 'The PS4 could not be reached.');
    }
  }

  if (request.method === 'GET' && pathname === '/api/transfers') {
    return sendJson(response, 200, { transfers: transfers.slice(0, MAX_TRANSFERS).map(publicTransfer) });
  }

  if (request.method === 'POST' && pathname === '/api/transfers') {
    if (!config.ps4Host) return sendError(response, 422, 'Set the PS4 IP address in Settings before starting an install.');
    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      return sendError(response, 400, error.message);
    }
    const ids = Array.isArray(body.fileIds) ? body.fileIds : Array.isArray(body.ids) ? body.ids : [];
    const uniqueIds = [...new Set(ids.map((id) => String(id)).filter(Boolean))].slice(0, 50);
    if (!uniqueIds.length) return sendError(response, 400, 'Select at least one PKG file.');
    const invalid = [];
    const valid = [];
    for (const id of uniqueIds) {
      try {
        const { absolute, relativePath } = pathForId(id);
        const stat = await fsp.stat(absolute);
        if (!stat.isFile() || !absolute.toLowerCase().endsWith('.pkg')) throw new Error('not a PKG');
        valid.push({ id, absolute, relativePath, stat });
      } catch {
        invalid.push(id);
      }
    }
    if (invalid.length) return sendError(response, 404, 'One or more selected PKG files are no longer available.', { invalid });

    // RPI expects split packages (_0.pkg, _1.pkg, …) in one consecutive
    // packages array. Selecting one part automatically picks up its siblings
    // from the current scan, while unrelated games remain separate tasks.
    const expanded = new Map(valid.map((entry) => [entry.id, entry]));
    for (const entry of valid) {
      const part = multipartInfo(entry.relativePath);
      if (!part) continue;
      for (const candidate of scanState.files) {
        const candidatePart = multipartInfo(candidate.relativePath);
        if (!candidatePart || candidatePart.key !== part.key || expanded.has(candidate.id)) continue;
        try {
          const { absolute, relativePath } = pathForId(candidate.id);
          const stat = await fsp.stat(absolute);
          if (stat.isFile() && absolute.toLowerCase().endsWith('.pkg')) expanded.set(candidate.id, { id: candidate.id, absolute, relativePath, stat });
        } catch {
          // A file that disappeared during a scan is simply omitted; the
          // explicitly selected entry was already validated above.
        }
      }
    }

    const groups = new Map();
    for (const entry of expanded.values()) {
      const part = multipartInfo(entry.relativePath);
      const groupKey = part ? `parts:${part.key}` : `single:${entry.id}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { entries: [], multipart: Boolean(part) });
      groups.get(groupKey).entries.push({ ...entry, part });
    }
    const created = [...groups.values()].map((group) => {
      group.entries.sort((a, b) => (a.part ? a.part.index : 0) - (b.part ? b.part.index : 0));
      const first = group.entries[0];
      const fileIds = group.entries.map((entry) => entry.id);
      const size = group.entries.reduce((total, entry) => total + entry.stat.size, 0);
      const firstName = path.basename(first.relativePath);
      const fileName = group.multipart && group.entries.length > 1
        ? `${firstName} + ${group.entries.length - 1} part${group.entries.length === 2 ? '' : 's'}`
        : firstName;
      return {
        id: crypto.randomUUID(),
        fileId: fileIds[0],
        fileIds,
        packageCount: fileIds.length,
        fileName,
        relativePath: first.relativePath.split(path.sep).join('/'),
        size,
        totalBytes: size,
        bytesTransferred: 0,
        percent: 0,
        status: 'queued',
        phase: 'Waiting in queue',
        taskId: null,
        error: null,
        remote: null,
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        lastUpdated: new Date().toISOString(),
      };
    });
    transfers.unshift(...created);
    if (transfers.length > MAX_TRANSFERS) transfers.splice(MAX_TRANSFERS);
    log('info', 'Install request queued', {
      transferIds: created.map((transfer) => transfer.id),
      packageCount: created.reduce((count, transfer) => count + (transfer.packageCount || 1), 0),
      ps4Host: config.ps4Host,
      ps4Port: config.ps4Port,
      publicBaseUrl: getPublicBaseUrl(request),
    });
    queueTransferProcessing(request);
    return sendJson(response, 202, { transfers: created.map(publicTransfer), queue: transfers.slice(0, MAX_TRANSFERS).map(publicTransfer) });
  }

  const transferMatch = pathname.match(/^\/api\/transfers\/([^/]+)(?:\/(cancel|pause|resume))?$/);
  if (transferMatch && request.method === 'POST') {
    const transfer = findTransfer(transferMatch[1]);
    if (!transfer) return sendError(response, 404, 'Transfer not found.');
    const action = transferMatch[2] || 'cancel';
    if (action === 'cancel') {
      await cancelTransfer(transfer);
      return sendJson(response, 200, { transfer: publicTransfer(transfer) });
    }
    if (!transfer.taskId) return sendError(response, 409, 'This transfer has not reached the PS4 yet.');
    const endpoint = action === 'pause' ? '/api/pause_task' : '/api/start_task';
    try {
      const result = await requestPs4('POST', endpoint, { task_id: transfer.taskId });
      if (result.statusCode >= 400) return sendError(response, 502, `PS4 returned HTTP ${result.statusCode}.`);
      transfer.phase = action === 'pause' ? 'Paused' : 'Downloading';
      return sendJson(response, 200, { transfer: publicTransfer(transfer), response: result.body });
    } catch (error) {
      return sendError(response, 502, error.message);
    }
  }

  if (request.method === 'DELETE' && transferMatch) {
    const transfer = findTransfer(transferMatch[1]);
    if (!transfer) return sendError(response, 404, 'Transfer not found.');
    await cancelTransfer(transfer);
    return sendJson(response, 200, { transfer: publicTransfer(transfer) });
  }

  if (request.method === 'DELETE' && pathname === '/api/transfers') {
    for (const transfer of transfers) {
      if (!['completed', 'failed', 'cancelled'].includes(transfer.status)) await cancelTransfer(transfer);
    }
    transfers.splice(0, transfers.length);
    return sendJson(response, 200, { transfers: [] });
  }

  return sendError(response, 404, 'API route not found.');
}

async function serveStatic(request, response, pathname) {
  const target = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'styles.css'].includes(target)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  const filePath = path.join(PUBLIC_DIR, target);
  try {
    const stat = await fsp.stat(filePath);
    const contentType = target.endsWith('.css') ? 'text/css; charset=utf-8' : target.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8';
    response.writeHead(200, { 'Content-Type': contentType, 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    if (request.method === 'HEAD') return response.end();
    fs.createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

const server = http.createServer(async (request, response) => {
  const requestStartedAt = Date.now();
  const requestPath = String(request.url || '/').split('?')[0];
  response.on('finish', () => {
    const isPollingRoute = /^\/api\/(files|transfers|settings|status)$/.test(requestPath);
    const isApiRoute = requestPath.startsWith('/api/');
    const statusCode = response.statusCode || 0;
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : isPollingRoute ? 'debug' : isApiRoute ? 'info' : 'debug';
    log(level, 'HTTP request completed', {
      method: request.method,
      path: requestPath,
      statusCode,
      durationMs: Date.now() - requestStartedAt,
    });
  });
  request.on('aborted', () => log('warn', 'HTTP request aborted by client', { method: request.method, path: requestPath }));
  try {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { Allow: 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS' });
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/healthz') return sendJson(response, 200, { ok: true, service: 'ps4pkg-link' });
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    const packageMatch = url.pathname.match(/^\/pkg\/([^/]+)$/);
    if (packageMatch && (request.method === 'GET' || request.method === 'HEAD')) return await servePackage(request, response, decodeURIComponent(packageMatch[1]));
    if (request.method === 'GET' || request.method === 'HEAD') return await serveStatic(request, response, url.pathname);
    response.writeHead(405, { Allow: 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS' });
    response.end('Method not allowed');
  } catch (error) {
    if (!response.headersSent) sendError(response, 500, error.message || 'Unexpected server error.');
    else response.destroy();
  }
});

server.on('error', (error) => {
  log('error', 'Web server error', { code: error.code, error: error.message });
  process.exitCode = 1;
});

function startServer() {
  server.listen(PORT, HOST, () => {
    log('info', 'PKG Link server started', {
      address: `http://${HOST}:${PORT}`,
      packageLibrary: config.libraryPath,
      dataDirectory: DATA_DIR,
      logLevel: LOG_LEVEL,
      ps4HostConfigured: Boolean(config.ps4Host),
      ps4Port: config.ps4Port,
      publicBaseUrl: config.publicBaseUrl || '(auto-detect)',
    });
    startScanTimer();
    scanLibrary().catch((error) => log('error', 'Initial library scan crashed', { error: error.message, code: error.code }));
  });
}

function shutdown() {
  if (scanTimer) clearInterval(scanTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

if (require.main === module) {
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  startServer();
}

module.exports = {
  idForRelativePath,
  relativePathForId,
  packageKind,
  multipartInfo,
  parseRange,
  sanitizeConfig,
  normalizeBaseUrl,
  createDirectInstallPayload,
};
