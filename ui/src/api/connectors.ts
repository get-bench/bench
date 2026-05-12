import { api } from "./client";

export interface ConnectorBeginInstallResponse {
  authorizationUrl: string;
  state: string;
}

export const connectorsApi = {
  beginInstall: (
    connectorId: string,
    body: { companyId: string; returnTo?: string; scopes?: string[] },
  ) =>
    api.post<ConnectorBeginInstallResponse>(
      `/connectors/${encodeURIComponent(connectorId)}/install`,
      body,
    ),
};
