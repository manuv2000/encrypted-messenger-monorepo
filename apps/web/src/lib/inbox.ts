export type InboxMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  createdAt: string;
  sequence: string;
  envelope: {
    envelopeType: 'PREKEY' | 'SESSION';
    protocolVersion: number;
    ciphertext: string;
    createdAt: string;
    deliveredAt?: string | null;
  };
};

export type InboxPage = {
  deviceId: string;
  messages: InboxMessage[];
  nextAfterSequence: string;
};

function openInbox(
  userId: string,
  deviceId: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      `messenger-inbox:${userId}:${deviceId}`,
      1,
    );

    request.onupgradeneeded = () => {
      request.result.createObjectStore('messages', {
        keyPath: 'id',
      });
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => database.close();
      resolve(database);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Cannot open the local inbox.'));
    };
  });
}

export async function saveInboxMessages(
  userId: string,
  deviceId: string,
  messages: InboxMessage[],
): Promise<void> {
  const database = await openInbox(userId, deviceId);

  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        'messages',
        'readwrite',
        { durability: 'strict' },
      );

      transaction.oncomplete = () => resolve();

      transaction.onabort = () => {
        reject(
          transaction.error ?? new Error('Saving the inbox failed.'),
        );
      };

      const store = transaction.objectStore('messages');

      try {
        for (const message of messages) {
          // The message ID is the key, so repeated syncs don't add duplicates.
          store.put(message);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

export async function readInboxMessages(
  userId: string,
  deviceId: string,
): Promise<InboxMessage[]> {
  const database = await openInbox(userId, deviceId);

  try {
    const messages = await new Promise<InboxMessage[]>(
      (resolve, reject) => {
        const transaction = database.transaction(
          'messages',
          'readonly',
        );

        const request = transaction.objectStore('messages').getAll();

        transaction.oncomplete = () => {
          resolve(request.result as InboxMessage[]);
        };

        transaction.onabort = () => {
          reject(
            transaction.error ?? new Error('Reading the inbox failed.'),
          );
        };
      },
    );

    return messages.sort((a, b) => {
      const left = BigInt(a.sequence);
      const right = BigInt(b.sequence);

      return left < right ? -1 : left > right ? 1 : 0;
    });
  } finally {
    database.close();
  }
}