import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createFileStore, parseBlobKey, type BlobStore } from "@/lib/blob-store";

let root: string;
let store: BlobStore;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "blob-store-"));
  store = createFileStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parseBlobKey", () => {
  it("accepts the keys the photos use", () => {
    expect(parseBlobKey("cmabc123/cmprod456/cmimg789/medium.webp")).toEqual([
      "cmabc123",
      "cmprod456",
      "cmimg789",
      "medium.webp",
    ]);
    expect(parseBlobKey("single/p_1/i-2/thumb.webp")).toHaveLength(4);
  });

  it.each([
    ["an empty key", ""],
    ["a parent folder", "../secret.txt"],
    ["a parent folder in the middle", "a/../b"],
    ["an absolute path", "/etc/passwd"],
    ["an empty segment", "a//b"],
    ["a backslash", "a\\b"],
    ["a Windows drive", "C:/windows/system32"],
    ["a hidden file", "a/.env"],
    ["a trailing slash", "a/b/"],
    ["a space", "a/b c"],
    ["a double dot inside a name", "a/b..c"],
    ["too many levels", "a/b/c/d/e/f/g"],
    ["a very long segment", `a/${"x".repeat(101)}`],
  ])("rejects %s", (_name, key) => {
    expect(() => parseBlobKey(key)).toThrow("Invalid blob key");
  });
});

describe("createFileStore", () => {
  it("stores and returns the same bytes", async () => {
    await store.put("t1/p1/i1/thumb.webp", Buffer.from([1, 2, 3, 4]));
    const read = await store.get("t1/p1/i1/thumb.webp");
    expect(read && [...read]).toEqual([1, 2, 3, 4]);
  });

  it("returns null for a file that is not there (for instance after restoring a database without its files)", async () => {
    expect(await store.get("t1/p1/i1/thumb.webp")).toBeNull();
    expect(await store.get("nobody/nothing/here/x.webp")).toBeNull();
  });

  it("replaces a file without leaving temporary files behind", async () => {
    await store.put("t1/p1/i1/medium.webp", Buffer.from("one"));
    await store.put("t1/p1/i1/medium.webp", Buffer.from("two"));
    expect((await store.get("t1/p1/i1/medium.webp"))?.toString()).toBe("two");
    expect(await readdir(path.join(root, "t1", "p1", "i1"))).toEqual(["medium.webp"]);
  });

  it("keeps each business in its own folder", async () => {
    await store.put("tenantA/p1/i1/thumb.webp", Buffer.from("A"));
    await store.put("tenantB/p1/i1/thumb.webp", Buffer.from("B"));
    expect((await store.get("tenantA/p1/i1/thumb.webp"))?.toString()).toBe("A");
    expect((await store.get("tenantB/p1/i1/thumb.webp"))?.toString()).toBe("B");
    expect((await readdir(root)).sort()).toEqual(["tenantA", "tenantB"]);
  });

  it("removes files, ignores the ones already gone and cleans up empty folders", async () => {
    await store.put("t1/p1/i1/thumb.webp", Buffer.from("a"));
    await store.put("t1/p1/i1/medium.webp", Buffer.from("b"));
    await store.put("t1/p1/i2/thumb.webp", Buffer.from("c"));

    await store.remove(["t1/p1/i1/thumb.webp", "t1/p1/i1/medium.webp", "t1/p1/i1/large.webp"]);

    expect(await store.get("t1/p1/i1/thumb.webp")).toBeNull();
    expect(await readdir(path.join(root, "t1", "p1"))).toEqual(["i2"]);
    expect((await store.get("t1/p1/i2/thumb.webp"))?.toString()).toBe("c");
  });

  it("refuses a key that tries to leave its folder, for every operation", async () => {
    await expect(store.put("../escape/x.webp", Buffer.from("x"))).rejects.toThrow(
      "Invalid blob key",
    );
    await expect(store.get("a/../../escape.webp")).rejects.toThrow("Invalid blob key");
    await expect(store.remove(["/abs/path.webp"])).rejects.toThrow("Invalid blob key");
  });
});
