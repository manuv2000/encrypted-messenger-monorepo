<script lang="ts">
  import { ApiError } from './api';

  let {
    disabled,
    send,
  }: {
    disabled: boolean;
    send: (
      conversationId: string,
      recipientDeviceId: string,
      clientMessageId: string,
    ) => Promise<{ id: string }>;
  } = $props();

  let conversationId = $state(
    'f67919bd-2120-4457-ad2f-4d1619daf5a5',
  );

  let recipientDeviceId = $state('');
  let pendingId = $state<string | null>(null);
  let sending = $state(false);
  let error = $state('');
  let result = $state('');

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function submit(event: SubmitEvent) {
    event.preventDefault();

    if (disabled || sending) return;

    error = '';
    result = '';

    const conversation = conversationId.trim();
    const recipient = recipientDeviceId.trim();

    if (
      !uuidPattern.test(conversation) ||
      !uuidPattern.test(recipient)
    ) {
      error = 'Enter valid conversation and recipient device UUIDs.';
      return;
    }

    sending = true;

    try {
      // Reuse this ID after an uncertain failure, such as a timeout.
      pendingId ??= crypto.randomUUID();

      const response = await send(
        conversation,
        recipient,
        pendingId,
      );

      result = `Server accepted message ${response.id}`;
      pendingId = null;
    } catch (cause) {
      error =
        cause instanceof ApiError
          ? `${cause.status}: ${cause.message}`
          : cause instanceof Error
            ? cause.message
            : 'Sending failed.';

      // These responses reject the request before creating a message.
      // Unlock the fields so the request can be corrected.
      if (
        cause instanceof ApiError &&
        [400, 403, 404].includes(cause.status)
      ) {
        pendingId = null;
      }
    } finally {
      sending = false;
    }
  }
</script>

<section class="test-sender" aria-labelledby="test-sender-title">
  <h2 id="test-sender-title">Send a test message</h2>

  <p>
    Sends a fixed test payload. This does not encrypt a message.
  </p>

  <form onsubmit={submit}>
    <div class="field">
      <label for="test-conversation">Conversation ID</label>
      <input
        id="test-conversation"
        bind:value={conversationId}
        disabled={disabled || sending || pendingId !== null}
        required
      />
    </div>

    <div class="field">
      <label for="test-recipient">Recipient browser device ID</label>
      <input
        id="test-recipient"
        bind:value={recipientDeviceId}
        disabled={disabled || sending || pendingId !== null}
        placeholder="Copy from the recipient's account screen"
        required
      />
    </div>

    <button type="submit" disabled={disabled || sending}>
      {sending
        ? 'Sending…'
        : pendingId
          ? 'Retry same message'
          : 'Send test message'}
    </button>
  </form>

  {#if pendingId && !sending}
    <p>
      Delivery is not confirmed. Retry this request before starting another.
    </p>
  {/if}

  {#if error}
    <p class="feedback error" role="alert">{error}</p>
  {/if}

  {#if result}
    <p class="feedback success" role="status">{result}</p>
  {/if}
</section>

<style>
  .test-sender {
    margin-top: 28px;
    padding-top: 24px;
    border-top: 1px solid #2b384c;
  }

  h2 {
    margin: 0 0 12px;
  }

  .test-sender > p {
    color: #aab8cc;
    line-height: 1.5;
  }
</style>