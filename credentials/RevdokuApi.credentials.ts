import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class RevdokuApi implements ICredentialType {
  name = "revdokuApi";
  displayName = "Revdoku API";
  icon: ICredentialType["icon"] = {
    light: "file:../nodes/Revdoku/revdoku.svg",
    dark: "file:../nodes/Revdoku/revdoku.svg",
  };
  documentationUrl = "https://revdoku.com/api.md";
  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
    },
    {
      displayName: "Account ID",
      name: "accountId",
      type: "string",
      default: "",
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: "=Bearer {{$credentials.apiKey}}" },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: "https://api.revdoku.com/v1",
      url: "/status",
      method: "GET",
      qs: { account_id: "={{$credentials.accountId || undefined}}" },
    },
  };
}
