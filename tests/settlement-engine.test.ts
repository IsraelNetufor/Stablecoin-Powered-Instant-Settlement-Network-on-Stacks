// settlement-engine.test.ts

import { describe, it, expect, beforeEach } from "vitest";
import { stringUtf8CV, uintCV, principalCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_RECEIVER = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_INVALID_TOKEN = 103;
const ERR_SETTLEMENT_NOT_FOUND = 105;
const ERR_INVALID_STATUS = 106;
const ERR_INVALID_TIMESTAMP = 107;
const ERR_VAULT_NOT_SET = 108;
const ERR_ESCROW_NOT_SET = 109;
const ERR_FEE_NOT_SET = 110;
const ERR_ORACLE_NOT_SET = 111;
const ERR_CONFIRMATION_REQUIRED = 114;
const ERR_CANCEL_NOT_ALLOWED = 115;
const ERR_TIMEOUT_EXCEEDED = 116;
const ERR_PEG_VALIDATION_FAILED = 117;
const ERR_MAX_SETTLEMENTS_EXCEEDED = 119;
const ERR_INVALID_DISPUTE_REASON = 120;

interface Settlement {
  sender: string;
  receiver: string;
  amount: number;
  stableToken: string;
  status: number;
  timestamp: number;
  feeAmount: number;
  disputeReason: string | null;
  confirmed: boolean;
}

type Result<T> = { ok: true; value: T; } | { ok: false; value: number; };

class SettlementEngineMock {
  state: {
    nextSettlementId: number;
    maxSettlements: number;
    settlementTimeout: number;
    vaultContract: string | null;
    escrowContract: string | null;
    feeContract: string | null;
    oracleContract: string | null;
    adminPrincipal: string;
    settlements: Map<number, Settlement>;
    settlementsBySender: Map<string, number[]>;
    settlementsByReceiver: Map<string, number[]>;
  } = {
    nextSettlementId: 0,
    maxSettlements: 10000,
    settlementTimeout: 144,
    vaultContract: null,
    escrowContract: null,
    feeContract: null,
    oracleContract: null,
    adminPrincipal: "ST1ADMIN",
    settlements: new Map(),
    settlementsBySender: new Map(),
    settlementsByReceiver: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1SENDER";
  transfers: Array<{ token: string; amount: number; from: string; to: string }> = [];
  feesCollected: Array<{ amount: number }> = [];
  pegValidated: boolean = true;

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextSettlementId: 0,
      maxSettlements: 10000,
      settlementTimeout: 144,
      vaultContract: null,
      escrowContract: null,
      feeContract: null,
      oracleContract: null,
      adminPrincipal: "ST1ADMIN",
      settlements: new Map(),
      settlementsBySender: new Map(),
      settlementsByReceiver: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1SENDER";
    this.transfers = [];
    this.feesCollected = [];
    this.pegValidated = true;
  }

  setVaultContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.vaultContract = contract;
    return { ok: true, value: true };
  }

  setEscrowContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.escrowContract = contract;
    return { ok: true, value: true };
  }

  setFeeContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.feeContract = contract;
    return { ok: true, value: true };
  }

  setOracleContract(contract: string): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    this.state.oracleContract = contract;
    return { ok: true, value: true };
  }

  setSettlementTimeout(newTimeout: number): Result<boolean> {
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (newTimeout <= 0) return { ok: false, value: ERR_INVALID_TIMESTAMP };
    this.state.settlementTimeout = newTimeout;
    return { ok: true, value: true };
  }

  initSettlement(receiver: string, amount: number, stableToken: string): Result<number> {
    if (this.state.nextSettlementId >= this.state.maxSettlements) return { ok: false, value: ERR_MAX_SETTLEMENTS_EXCEEDED };
    if (receiver === this.caller) return { ok: false, value: ERR_INVALID_RECEIVER };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (stableToken !== "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token") return { ok: false, value: ERR_INVALID_TOKEN };
    if (!this.pegValidated) return { ok: false, value: ERR_PEG_VALIDATION_FAILED };
    if (!this.state.vaultContract) return { ok: false, value: ERR_VAULT_NOT_SET };
    if (!this.state.oracleContract) return { ok: false, value: ERR_ORACLE_NOT_SET };
    if (!this.state.feeContract) return { ok: false, value: ERR_FEE_NOT_SET };

    const feeAmount = Math.floor(amount * 0.001);
    const netAmount = amount - feeAmount;
    this.feesCollected.push({ amount: feeAmount });
    this.transfers.push({ token: stableToken, amount: amount, from: this.caller, to: this.state.vaultContract });

    const id = this.state.nextSettlementId;
    const settlement: Settlement = {
      sender: this.caller,
      receiver,
      amount: netAmount,
      stableToken,
      status: 0,
      timestamp: this.blockHeight,
      feeAmount,
      disputeReason: null,
      confirmed: false,
    };
    this.state.settlements.set(id, settlement);

    const senderList = this.state.settlementsBySender.get(this.caller) || [];
    senderList.push(id);
    this.state.settlementsBySender.set(this.caller, senderList);

    const receiverList = this.state.settlementsByReceiver.get(receiver) || [];
    receiverList.push(id);
    this.state.settlementsByReceiver.set(receiver, receiverList);

    this.state.nextSettlementId++;
    return { ok: true, value: id };
  }

  confirmSettlement(settlementId: number): Result<boolean> {
    const settlement = this.state.settlements.get(settlementId);
    if (!settlement) return { ok: false, value: ERR_SETTLEMENT_NOT_FOUND };
    if (this.caller !== settlement.receiver) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (settlement.status !== 0) return { ok: false, value: ERR_INVALID_STATUS };
    if (settlement.confirmed) return { ok: false, value: ERR_CONFIRMATION_REQUIRED };

    settlement.confirmed = true;
    this.state.settlements.set(settlementId, settlement);
    return { ok: true, value: true };
  }

  executeTransfer(settlementId: number): Result<boolean> {
    const settlement = this.state.settlements.get(settlementId);
    if (!settlement) return { ok: false, value: ERR_SETTLEMENT_NOT_FOUND };
    if (this.caller !== settlement.sender && this.caller !== settlement.receiver) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (settlement.status !== 0) return { ok: false, value: ERR_INVALID_STATUS };
    if (this.blockHeight > settlement.timestamp + this.state.settlementTimeout) return { ok: false, value: ERR_TIMEOUT_EXCEEDED };
    if (!this.state.vaultContract) return { ok: false, value: ERR_VAULT_NOT_SET };
    if (!this.state.escrowContract) return { ok: false, value: ERR_ESCROW_NOT_SET };

    if (settlement.disputeReason) {
      // Simulate escrow
    } else {
      this.transfers.push({ token: settlement.stableToken, amount: settlement.amount, from: this.state.vaultContract!, to: settlement.receiver });
    }

    settlement.status = 1;
    this.state.settlements.set(settlementId, settlement);
    return { ok: true, value: true };
  }

  cancelSettlement(settlementId: number): Result<boolean> {
    const settlement = this.state.settlements.get(settlementId);
    if (!settlement) return { ok: false, value: ERR_SETTLEMENT_NOT_FOUND };
    if (this.caller !== settlement.sender) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (settlement.status !== 0) return { ok: false, value: ERR_INVALID_STATUS };
    if (settlement.confirmed) return { ok: false, value: ERR_CANCEL_NOT_ALLOWED };
    if (!this.state.vaultContract) return { ok: false, value: ERR_VAULT_NOT_SET };

    this.transfers.push({ token: settlement.stableToken, amount: settlement.amount, from: this.state.vaultContract!, to: this.caller });

    settlement.status = 2;
    this.state.settlements.set(settlementId, settlement);
    return { ok: true, value: true };
  }

  disputeSettlement(settlementId: number, reason: string): Result<boolean> {
    const settlement = this.state.settlements.get(settlementId);
    if (!settlement) return { ok: false, value: ERR_SETTLEMENT_NOT_FOUND };
    if (this.caller !== settlement.sender && this.caller !== settlement.receiver) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (settlement.status !== 0) return { ok: false, value: ERR_INVALID_STATUS };
    if (reason.length > 200) return { ok: false, value: ERR_INVALID_DISPUTE_REASON };

    settlement.disputeReason = reason;
    settlement.status = 3;
    this.state.settlements.set(settlementId, settlement);
    return { ok: true, value: true };
  }

  resolveDispute(settlementId: number, resolveTo: string): Result<boolean> {
    const settlement = this.state.settlements.get(settlementId);
    if (!settlement) return { ok: false, value: ERR_SETTLEMENT_NOT_FOUND };
    if (this.caller !== this.state.adminPrincipal) return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (settlement.status !== 3) return { ok: false, value: ERR_INVALID_STATUS };
    if (!this.state.vaultContract) return { ok: false, value: ERR_VAULT_NOT_SET };
    if (!this.state.escrowContract) return { ok: false, value: ERR_ESCROW_NOT_SET };

    // Simulate release from escrow
    this.transfers.push({ token: settlement.stableToken, amount: settlement.amount, from: this.state.vaultContract!, to: resolveTo });

    settlement.status = 1;
    this.state.settlements.set(settlementId, settlement);
    return { ok: true, value: true };
  }

  getSettlement(id: number): Settlement | null {
    return this.state.settlements.get(id) || null;
  }

  getSettlementsBySender(sender: string): number[] | null {
    return this.state.settlementsBySender.get(sender) || null;
  }

  getSettlementsByReceiver(receiver: string): number[] | null {
    return this.state.settlementsByReceiver.get(receiver) || null;
  }

  getNextSettlementId(): number {
    return this.state.nextSettlementId;
  }
}

describe("SettlementEngine", () => {
  let contract: SettlementEngineMock;

  beforeEach(() => {
    contract = new SettlementEngineMock();
    contract.reset();
  });

  it("sets vault contract successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setVaultContract("ST2VAULT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.vaultContract).toBe("ST2VAULT");
  });

  it("rejects set vault by non-admin", () => {
    contract.caller = "ST1SENDER";
    const result = contract.setVaultContract("ST2VAULT");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("sets escrow contract successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setEscrowContract("ST3ESCROW");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.escrowContract).toBe("ST3ESCROW");
  });

  it("sets fee contract successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setFeeContract("ST4FEE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.feeContract).toBe("ST4FEE");
  });

  it("sets oracle contract successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setOracleContract("ST5ORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracleContract).toBe("ST5ORACLE");
  });

  it("sets settlement timeout successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setSettlementTimeout(288);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.settlementTimeout).toBe(288);
  });

  it("rejects invalid settlement timeout", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setSettlementTimeout(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TIMESTAMP);
  });

  it("initiates settlement successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const settlement = contract.getSettlement(0);
    expect(settlement?.sender).toBe("ST1SENDER");
    expect(settlement?.receiver).toBe("ST2RECEIVER");
    expect(settlement?.amount).toBe(999);
    expect(settlement?.stableToken).toBe("SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(settlement?.status).toBe(0);
    expect(settlement?.timestamp).toBe(0);
    expect(settlement?.feeAmount).toBe(1);
    expect(settlement?.disputeReason).toBeNull();
    expect(settlement?.confirmed).toBe(false);
    expect(contract.transfers).toEqual([{ token: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token", amount: 1000, from: "ST1SENDER", to: "ST2VAULT" }]);
    expect(contract.feesCollected).toEqual([{ amount: 1 }]);
    expect(contract.getSettlementsBySender("ST1SENDER")).toEqual([0]);
    expect(contract.getSettlementsByReceiver("ST2RECEIVER")).toEqual([0]);
  });

  it("rejects init settlement to self", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST1SENDER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_RECEIVER);
  });

  it("rejects init settlement with invalid amount", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST2RECEIVER", 0, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects init settlement with invalid token", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST2RECEIVER", 1000, "INVALID_TOKEN");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TOKEN);
  });

  it("rejects init settlement without vault set", () => {
    contract.caller = "ST1ADMIN";
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_VAULT_NOT_SET);
  });

  it("rejects init settlement on peg validation fail", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.pegValidated = false;
    const result = contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PEG_VALIDATION_FAILED);
  });

  it("confirms settlement successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    const result = contract.confirmSettlement(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const settlement = contract.getSettlement(0);
    expect(settlement?.confirmed).toBe(true);
  });

  it("rejects confirm by non-receiver", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST3FAKE";
    const result = contract.confirmSettlement(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects confirm on invalid status", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    const settlement = contract.getSettlement(0)!;
    settlement.status = 1;
    contract.state.settlements.set(0, settlement);
    contract.caller = "ST2RECEIVER";
    const result = contract.confirmSettlement(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("executes transfer successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    contract.confirmSettlement(0);
    contract.caller = "ST1SENDER";
    const result = contract.executeTransfer(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const settlement = contract.getSettlement(0);
    expect(settlement?.status).toBe(1);
    expect(contract.transfers[1]).toEqual({ token: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token", amount: 999, from: "ST2VAULT", to: "ST2RECEIVER" });
  });

  it("rejects execute by unauthorized", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST3FAKE";
    const result = contract.executeTransfer(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects execute on timeout", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.blockHeight = 145;
    const result = contract.executeTransfer(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_TIMEOUT_EXCEEDED);
  });

  it("cancels settlement successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    const result = contract.cancelSettlement(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const settlement = contract.getSettlement(0);
    expect(settlement?.status).toBe(2);
    expect(contract.transfers[1]).toEqual({ token: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token", amount: 999, from: "ST2VAULT", to: "ST1SENDER" });
  });

  it("rejects cancel by non-sender", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    const result = contract.cancelSettlement(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects cancel after confirm", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    contract.confirmSettlement(0);
    contract.caller = "ST1SENDER";
    const result = contract.cancelSettlement(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_CANCEL_NOT_ALLOWED);
  });

  it("disputes settlement successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    const result = contract.disputeSettlement(0, "Invalid transaction");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const settlement = contract.getSettlement(0);
    expect(settlement?.status).toBe(3);
    expect(settlement?.disputeReason).toBe("Invalid transaction");
  });

  it("rejects dispute by unauthorized", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST3FAKE";
    const result = contract.disputeSettlement(0, "Invalid transaction");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects dispute with long reason", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    const longReason = "a".repeat(201);
    const result = contract.disputeSettlement(0, longReason);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DISPUTE_REASON);
  });

  it("resolves dispute successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    contract.disputeSettlement(0, "Invalid transaction");
    contract.caller = "ST1ADMIN";
    const result = contract.resolveDispute(0, "ST1SENDER");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const settlement = contract.getSettlement(0);
    expect(settlement?.status).toBe(1);
    expect(contract.transfers[1]).toEqual({ token: "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token", amount: 999, from: "ST2VAULT", to: "ST1SENDER" });
  });

  it("rejects resolve by non-admin", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST2RECEIVER";
    contract.disputeSettlement(0, "Invalid transaction");
    contract.caller = "ST1SENDER";
    const result = contract.resolveDispute(0, "ST1SENDER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects resolve on non-disputed", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setEscrowContract("ST3ESCROW");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    contract.caller = "ST1ADMIN";
    const result = contract.resolveDispute(0, "ST1SENDER");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("gets settlement correctly", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    const settlement = contract.getSettlement(0);
    expect(settlement).not.toBeNull();
    expect(settlement?.amount).toBe(999);
  });

  it("gets settlements by sender correctly", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    const list = contract.getSettlementsBySender("ST1SENDER");
    expect(list).toEqual([0]);
  });

  it("gets next settlement id correctly", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.caller = "ST1SENDER";
    contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(contract.getNextSettlementId()).toBe(1);
  });

  it("rejects init when max settlements exceeded", () => {
    contract.caller = "ST1ADMIN";
    contract.setVaultContract("ST2VAULT");
    contract.setFeeContract("ST4FEE");
    contract.setOracleContract("ST5ORACLE");
    contract.state.maxSettlements = 0;
    contract.caller = "ST1SENDER";
    const result = contract.initSettlement("ST2RECEIVER", 1000, "SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.sip-010-token");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_SETTLEMENTS_EXCEEDED);
  });
});