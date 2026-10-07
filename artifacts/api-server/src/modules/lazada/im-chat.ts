import { createImClient, type ImPageInput } from "./im-client";
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
