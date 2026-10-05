import { createHash } from "node:crypto";
import type {
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IPollFunctions,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { request } from "./transport";

export class RevdokuTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Revdoku Trigger",
    name: "revdokuTrigger",
    icon: { light: "file:revdoku.svg", dark: "file:revdoku.svg" },
    group: ["trigger"],
    version: 1,
    subtitle: "New Email",
    description: "Poll for new emails in a Revdoku mailbox",
    defaults: { name: "Revdoku Trigger" },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    polling: true,
    credentials: [{ name: "revdokuApi", required: true }],
    properties: [
      {
        displayName: "Mailbox ID",
        name: "mailboxId",
        type: "string",
        default: "",
        required: true,
      },
      {
        displayName: "Include Existing Emails",
        name: "includeExisting",
        type: "boolean",
        default: false,
        description:
          "Whether to process existing messages when the workflow first starts",
      },
    ],
  };

  async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
    const mailboxId = this.getNodeParameter("mailboxId") as string;
    const path = `/mailboxes/${encodeURIComponent(mailboxId)}/emails`;
    if (this.getMode() === "manual") {
      const data = await request.call(this, "GET", path, {
        limit: 1,
        order: "desc",
      });
      const emails = data.emails as IDataObject[];
      return emails.length ? [emails.map((json) => ({ json }))] : null;
    }
    const credentials = await this.getCredentials("revdokuApi");
    const scope = JSON.stringify([
      this.getNode().credentials?.revdokuApi?.id,
      createHash("sha256").update(String(credentials.apiKey)).digest("hex"),
      credentials.accountId || "",
      mailboxId,
    ]);
    const state = this.getWorkflowStaticData("node");
    let cursor =
      state.scope === scope ? (state.cursor as string | undefined) : undefined;
    let initialized = state.scope === scope && state.initialized === true;
    const includeExisting = this.getNodeParameter("includeExisting") as boolean;
    const output: INodeExecutionData[] = [];
    const seen = new Set(cursor ? [cursor] : []);
    // Bound each poll. Save the arrival cursor so later polls resume a backlog.
    // Never use received_at: messages can arrive with old receipt timestamps.
    for (let page = 0; page < 10; page++) {
      const data = await request.call(this, "GET", path, {
        order: "asc",
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const pagination = data.pagination as IDataObject;
      if (
        !Array.isArray(data.emails) ||
        !pagination ||
        typeof pagination.next_cursor !== "string" ||
        typeof pagination.has_more !== "boolean"
      ) {
        throw new NodeOperationError(
          this.getNode(),
          "Revdoku returned invalid email pagination",
        );
      }
      const next = pagination.next_cursor;
      if (pagination.has_more && seen.has(next))
        throw new NodeOperationError(
          this.getNode(),
          "Email pagination did not advance",
        );
      if (initialized || includeExisting)
        output.push(
          ...(data.emails as IDataObject[]).map((json) => ({ json })),
        );
      cursor = next;
      seen.add(next);
      if (!pagination.has_more) {
        initialized = true;
        break;
      }
    }
    // Commit only after every request in this poll succeeded, including empty pages.
    Object.assign(state, { scope, cursor, initialized });
    return output.length ? [output] : null;
  }
}
