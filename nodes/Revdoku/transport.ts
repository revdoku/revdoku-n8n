import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  IPollFunctions,
  IHttpRequestMethods,
  IHttpRequestOptions,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

type Context = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;
export const API_URL = "https://api.revdoku.com/v1";

export async function request(
  this: Context,
  method: IHttpRequestMethods,
  path: string,
  data: IDataObject = {},
  downloadRedirect = false,
) {
  const credentials = await this.getCredentials("revdokuApi");
  const params = Object.fromEntries(
    Object.entries({
      ...data,
      ...(credentials.accountId ? { account_id: credentials.accountId } : {}),
    }).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
  const options: IHttpRequestOptions = {
    url: `${API_URL}${path}`,
    method,
    json: true,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
    disableFollowRedirect: true,
    headers: {
      "X-Revdoku-Agent": "n8n",
      "X-Revdoku-Agent-Client": "n8n-nodes-revdoku",
      "X-Revdoku-Agent-Version": "1.0.0",
    },
    ...(method === "GET" ? { qs: params } : { body: params }),
  };
  const response = await this.helpers.httpRequestWithAuthentication.call(
    this,
    "revdokuApi",
    options,
  );
  if (response.statusCode >= 400) {
    const error = response.body?.error;
    throw new NodeApiError(
      this.getNode(),
      {
        message:
          error?.message || `Revdoku returned HTTP ${response.statusCode}`,
        httpCode: String(response.statusCode),
      } as JsonObject,
      {
        message: error?.message,
        description: error?.code,
        httpCode: String(response.statusCode),
      },
    );
  }
  if (downloadRedirect && response.statusCode === 302)
    return {
      url: httpsUrl.call(this, response.headers?.location),
    } as IDataObject;
  if (response.statusCode === 204) return {} as IDataObject;
  if (
    response.statusCode >= 300 ||
    response.body?.success !== true ||
    !response.body.data
  ) {
    throw new NodeOperationError(
      this.getNode(),
      "Revdoku returned an invalid response",
    );
  }
  return response.body.data as IDataObject;
}

export async function list(
  this: Context,
  path: string,
  key: "emails" | "files",
  filters: IDataObject,
  returnAll: boolean,
  limit: number,
) {
  const items: IDataObject[] = [];
  const seen = new Set<string>();
  const params: IDataObject = { ...filters, limit: Math.min(limit, 100) };
  while (true) {
    const data = await request.call(this, "GET", path, params);
    if (!Array.isArray(data[key]))
      throw new NodeOperationError(
        this.getNode(),
        "Revdoku returned an invalid list",
      );
    items.push(...(data[key] as IDataObject[]));
    const pagination = data.pagination as IDataObject;
    if (!pagination || typeof pagination.has_more !== "boolean")
      throw new NodeOperationError(
        this.getNode(),
        "Revdoku returned invalid pagination",
      );
    if (!pagination.has_more || (!returnAll && items.length >= limit)) break;
    const next =
      key === "emails" ? pagination.next_cursor : pagination.next_offset;
    if (
      next === undefined ||
      next === null ||
      next === "" ||
      seen.has(String(next))
    ) {
      throw new NodeOperationError(
        this.getNode(),
        "Revdoku pagination did not advance",
      );
    }
    seen.add(String(next));
    params[key === "emails" ? "cursor" : "offset"] = next;
    params.limit = returnAll ? 100 : Math.min(limit - items.length, 100);
  }
  return returnAll ? items : items.slice(0, limit);
}

export function httpsUrl(this: Context, url: unknown): string {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password)
      return parsed.href;
  } catch {
    /* reject an invalid server link */
  }
  throw new NodeOperationError(
    this.getNode(),
    "Revdoku returned an invalid file URL",
  );
}
