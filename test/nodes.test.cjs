const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Revdoku } = require("../dist/nodes/Revdoku/Revdoku.node");
const { RevdokuTrigger } = require("../dist/nodes/Revdoku/RevdokuTrigger.node");
const { RevdokuApi } = require("../dist/credentials/RevdokuApi.credentials");
const node = new Revdoku();
const trigger = new RevdokuTrigger();
const response = (data, statusCode = 200) => ({
  statusCode,
  body: { success: true, data },
});
const page = (emails, next_cursor, has_more = false) =>
  response({ emails, pagination: { next_cursor, has_more } });

function context(parameters, replies = [], options = {}) {
  const calls = [];
  const state = options.state || {};
  let pending = [...replies];
  const ctx = {
    getInputData: () => options.items || [{ json: {} }],
    getNodeParameter(name, index, fallback) {
      const value = parameters[name];
      return typeof value === "function"
        ? value(index)
        : value === undefined
          ? fallback
          : value;
    },
    getNode: () => ({
      name: "Revdoku",
      type: "n8n-nodes-revdoku.revdoku",
      typeVersion: 1,
      parameters,
      position: [0, 0],
      credentials: { revdokuApi: { id: "credential_1" } },
    }),
    getCredentials: async () => ({
      apiKey: options.apiKey || "fixture-secret",
      accountId: options.accountId || "acct_client",
    }),
    continueOnFail: () => options.continueOnFail || false,
    getMode: () => options.mode || "trigger",
    getWorkflowStaticData: () => state,
    helpers: {
      async httpRequestWithAuthentication(type, request) {
        assert.equal(type, "revdokuApi");
        calls.push({ authenticated: true, ...request });
        assert.ok(pending.length, "Unexpected authenticated request");
        const value = pending.shift();
        if (value instanceof Error) throw value;
        return value;
      },
      async httpRequest(request) {
        calls.push({ authenticated: false, ...request });
        assert.ok(
          !request.headers?.Authorization,
          "API key leaked to file storage",
        );
        assert.ok(pending.length, "Unexpected external request");
        const value = pending.shift();
        if (value instanceof Error) throw value;
        return value;
      },
      async getBinaryDataBuffer(index, field) {
        assert.equal(index, 0);
        assert.equal(field, "data");
        return Buffer.from("binary from n8n storage");
      },
      async prepareBinaryData(bytes, fileName, mimeType) {
        return { data: bytes.toString("base64"), fileName, mimeType };
      },
    },
  };
  return {
    ctx,
    calls,
    state,
    done: () => assert.equal(pending.length, 0, "Unused expected responses"),
  };
}

async function execute(parameters, replies, options) {
  const fixture = context(parameters, replies, options);
  const [items] = await node.execute.call(fixture.ctx);
  fixture.done();
  return { ...fixture, items };
}

test("package declarations load the actual compiled nodes and credentials, including icons", () => {
  const pkg = require("../package.json");
  for (const filename of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
    assert.equal(
      typeof Object.values(require(path.join("..", filename)))[0],
      "function",
    );
  }
  assert.ok(
    fs.existsSync(path.resolve(__dirname, "../dist/nodes/Revdoku/revdoku.svg")),
  );
  const credentials = new RevdokuApi();
  assert.equal(credentials.test.request.url, "/status");
  assert.equal(
    credentials.authenticate.properties.headers.Authorization,
    "=Bearer {{$credentials.apiKey}}",
  );
  assert.equal(credentials.properties[0].typeOptions.password, true);
});

test("account requests use the dedicated host and account query", async () => {
  const { calls, items } = await execute(
    { resource: "account", operation: "limits" },
    [
      response({
        account_id: "acct_client",
        limits: { max_storage_bytes: 10737418240 },
      }),
    ],
  );
  assert.equal(calls[0].url, "https://api.revdoku.com/v1/account/limits");
  assert.deepEqual(calls[0].qs, { account_id: "acct_client" });
  assert.equal(items[0].json.limits.max_storage_bytes, 10737418240);
});

test("create mailbox is minimal, scopes the JSON body and preserves the named result", async () => {
  const { calls, items } = await execute(
    { resource: "bucket", operation: "create", emailUsername: "invoices" },
    [
      response(
        {
          bucket: {
            id: "bkt_1",
            email: { address: "invoices@revdokumail.com" },
          },
        },
        201,
      ),
    ],
  );
  assert.deepEqual(calls[0].body, {
    bucket: { email: { username: "invoices" } },
    account_id: "acct_client",
  });
  assert.equal(items[0].json.bucket.id, "bkt_1");
});

test("multiple input items retain pairedItem links", async () => {
  const { items, calls } = await execute(
    {
      resource: "email",
      operation: "get",
      bucketId: "bkt_1",
      emailId: (index) => `eml_${index}`,
    },
    [
      response({ email: { id: "eml_0" } }),
      response({ email: { id: "eml_1" } }),
    ],
    { items: [{ json: {} }, { json: {} }] },
  );
  assert.deepEqual(
    items.map((item) => item.pairedItem),
    [{ item: 0 }, { item: 1 }],
  );
  assert.ok(calls[1].url.endsWith("/emails/eml_1"));
});

test("email lists paginate and preserve false filters", async () => {
  const { items, calls } = await execute(
    {
      resource: "email",
      operation: "getMany",
      bucketId: "bkt_1",
      returnAll: true,
      filters: { read: false, has_attachments: false },
    },
    [
      page([{ id: "eml_1" }], "cursor&1", true),
      page([{ id: "eml_2" }], "cursor2"),
    ],
  );
  assert.equal(items.length, 2);
  assert.deepEqual(calls[1].qs, {
    read: false,
    has_attachments: false,
    order: "asc",
    limit: 100,
    cursor: "cursor&1",
    account_id: "acct_client",
  });
});

test("file lists retrieve server offsets and obey the requested limit", async () => {
  const { items, calls } = await execute(
    { resource: "file", operation: "getMany", bucketId: "bkt_1", limit: 3 },
    [
      response({
        files: [{ id: "df_1" }, { id: "df_2" }],
        pagination: { has_more: true, next_offset: 2 },
      }),
      response({
        files: [{ id: "df_3" }],
        pagination: { has_more: true, next_offset: 3 },
      }),
    ],
  );
  assert.equal(items.length, 3);
  assert.equal(calls[1].qs.limit, 1);
  assert.equal(calls[1].qs.offset, 2);
});

test("list results all link to the source item", async () => {
  const { items } = await execute(
    { resource: "bucket", operation: "getMany" },
    [response({ buckets: [{ id: "bkt_1" }, { id: "bkt_2" }] })],
  );
  assert.deepEqual(
    items.map((item) => item.pairedItem),
    [{ item: 0 }, { item: 0 }],
  );
});

test("email read update sends false as a JSON boolean", async () => {
  const { calls } = await execute(
    {
      resource: "email",
      operation: "update",
      bucketId: "bkt_1",
      emailId: "eml_1",
      read: false,
    },
    [response({ email: { read: false } })],
  );
  assert.deepEqual(calls[0].body, { read: false, account_id: "acct_client" });
});

test("deletion handles 204 and requires explicit confirmation", async () => {
  const parameters = {
    resource: "email",
    operation: "delete",
    bucketId: "bkt_1",
    emailId: "eml_1",
  };
  const fixture = context(parameters);
  await assert.rejects(
    () => node.execute.call(fixture.ctx),
    /Confirm deletion/,
  );
  assert.equal(fixture.calls.length, 0);
  const { items } = await execute({ ...parameters, confirm: true }, [
    { statusCode: 204 },
  ]);
  assert.deepEqual(items[0].json, { id: "eml_1", deleted: true });
});

test("binary upload uses n8n storage helpers and excludes credentials on the PUT", async () => {
  const { calls, items } = await execute(
    {
      resource: "file",
      operation: "upload",
      bucketId: "bkt_1",
      path: "docs/note.txt",
      uploadInput: "binary",
      reason: "Archive invoice",
    },
    [
      response({
        signed_id: "signed",
        direct_upload: {
          url: "https://storage.example.com/object",
          headers: { "Content-Type": "text/plain" },
        },
      }),
      {},
      response({
        file: { id: "df_1" },
        version: { id: "dfrev_1" },
        created: true,
      }),
    ],
    {
      items: [
        {
          json: {},
          binary: {
            data: {
              id: "database-reference",
              data: "not-inline",
              mimeType: "text/plain",
            },
          },
        },
      ],
    },
  );
  assert.equal(
    calls[0].body.blob.byte_size,
    Buffer.byteLength("binary from n8n storage"),
  );
  assert.equal(calls[1].authenticated, false);
  assert.equal(calls[1].body.toString(), "binary from n8n storage");
  assert.equal(calls[2].body.account_id, "acct_client");
  assert.equal(calls[2].body.reason, "Archive invoice");
  assert.equal(items[0].json.version.id, "dfrev_1");
});

test("identical upload skips PUT and attach, including zero-byte files", async () => {
  const { calls, items } = await execute(
    {
      resource: "file",
      operation: "upload",
      bucketId: "bkt_1",
      path: "empty.txt",
      uploadInput: "text",
      text: "",
    },
    [response({ skipped: true, file: { id: "df_1" } })],
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.blob.byte_size, 0);
  assert.equal(items[0].json.skipped, true);
});

test("attachment downloads use fresh temporary URLs and native binary output", async () => {
  const { calls, items } = await execute(
    {
      resource: "email",
      operation: "downloadAttachment",
      bucketId: "bkt_1",
      emailId: "eml_1",
      attachmentId: "df_att",
    },
    [
      response({
        download: {
          url: "https://storage.example.com/fresh",
          authentication: "none",
          filename: "invoice.pdf",
          content_type: "application/pdf",
          size_bytes: 3,
        },
      }),
      Buffer.from("pdf"),
    ],
  );
  assert.ok(calls[0].url.endsWith("/emails/eml_1/attachments/df_att"));
  assert.equal(calls[1].authenticated, false);
  assert.equal(
    items[0].binary.data.data,
    Buffer.from("pdf").toString("base64"),
  );
  assert.equal(items[0].json.url, undefined);
  assert.deepEqual(items[0].pairedItem, { item: 0 });
});

test("file download uses the selected file and version IDs, not a potentially reused path", async () => {
  const { calls, items } = await execute(
    {
      resource: "file",
      operation: "download",
      bucketId: "bkt_1",
      fileId: "df_1",
    },
    [
      response({
        file: {
          id: "df_1",
          basename: "note.txt",
          path: "notes/note.txt",
          current_file_version: { id: "dfrev_1", mime_type: "text/plain" },
        },
      }),
      {
        statusCode: 302,
        headers: { location: "https://storage.example.com/signed" },
      },
      Buffer.from("note"),
    ],
  );
  assert.equal(
    calls[1].url,
    "https://api.revdoku.com/v1/buckets/bkt_1/files/df_1/download",
  );
  assert.equal(calls[1].qs.version_id, "dfrev_1");
  assert.equal(calls[1].disableFollowRedirect, true);
  assert.equal(calls[2].authenticated, false);
  assert.equal(items[0].binary.data.fileName, "note.txt");
});

test("unsafe storage URLs are rejected before downloading", async () => {
  const fixture = context(
    {
      resource: "email",
      operation: "downloadOriginal",
      bucketId: "bkt_1",
      emailId: "eml_1",
    },
    [
      response({
        download: {
          url: "http://storage.example.com/file",
          authentication: "none",
        },
      }),
    ],
  );
  await assert.rejects(
    () => node.execute.call(fixture.ctx),
    /invalid file URL/,
  );
  assert.equal(fixture.calls.length, 1);
});

for (const statusCode of [401, 403, 404, 429, 503]) {
  test(`HTTP ${statusCode} fails without replaying mutations or returning partial success`, async () => {
    const fixture = context({ resource: "bucket", operation: "create" }, [
      {
        statusCode,
        body: {
          success: false,
          error: { code: "EXAMPLE_ERROR", message: "Fixture failure" },
        },
      },
    ]);
    await assert.rejects(
      () => node.execute.call(fixture.ctx),
      /Fixture failure/,
    );
    assert.equal(fixture.calls.length, 1);
  });
}

test("continueOnFail reports the failing item and still processes later inputs", async () => {
  const { items } = await execute(
    { resource: "account", operation: "get" },
    [new Error("Unavailable"), response({ account: { id: "acct_client" } })],
    { items: [{ json: {} }, { json: {} }], continueOnFail: true },
  );
  assert.deepEqual(items[0], {
    json: { error: "Unavailable" },
    pairedItem: { item: 0 },
  });
  assert.equal(items[1].json.account.id, "acct_client");
});

test("manual polling samples without changing persistent state", async () => {
  const fixture = context(
    { bucketId: "bkt_1" },
    [page([{ id: "eml_sample" }], "sample")],
    { mode: "manual", state: { cursor: "unchanged" } },
  );
  assert.equal(
    (await trigger.poll.call(fixture.ctx))[0][0].json.id,
    "eml_sample",
  );
  assert.deepEqual(fixture.state, { cursor: "unchanged" });
  assert.equal(fixture.calls[0].qs.order, "desc");
});

test("initial poll skips history and resumes using the saved arrival cursor", async () => {
  const state = {};
  const initial = context(
    { bucketId: "bkt_1", includeExisting: false },
    [page([{ id: "eml_old" }], "baseline")],
    { state },
  );
  assert.equal(await trigger.poll.call(initial.ctx), null);
  const next = context(
    { bucketId: "bkt_1", includeExisting: false },
    [page([{ id: "eml_late", received_at: "2020-01-01T00:00:00Z" }], "next")],
    { state },
  );
  assert.equal((await trigger.poll.call(next.ctx))[0][0].json.id, "eml_late");
  assert.equal(next.calls[0].qs.cursor, "baseline");
  assert.equal(state.cursor, "next");
});

test("empty polls retain the new cursor", async () => {
  const fixture = context({ bucketId: "bkt_1", includeExisting: true }, [
    page([], "empty"),
  ]);
  assert.equal(await trigger.poll.call(fixture.ctx), null);
  assert.equal(fixture.state.cursor, "empty");
});

test("failed later page does not advance the saved cursor", async () => {
  const initial = context({ bucketId: "bkt_1" }, [page([], "before")]);
  await trigger.poll.call(initial.ctx);
  const state = initial.state;
  const fixture = context(
    { bucketId: "bkt_1" },
    [page([{ id: "eml_1" }], "after", true), new Error("timeout")],
    { state },
  );
  await assert.rejects(() => trigger.poll.call(fixture.ctx), /timeout/);
  assert.equal(state.cursor, "before");
});

for (const change of ["account", "bucket", "key"]) {
  test(`changing ${change} resets the cursor scope`, async () => {
    const initial = context({ bucketId: "bkt_1" }, [page([], "before")]);
    await trigger.poll.call(initial.ctx);
    const fixture = context(
      {
        bucketId: change === "bucket" ? "bkt_2" : "bkt_1",
        includeExisting: false,
      },
      [page([], "new-scope")],
      {
        state: initial.state,
        ...(change === "account" ? { accountId: "acct_new" } : {}),
        ...(change === "key" ? { apiKey: "rotated-fixture-secret" } : {}),
      },
    );
    await trigger.poll.call(fixture.ctx);
    assert.equal(fixture.calls[0].qs.cursor, undefined);
    assert.equal(fixture.state.cursor, "new-scope");
    assert.ok(!JSON.stringify(fixture.state).includes("fixture-secret"));
  });
}

test("polling caps each run and preserves the backlog cursor", async () => {
  const fixture = context(
    { bucketId: "bkt_1", includeExisting: true },
    Array.from({ length: 10 }, (_, i) =>
      page([{ id: `eml_${i}` }], `cursor_${i}`, true),
    ),
  );
  assert.equal((await trigger.poll.call(fixture.ctx))[0].length, 10);
  assert.equal(fixture.state.cursor, "cursor_9");
  const next = context(
    { bucketId: "bkt_1", includeExisting: true },
    [page([{ id: "eml_10" }], "done")],
    { state: fixture.state },
  );
  assert.equal((await trigger.poll.call(next.ctx))[0][0].json.id, "eml_10");
  assert.equal(next.calls[0].qs.cursor, "cursor_9");
});

test("repeating cursors fail without saving state", async () => {
  const fixture = context({ bucketId: "bkt_1", includeExisting: true }, [
    page([], "same", true),
    page([], "same", true),
  ]);
  await assert.rejects(() => trigger.poll.call(fixture.ctx), /did not advance/);
  assert.deepEqual(fixture.state, {});
});
