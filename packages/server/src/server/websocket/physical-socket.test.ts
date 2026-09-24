import { expect, test } from "vitest";
import {
  APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS,
  APPLICATION_SOCKET_LEASE_MS,
  ApplicationSocketLease,
  MAX_PHYSICAL_SOCKET_BUFFERED_BYTES,
  sendBoundedPhysicalFrame,
  sendBoundedPhysicalFrameAndWait,
} from "./physical-socket.js";

test("sockets remain exempt until they send an application ping", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const legacySocket = {};
  now = APPLICATION_SOCKET_LEASE_MS * 10;

  expect(lease.listExpired()).toEqual([]);
  lease.renew(legacySocket);
  expect(lease.listExpired()).toEqual([]);
});

test("inbound activity renews a claimed lease", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const applicationSocket = {};
  lease.claim(applicationSocket);

  now = APPLICATION_SOCKET_LEASE_MS - 1;
  lease.renew(applicationSocket);
  now += APPLICATION_SOCKET_LEASE_MS - 1;
  expect(lease.listExpired()).toEqual([]);

  now += 1;
  expect(lease.listExpired()).toEqual([applicationSocket]);
  lease.release(applicationSocket);
  expect(lease.listExpired()).toEqual([]);
});

test("an application ping claims a socket lease", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const rawSocket = {};

  lease.claim(rawSocket);
  now = APPLICATION_SOCKET_LEASE_MS;

  expect(lease.listExpired()).toEqual([rawSocket]);
});

test("a lease check delayed by system sleep does not count the slept time", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const applicationSocket = {};
  lease.listExpired();
  lease.claim(applicationSocket);

  // The clock kept running through 10 minutes of sleep, so the next check runs
  // late, before the client could ping.
  now = APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS + 10 * 60_000;
  expect(lease.listExpired()).toEqual([]);

  // Awake time still counts: the lease expires on the same check it would have without sleep.
  for (let check = 0; check < 3; check += 1) {
    now += APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS;
    expect(lease.listExpired()).toEqual([]);
  }
  now += APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS;
  expect(lease.listExpired()).toEqual([applicationSocket]);
});

test("a lease renewed after a wake does not also get the slept time", () => {
  let now = 0;
  const lease = new ApplicationSocketLease<object>(() => now);
  const applicationSocket = {};
  lease.listExpired();
  lease.claim(applicationSocket);

  // A frame arrives right after a 10 minute sleep, before the overdue check runs.
  now = APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS + 10 * 60_000;
  lease.renew(applicationSocket);
  now += 5;
  expect(lease.listExpired()).toEqual([]);

  // Then the client goes silent: it is reaped one lease after the renewal.
  for (let check = 0; check < 4; check += 1) {
    now += APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS;
    expect(lease.listExpired()).toEqual([]);
  }
  now += APPLICATION_SOCKET_LEASE_CHECK_INTERVAL_MS;
  expect(lease.listExpired()).toEqual([applicationSocket]);
});

test("the shared physical send boundary rejects binary above the hard bound", () => {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let terminated = false;
  const socket = {
    readyState: 1,
    bufferedAmount: MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 1,
    send: (data: string | Uint8Array | ArrayBuffer) => sent.push(data),
  };

  const accepted = sendBoundedPhysicalFrame({
    socket,
    frame: new Uint8Array(2),
    onHighWater: () => {
      terminated = true;
    },
  });

  expect(accepted).toBe(false);
  expect(sent).toEqual([]);
  expect(terminated).toBe(true);
});

test("the awaitable physical send resolves only when that frame send completes", async () => {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];
  let completeSend: (() => void) | undefined;
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (_data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) => {
      sent.push(_data);
      if (callback) completeSend = () => callback();
    },
  };
  let completed = false;

  const sending = sendBoundedPhysicalFrameAndWait({
    socket,
    frame: new Uint8Array([1, 2, 3]),
    onHighWater: () => undefined,
  }).then(() => {
    return (completed = true);
  });

  await Promise.resolve();
  expect(completed).toBe(false);
  expect(
    sendBoundedPhysicalFrame({
      socket,
      frame: "unrelated",
      onHighWater: () => undefined,
    }),
  ).toBe(true);
  expect(sent).toEqual([new Uint8Array([1, 2, 3]), "unrelated"]);
  completeSend?.();
  await sending;
  expect(completed).toBe(true);
});

test("the awaitable physical send rejects callback errors", async () => {
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send: (_data: string | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void) =>
      callback?.(new Error("send failed")),
  };

  await expect(
    sendBoundedPhysicalFrameAndWait({
      socket,
      frame: new Uint8Array([1]),
      onHighWater: () => undefined,
    }),
  ).rejects.toThrow("send failed");
});
