export type Conversation = {
  id: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  members: {
    createdAt: string;
    user: {
      id: string;
      displayName: string | null;
    };
  }[];
  lastMessage: {
    id: string;
    senderId: string;
    senderDeviceId: string;
    createdAt: string;
    sequence: string;
  } | null;
};

export type ConversationsResponse = {
  conversations: Conversation[];
};