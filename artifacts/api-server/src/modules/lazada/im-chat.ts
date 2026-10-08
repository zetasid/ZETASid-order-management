import { createImClient, type ImPageInput, type ImSendMessageResult } from "./im-client";
import { getImConnectionCredentials } from "./im-connection";

async function currentUserClient(userId: string) {
  const { config, accessToken } = await getImConnectionCredentials(userId);
  return { client: createImClient(config), accessToken };
}

export async function getImSessionList(userId: string, input: ImPageInput) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getSessionList(accessToken, input);
}

export async function getImSessionDetail(userId: string, sessionId: string) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getSessionDetail(accessToken, sessionId);
}

export async function getImMessages(userId: string, sessionId: string, input: ImPageInput) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.getMessages(accessToken, sessionId, input);
}

export async function readImSession(userId: string, sessionId: string, lastReadMessageId: string) {
  const { client, accessToken } = await currentUserClient(userId);
  return client.readSession(accessToken, sessionId, lastReadMessageId);
}

export async function sendImMessage(userId: string, sessionId: string, txt: string): Promise<ImSendMessageResult> {
  const { client, accessToken } = await currentUserClient(userId);
  return client.sendMessage(accessToken, sessionId, txt);
}
