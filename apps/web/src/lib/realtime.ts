import { io } from 'socket.io-client';

type RealtimeOptions = {
  deviceId: string;
  getAccessToken: () => Promise<string>;
  onStatus: (status: string) => void;
  onSyncNeeded: () => void;
};

export function startRealtime(options: RealtimeOptions): () => void {
  const socket = io('/realtime', {
    path: '/socket.io',
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
    forceNew: true,
    timeout: 10_000,
  });

  let stopped = false;
  let connecting = false;
  let ready = false;

  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;

  function clearReadyTimer() {
    if (readyTimer !== undefined) {
      clearTimeout(readyTimer);
      readyTimer = undefined;
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer !== undefined) return;

    ready = false;
    clearReadyTimer();
    options.onStatus('Disconnected — retrying…');

    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, 5_000);

    socket.disconnect();
  }

  async function connect() {
    if (stopped || connecting) return;

    connecting = true;
    options.onStatus('Connecting…');

    try {
      const token = await options.getAccessToken();

      if (stopped) return;

      socket.auth = {
        token,
        deviceId: options.deviceId,
      };

      // A socket connection alone does not confirm device authentication.
      readyTimer = setTimeout(scheduleRetry, 12_000);
      socket.connect();
    } catch {
      scheduleRetry();
    } finally {
      connecting = false;
    }
  }

  socket.on('connection.ready', (payload: { deviceId?: string }) => {
    if (stopped) return;

    if (payload?.deviceId !== options.deviceId) {
      scheduleRetry();
      return;
    }

    clearReadyTimer();
    ready = true;
    options.onStatus('Connected');
    options.onSyncNeeded();
  });

  socket.on('message.available', () => {
    if (!stopped && ready) {
      options.onSyncNeeded();
    }
  });

  socket.on('disconnect', scheduleRetry);
  socket.on('connect_error', scheduleRetry);

  void connect();

  return () => {
    stopped = true;
    ready = false;

    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
    }

    clearReadyTimer();
    socket.removeAllListeners();
    socket.disconnect();
  };
}