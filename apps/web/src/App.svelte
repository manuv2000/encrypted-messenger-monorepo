<script lang="ts">
  import { api, ApiError } from './lib/api';
  import type { ApiOptions } from './lib/api';
  import {
  readInboxMessages,
  saveInboxMessages,
} from './lib/inbox';

import type {
  InboxMessage,
  InboxPage,
} from './lib/inbox';

import type {
  Conversation,
  ConversationsResponse,
} from './lib/conversations';

import { untrack } from 'svelte';
import { startRealtime } from './lib/realtime';
import ConversationInbox from './lib/ConversationInbox.svelte';
import TestMessageSender from './lib/TestMessageSender.svelte';

  type User = {
    id: string;
    email: string;
    displayName: string | null;
  };

  type TokenResponse = {
    accessToken: string;
    refreshToken: string;
  };

  type Session = TokenResponse & {
    user: User;
  };

  type Device = {
  id: string;
  name: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

let browserDevice = $state<Device | null>(null);

  let email = $state('');
  let password = $state('');
  let session = $state<Session | null>(null);
  let busy = $state(false);
  let errorMessage = $state('');
  let notice = $state('');
  let inboxMessages = $state<InboxMessage[]>([]);
  let inboxLoaded = $state(false);

  // Concurrent requests share one refresh operation.
  let refreshInFlight: Promise<string> | null = null;

  let realtimeStatus = $state('Disconnected');
  let serverConversations = $state<Conversation[]>([]);
  let conversationListError = $state('');

const realtimeIdentity = $derived(
  session && browserDevice
    ? `${session.user.id}:${browserDevice.id}`
    : '',
);

$effect(() => {
  const identity = realtimeIdentity;

  if (!identity) {
    realtimeStatus = 'Disconnected';
    return;
  }

  const [userId, deviceId] = identity.split(':');

  if (!userId || !deviceId) return;

  return untrack(() => {
    let active = true;
    let syncPending = false;

    function isCurrentDevice() {
      return (
        active &&
        session?.user.id === userId &&
        browserDevice?.id === deviceId
      );
    }

    function requestSync() {
      if (isCurrentDevice()) {
        syncPending = true;
      }
    }

    const stopRealtime = startRealtime({
      deviceId,

      getAccessToken: async () => {
        if (!isCurrentDevice()) {
          throw new Error('The active device changed.');
        }

        // Avoid competing with login, logout, or an existing sync.
        if (busy) {
          throw new Error('Another operation is in progress.');
        }

        await authenticatedRequest<User>('/auth/me');

        if (!isCurrentDevice() || !session) {
          throw new Error('The session is unavailable.');
        }

        return session.accessToken;
      },

      onStatus: (status) => {
        if (isCurrentDevice()) {
          realtimeStatus = status;
        }
      },

      onSyncNeeded: requestSync,
    });

    // Keep notifications queued while another operation is running.
    // Multiple notifications can be handled by one inbox sync.
    const queueTimer = setInterval(() => {
      if (!isCurrentDevice() || !syncPending || busy) return;

      syncPending = false;
      void syncInbox();
    }, 500);

    // Periodic catch-up also covers a missed notification or failed sync.
    const catchUpTimer = setInterval(requestSync, 30_000);

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        requestSync();
      }
    }

    window.addEventListener('online', requestSync);
    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange,
    );

    return () => {
      active = false;
      stopRealtime();

      clearInterval(queueTimer);
      clearInterval(catchUpTimer);

      window.removeEventListener('online', requestSync);
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange,
      );
    };
  });
});
  
  function describeError(error: unknown): string {
    return error instanceof Error
      ? error.message
      : 'Something went wrong. Please try again.';
  }

  function clearSession() {
    session = null;
    browserDevice = null;
    password = '';
    inboxMessages = [];
    inboxLoaded = false;
  }

  async function refreshAccessToken(): Promise<string> {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    const currentSession = session;

    if (!currentSession) {
      throw new Error('Please sign in again.');
    }

    const operation = (async () => {
      try {
        const tokens = await api<TokenResponse>('/auth/refresh', {
          method: 'POST',
          body: {
            refreshToken: currentSession.refreshToken,
          },
        });

        // Do not restore a session that changed while waiting.
        if (session !== currentSession) {
          throw new Error('Your session changed. Please try again.');
        }

        session = {
          ...currentSession,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        };

        return tokens.accessToken;
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          session === currentSession
        ) {
          clearSession();
          throw new Error('Your session has expired. Please sign in again.');
        }

        throw error;
      }
    })();

    refreshInFlight = operation;

    try {
      return await operation;
    } finally {
      if (refreshInFlight === operation) {
        refreshInFlight = null;
      }
    }
  }

  async function authenticatedRequest<T>(
  path: string,
  options: Omit<ApiOptions, 'token'> = {},
): Promise<T> {
  const currentSession = session;

  if (!currentSession) {
    throw new Error('Please sign in again.');
  }

  const attemptedToken = currentSession.accessToken;

  try {
    return await api<T>(path, {
      ...options,
      token: attemptedToken,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) {
      throw error;
    }
  }

  if (!session || session.user.id !== currentSession.user.id) {
    throw new Error('Your session changed. Please sign in again.');
  }

  const token =
    session.accessToken !== attemptedToken
      ? session.accessToken
      : await refreshAccessToken();

  try {
    return await api<T>(path, {
      ...options,
      token,
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      session?.accessToken === token
    ) {
      clearSession();
      throw new Error(
        'Your session could not be verified. Please sign in again.',
      );
    }

    throw error;
  }
}

  async function signIn(event: SubmitEvent) {
  event.preventDefault();

  if (busy) return;

  busy = true;
  errorMessage = '';
  notice = '';
  browserDevice = null;

  inboxMessages = [];
  inboxLoaded = false;

  try {
    const result = await api<Session>('/auth/login', {
      method: 'POST',
      body: {
        email: email.trim(),
        password,
      },
    });

    session = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };

    password = '';

    browserDevice = await prepareBrowserDevice();
    notice = 'You are signed in. This browser is registered.';
  } catch (error) {
    errorMessage = session
      ? `Device setup failed: ${describeError(error)}`
      : describeError(error);
  } finally {
    busy = false;
  }
}

  async function checkAccount() {
    if (!session || busy) return;

    busy = true;
    errorMessage = '';
    notice = '';

    try {
      const user = await authenticatedRequest<User>('/auth/me');

      if (session) {
        session = { ...session, user };
        notice = 'Account verified with the server.';
      }
    } catch (error) {
      errorMessage = describeError(error);
    } finally {
      busy = false;
    }
  }

  async function signOut() {
    if (!session || busy) return;

    busy = true;
    errorMessage = '';
    notice = '';

    try {
      // If rotation is underway, logout must use the replacement token.
      if (refreshInFlight) {
        await refreshInFlight;
      }

      if (session) {
        await api<void>('/auth/logout', {
          method: 'POST',
          body: {
            refreshToken: session.refreshToken,
          },
        });
      }

      clearSession();
      notice = 'You have signed out.';
    } catch (error) {
      errorMessage = describeError(error);
    } finally {
      busy = false;
    }
  }

  async function prepareBrowserDevice(): Promise<Device> {
  if (!session) {
    throw new Error('Please sign in again.');
  }

  const userId = session.user.id;
  const storageKey = `messenger:device:v1:${userId}`;

  if (!navigator.locks) {
    throw new Error(
      'Device setup requires localhost or HTTPS in a supported browser.',
    );
  }

  return navigator.locks.request(storageKey, async () => {
    if (!session || session.user.id !== userId) {
      throw new Error('Your session changed. Please sign in again.');
    }

    // Check local storage before creating a server-side device.
    const probeKey = `${storageKey}:storage-check`;

    try {
      localStorage.setItem(probeKey, '1');
      localStorage.removeItem(probeKey);
    } catch {
      throw new Error(
        'Browser storage is unavailable. Allow site storage and try again.',
      );
    }

    const savedDeviceId = localStorage.getItem(storageKey);

    if (savedDeviceId) {
      const devices =
        await authenticatedRequest<Device[]>('/devices');

      const existingDevice = devices.find(
        (device) => device.id === savedDeviceId,
      );

      if (existingDevice) {
        return existingDevice;
      }

      // The saved device was deleted or revoked.
      localStorage.removeItem(storageKey);
    }

    const device = await authenticatedRequest<Device>('/devices', {
      method: 'POST',
      body: {
        name: 'Web browser',
      },
    });

    try {
      localStorage.setItem(storageKey, device.id);
    } catch {
      throw new Error(
        `Device ${device.id} was registered, but its ID could not be saved locally.`,
      );
    }

    return device;
  });
}

async function retryDeviceSetup() {
  if (!session || busy) return;

  busy = true;
  errorMessage = '';
  notice = '';

  try {
    browserDevice = await prepareBrowserDevice();
    notice = 'This browser is registered.';
  } catch (error) {
    errorMessage = describeError(error);
  } finally {
    busy = false;
  }
}

async function sendTestMessage(
  conversationId: string,
  recipientDeviceId: string,
  clientMessageId: string,
): Promise<{ id: string }> {
  if (!session || !browserDevice) {
    throw new Error('Sign in and finish device setup first.');
  }

  if (busy) {
    throw new Error('Another operation is running. Please try again.');
  }

  if (recipientDeviceId === browserDevice.id) {
    throw new Error('Choose the other account’s browser device.');
  }

  const senderDeviceId = browserDevice.id;

  busy = true;

  try {
    return await authenticatedRequest<{ id: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: 'POST',
        body: {
          senderDeviceId,
          clientMessageId,
          envelopes: [
            {
              recipientDeviceId,
              envelopeType: 'PREKEY',
              protocolVersion: 1,
              ciphertext: 'VGVzdCBlbmNyeXB0ZWQgcGF5bG9hZA==',
            },
          ],
        },
      },
    );
  } finally {
    busy = false;
  }
}

async function syncInbox() {
  if (!session || !browserDevice || busy) return;

  const userId = session.user.id;
  const deviceId = browserDevice.id;

  busy = true;
  errorMessage = '';
  notice = '';

  function assertCurrentAccount() {
    if (
      session?.user.id !== userId ||
      browserDevice?.id !== deviceId
    ) {
      throw new Error('The active account or device changed.');
    }
  }

  try {
    const savedMessages = await readInboxMessages(userId, deviceId);

    assertCurrentAccount();
    inboxMessages = savedMessages;
    inboxLoaded = true;

    // Rescan from zero for this small development inbox.
    // This also retries acknowledgements that previously failed.
    let afterSequence = '0';

    while (true) {
      assertCurrentAccount();

      const page = await authenticatedRequest<InboxPage>(
        `/devices/${deviceId}/messages` +
          `?afterSequence=${afterSequence}&limit=50`,
      );

      assertCurrentAccount();

      if (
        page.deviceId !== deviceId ||
        !Array.isArray(page.messages)
      ) {
        throw new Error('The server returned an unexpected inbox response.');
      }

      if (page.messages.length === 0) {
        break;
      }

      let previousSequence = BigInt(afterSequence);

      for (const message of page.messages) {
        if (
          typeof message.id !== 'string' ||
          typeof message.sequence !== 'string' ||
          !/^[1-9]\d*$/.test(message.sequence) ||
          typeof message.envelope?.ciphertext !== 'string'
        ) {
          throw new Error('The server returned an invalid message.');
        }

        const sequence = BigInt(message.sequence);

        if (sequence <= previousSequence) {
          throw new Error('Messages were returned in an unexpected order.');
        }

        previousSequence = sequence;
      }

      if (page.nextAfterSequence !== previousSequence.toString()) {
        throw new Error('The server returned an invalid inbox cursor.');
      }

      // Commit the full page locally before acknowledging any messages.
      await saveInboxMessages(userId, deviceId, page.messages);

      assertCurrentAccount();

      const updatedMessages = await readInboxMessages(userId, deviceId);

      assertCurrentAccount();
      inboxMessages = updatedMessages;

      for (const message of page.messages) {
        assertCurrentAccount();

        if (!message.envelope.deliveredAt) {
          await authenticatedRequest<unknown>(
            `/devices/${deviceId}/messages/${message.id}/ack`,
            { method: 'POST' },
          );
        }
      }

      afterSequence = page.nextAfterSequence;
    }

    notice = `Inbox synchronized. ${inboxMessages.length} message(s) saved locally.`;
  } catch (error) {
    errorMessage = describeError(error);
  } finally {
    busy = false;
  }
}
</script>

<svelte:head>
  <title>Messenger</title>
  <meta
    name="description"
    content="Sign in to your messenger account."
  />
</svelte:head>

<main>
  <section
  class="card"
  class:signed-in={session !== null}
  aria-labelledby="page-title"
>
    <p class="eyebrow">MESSENGER</p>

    {#if session}
      <h1 id="page-title">
        Hello, {session.user.displayName || 'there'}.
      </h1>

      <p class="subtitle">You are signed in to your account.</p>

      <dl class="account-details">
        <dt>Email</dt>
        <dd>{session.user.email}</dd>

        <dt>Display name</dt>
        <dd>{session.user.displayName || 'Not set'}</dd>

        <dt>User ID</dt>
        <dd class="identifier">{session.user.id}</dd>
      </dl>

      {#if browserDevice}
  <dl class="account-details">
    <dt>This device</dt>
    <dd>{browserDevice.name || 'Web browser'}</dd>

    <dt>Device ID</dt>
    <dd class="identifier">{browserDevice.id}</dd>
  </dl>
  {:else}
    <div class="actions">
      <button
        type="button"
        onclick={retryDeviceSetup}
        disabled={busy}
      >
        {busy ? 'Setting up device…' : 'Retry device setup'}
      </button>
    </div>
  {/if}

      <div class="actions">
        <button
          type="button"
          onclick={checkAccount}
          disabled={busy}
        >
          Verify account
        </button>

        <button
          type="button"
          class="secondary"
          onclick={signOut}
          disabled={busy}
        >
          Sign out
        </button>
      </div>
    {#if browserDevice && import.meta.env.DEV}
  {#key `${session.user.id}:${browserDevice.id}`}
    <TestMessageSender
      disabled={busy}
      send={sendTestMessage}
    />
  {/key}
{/if}

    {#if browserDevice}
  <section class="inbox" aria-labelledby="inbox-title">
    <h2 id="inbox-title">Conversations</h2>

    <p class="connection-status" role="status">
      Live updates: {realtimeStatus}
    </p>

    <button
      type="button"
      onclick={syncInbox}
      disabled={busy}
    >
      Sync inbox
    </button>

    {#if !inboxLoaded}
      <p class="subtitle">Loading messages for this device…</p>
    {:else}
      {#key `${session.user.id}:${browserDevice.id}`}
        <ConversationInbox
          messages={inboxMessages}
          userId={session.user.id}
        />
      {/key}
    {/if}
  </section>
{/if}
    {:else}
      <h1 id="page-title">Welcome back.</h1>
      <p class="subtitle">Sign in to your messenger account.</p>

      <form onsubmit={signIn}>
        <div class="field">
          <label for="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autocomplete="username"
            placeholder="you@example.com"
            bind:value={email}
            disabled={busy}
            required
          />
        </div>

        <div class="field">
          <label for="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            bind:value={password}
            disabled={busy}
            required
          />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    {/if}

    {#if errorMessage}
      <p class="feedback error" role="alert">{errorMessage}</p>
    {/if}

    {#if notice}
      <p class="feedback success" role="status">{notice}</p>
    {/if}
  </section>
</main>