<script lang="ts">
  import type { InboxMessage } from './inbox';

  let {
    messages,
    userId,
  }: {
    messages: InboxMessage[];
    userId: string;
  } = $props();

  type ConversationThread = {
    id: string;
    messages: InboxMessage[];
    latestSequence: bigint;
  };

  let selectedId = $state<string | null>(null);

  const conversations = $derived.by(() => {
    const grouped = new Map<string, ConversationThread>();

    for (const message of messages) {
      let thread = grouped.get(message.conversationId);

      if (!thread) {
        thread = {
          id: message.conversationId,
          messages: [],
          latestSequence: BigInt(message.sequence),
        };

        grouped.set(thread.id, thread);
      }

      thread.messages.push(message);

      const sequence = BigInt(message.sequence);

      if (sequence > thread.latestSequence) {
        thread.latestSequence = sequence;
      }
    }

    for (const thread of grouped.values()) {
      thread.messages.sort((a, b) => {
        const left = BigInt(a.sequence);
        const right = BigInt(b.sequence);

        return left < right ? -1 : left > right ? 1 : 0;
      });
    }

    return [...grouped.values()].sort((a, b) =>
      a.latestSequence > b.latestSequence
        ? -1
        : a.latestSequence < b.latestSequence
          ? 1
          : 0,
    );
  });

  const selectedConversation = $derived(
    conversations.find((conversation) => conversation.id === selectedId)
      ?? conversations[0]
      ?? null,
  );

  function shortId(id: string): string {
    return id.slice(0, 8);
  }
</script>

{#if conversations.length === 0}
  <p class="empty">
    No messages for this device yet.
  </p>
{:else}
  <div class="chat-layout">
    <nav class="conversation-list" aria-label="Conversations">
      {#each conversations as conversation (conversation.id)}
        <button
          type="button"
          class="conversation-button"
          class:selected={selectedConversation?.id === conversation.id}
          aria-current={selectedConversation?.id === conversation.id
            ? 'true'
            : undefined}
          onclick={() => selectedId = conversation.id}
        >
          <strong>Chat {shortId(conversation.id)}</strong>
          <span>
            {conversation.messages.length} saved
            {conversation.messages.length === 1 ? 'message' : 'messages'}
          </span>
        </button>
      {/each}
    </nav>

    {#if selectedConversation}
      <section class="chat-panel" aria-labelledby="selected-chat-title">
        <header class="chat-header">
          <h3 id="selected-chat-title">
            Chat {shortId(selectedConversation.id)}
          </h3>
          <p>Messages saved on this device</p>
        </header>

        <ol class="chat-messages">
          {#each selectedConversation.messages as message (message.id)}
            <li
              class="chat-message"
              class:outgoing={message.senderId === userId}
            >
              <div class="message-meta">
                <strong>
                  {message.senderId === userId
                    ? 'You'
                    : `User ${shortId(message.senderId)}`}
                </strong>

                <time datetime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </div>

              <p class="message-body">Message content unavailable</p>

              <details>
                <summary>Message details</summary>

                <dl>
                  <dt>Message ID</dt>
                  <dd>{message.id}</dd>

                  <dt>Sequence</dt>
                  <dd>{message.sequence}</dd>

                  <dt>Envelope type</dt>
                  <dd>{message.envelope.envelopeType}</dd>

                  <dt>Stored payload</dt>
                  <dd>{message.envelope.ciphertext}</dd>
                </dl>
              </details>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
{/if}

<style>
  .chat-layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 20px;
    align-items: start;
  }

  .conversation-list {
    display: grid;
    gap: 10px;
    max-height: 65vh;
    overflow-y: auto;
    padding: 4px;
  }

  .conversation-button {
    display: grid;
    gap: 8px;
    width: 100%;
    padding: 16px;
    text-align: left;
    color: #edf3fa;
    background: #0d1420;
    border: 1px solid #2b384c;
    font-weight: 400;
  }

  .conversation-button:hover {
    background: #243248;
  }

  .conversation-button.selected {
    background: #193a32;
    border-color: #85d7c2;
  }

  .conversation-button span,
  .chat-header p,
  .empty {
    color: #aab8cc;
    font-size: 0.875rem;
    line-height: 1.5;
  }

  .chat-panel {
    min-width: 0;
    overflow: hidden;
    background: #0d1420;
    border: 1px solid #2b384c;
    border-radius: 16px;
  }

  .chat-header {
    padding: 20px;
    border-bottom: 1px solid #2b384c;
  }

  .chat-header h3,
  .chat-header p {
    margin: 0;
  }

  .chat-header p {
    margin-top: 8px;
  }

  .chat-messages {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: 65vh;
    overflow-y: auto;
    margin: 0;
    padding: 20px;
    list-style: none;
  }

  .chat-message {
    align-self: flex-start;
    width: min(100%, 460px);
    padding: 16px;
    background: #1b293c;
    border: 1px solid #30425c;
    border-radius: 14px;
  }

  .chat-message.outgoing {
    align-self: flex-end;
    background: #193a32;
    border-color: #326657;
  }

  .message-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    font-size: 0.75rem;
  }

  time {
    color: #aab8cc;
  }

  .message-body {
    margin: 16px 0;
    line-height: 1.5;
  }

  summary {
    color: #85d7c2;
    cursor: pointer;
    font-size: 0.875rem;
  }

  dt {
    margin-top: 12px;
    color: #aab8cc;
  }

  dd {
    margin: 6px 0 0;
    font-family: monospace;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  @media (max-width: 700px) {
    .chat-layout {
      grid-template-columns: minmax(0, 1fr);
    }

    .conversation-list {
      max-height: 180px;
    }

    .chat-messages {
      max-height: 55vh;
      padding: 12px;
    }
  }
</style>