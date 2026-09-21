import { io } from 'socket.io-client';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const accessToken = process.env.ACCESS_TOKEN;
const deviceId = process.env.DEVICE_ID;
const baseUrl = (
  process.env.API_BASE_URL || 'http://localhost:3000'
).replace(/\/+$/, '');

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!accessToken || !deviceId || !uuidPattern.test(deviceId)) {
  console.error('Set ACCESS_TOKEN and a valid DEVICE_ID first.');
  process.exit(1);
}

// Always store relative to this script, regardless of terminal location.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const inboxDirectory = path.join(
  scriptDirectory,
  '.test-inbox',
  deviceId,
);

await mkdir(inboxDirectory, { recursive: true });

console.log('Local inbox:', inboxDirectory);

let ready = false;
let syncing = false;
let syncRequested = false;
let stopped = false;

const socket = io(`${baseUrl}/realtime`, {
  transports: ['websocket'],
  autoConnect: false,
  auth: {
    token: accessToken,
    deviceId,
  },
});

async function apiRequest(endpoint, method = 'GET') {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 401) {
    stop();
    throw new Error(
      'Access token rejected or expired. Set a fresh token and restart.',
    );
  }

  if (!response.ok) {
    throw new Error(`${method} ${endpoint}: HTTP ${response.status}`);
  }

  return response.json();
}

async function saveMessage(message) {
  if (
    !uuidPattern.test(message.id) ||
    typeof message.envelope?.ciphertext !== 'string'
  ) {
    throw new Error('Invalid message received from inbox');
  }

  // Delivery status belongs to the server; keep the local envelope stable.
  const { deliveredAt, ...envelope } = message.envelope;
  const storedMessage = { ...message, envelope };
  const contents = `${JSON.stringify(storedMessage, null, 2)}\n`;

  const filename = path.join(inboxDirectory, `${message.id}.json`);

  try {
    const existingContents = await readFile(filename, 'utf8');

    if (existingContents === contents) {
      return;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  // Finish and flush the write before publishing the final file.
  // If this fails, no acknowledgement is sent.
  const temporaryFilename = `${filename}.tmp`;

  await writeFile(temporaryFilename, contents, {
    encoding: 'utf8',
    flush: true,
  });

  await rename(temporaryFilename, filename);

  console.log(`Saved message ${message.id}, sequence ${message.sequence}`);
}

async function synchronizeInbox() {
  // For this development client, rescan from the beginning each time.
  // Existing local files are deduplicated by message ID and contents.
  let afterSequence = '0';

  while (ready && !stopped) {
    const params = new URLSearchParams({
      afterSequence,
      limit: '50',
    });

    const page = await apiRequest(
      `/devices/${deviceId}/messages?${params.toString()}`,
    );

    if (page.deviceId !== deviceId || !Array.isArray(page.messages)) {
      throw new Error('Unexpected inbox response');
    }

    if (page.messages.length === 0) {
      return;
    }

    for (const message of page.messages) {
      if (!ready || stopped) {
        return;
      }

      await saveMessage(message);

      if (!message.envelope.deliveredAt) {
        await apiRequest(
          `/devices/${deviceId}/messages/${message.id}/ack`,
          'POST',
        );

        console.log(`Acknowledged ${message.id}`);
      }
    }

    const next = page.nextAfterSequence;

    if (
      typeof next !== 'string' ||
      !/^\d+$/.test(next) ||
      BigInt(next) <= BigInt(afterSequence)
    ) {
      throw new Error('Inbox pagination did not advance');
    }

    afterSequence = next;
  }
}

async function requestSync() {
  syncRequested = true;

  if (syncing || !ready || stopped) {
    return;
  }

  syncing = true;

  try {
    do {
      syncRequested = false;
      await synchronizeInbox();
    } while (syncRequested && ready && !stopped);
  } catch (error) {
    console.error('Inbox sync failed:', error.message);
    // The periodic check or next connection retries the operation.
  } finally {
    syncing = false;
  }
}

socket.on('connect', () => {
  console.log('Socket connected:', socket.id);
});

socket.on('connection.ready', (payload) => {
  if (payload.deviceId !== deviceId) {
    console.error('Unexpected device in connection.ready');
    stop();
    return;
  }

  ready = true;
  console.log('Authenticated. Synchronizing inbox...');
  void requestSync();
});

socket.on('message.available', (payload) => {
  console.log('Message notification:', payload.messageId);
  void requestSync();
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error.message);
});

socket.on('disconnect', (reason) => {
  ready = false;
  console.log('Disconnected:', reason);

  if (reason === 'io server disconnect') {
    console.log(
      'Server ended the connection. Check its log; refresh your token if expired.',
    );
    stop();
  }
});

const pollingTimer = setInterval(() => {
  if (ready) {
    void requestSync();
  }
}, 30_000);

function stop() {
  stopped = true;
  ready = false;
  clearInterval(pollingTimer);
  socket.disconnect();
}

process.on('SIGINT', () => {
  console.log('\nStopping inbox client...');
  stop();
});

socket.connect();