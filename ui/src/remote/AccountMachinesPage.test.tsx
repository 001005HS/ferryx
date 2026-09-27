import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { AccountMachinesPage } from "./AccountMachinesPage";
import * as accountSessionModule from "./accountSession";
import * as accountAttachModule from "./accountAttach";

// requestGrant defaults to a mirror grant, which connects but is refused by the daemon's
// filesystem/DAG routes and by the UI gates that list paired worktrees.
describe("AccountMachinesPage account connect", () => {
  const relayUrl = "https://relay.example.com";
  const sessionToken = "account-session-token";

  const machine = {
    machineRecordId: "rec-mach-1",
    machineId: "machine-1",
    displayName: "Remote Machine",
    publicKey: "machine-public-key",
    attachPublicKey: "machine-attach-key",
    relayOrigin: relayUrl,
    platform: "macos",
    enrollmentEpoch: "1",
    enrolledAt: 1,
    lastSeenAt: 1,
  } as unknown as accountSessionModule.AccountMachineView;

  const grantResponse = {
    grantId: "grant-1",
    machineId: machine.machineId,
    relayOrigin: relayUrl,
    pairingToken: "pairing-token-1",
    machineAttachPublicKey: "machine-attach-key",
    grantScope: "machine",
    expiresAt: Date.now() + 600_000,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(accountSessionModule, "listMachines").mockResolvedValue([machine]);
    vi.spyOn(accountAttachModule, "getOrCreateAttachKey").mockResolvedValue({
      publicKey: "device-attach-public-key",
      privateKey: "device-attach-private-key",
    } as never);
    vi.spyOn(accountSessionModule, "allocateSession").mockResolvedValue({
      sessionId: "session-1",
      machineId: machine.machineId,
      opaque: true,
    } as never);
    vi.spyOn(accountSessionModule, "openTunnel").mockResolvedValue({
      transport: { fetchLike: vi.fn() } as never,
      close: vi.fn(),
    } as never);
    vi.spyOn(accountSessionModule, "redeemInTunnel").mockResolvedValue({
      token: "device-token-1",
      machineId: machine.machineId,
    } as never);
  });

  async function connectOnce() {
    const onConnect = vi.fn();
    const { getByTestId } = render(
      <AccountMachinesPage
        relayUrl={relayUrl}
        accountSessionToken={sessionToken}
        onConnect={onConnect}
        onLogout={vi.fn()}
      />,
    );
    const button = await waitFor(() => getByTestId(`connect-machine-${machine.machineId}`), {
      timeout: 5000,
    });
    fireEvent.click(button);
    // The connect chain runs five awaited steps (attach key, grant, session, tunnel,
    // redeem); the default 1s waitFor budget is too tight for it.
    await waitFor(() => expect(onConnect).toHaveBeenCalledTimes(1), { timeout: 5000 });
    return onConnect;
  }

  it("requests a machine-scope grant so projects, worktrees and terminals work", async () => {
    const grantSpy = vi
      .spyOn(accountSessionModule, "requestGrant")
      .mockResolvedValue(grantResponse as never);

    await connectOnce();

    expect(grantSpy).toHaveBeenCalledTimes(1);
    const options = grantSpy.mock.calls[0][4];
    expect(
      options?.grantScope,
      "the account Connect path must request a machine-scope grant; the default is 'mirror', " +
        "which the daemon rejects for projects/worktrees/terminals",
    ).toBe("machine");
  });

  it("still establishes the connection over the encrypted tunnel", async () => {
    vi.spyOn(accountSessionModule, "requestGrant").mockResolvedValue(grantResponse as never);

    const onConnect = await connectOnce();

    expect(accountSessionModule.allocateSession).toHaveBeenCalledWith(
      relayUrl,
      sessionToken,
      machine.machineId,
    );
    expect(accountSessionModule.redeemInTunnel).toHaveBeenCalledTimes(1);
    expect(onConnect.mock.calls[0][0]).toMatchObject({
      machine: expect.objectContaining({ machineId: machine.machineId }),
      deviceToken: "device-token-1",
    });
  });
});
