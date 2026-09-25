// GENERATED from dex-evm/abi/MarkStore.json by `bun scripts/gen-constants.ts`. Do not edit.
/**
 * MarkStore - both tiers' marks in the Pool impl: push + lane governance, called at the impl.
 *
 * Reads go through `PoolFactory.getFeed`/`feedOf`. Push calldata is raw segments
 * (`oracle/wire.ts`), never encoded through this ABI.
 */
import type { Abi } from '../eth/abi.js';

export const MARK_STORE_ABI: Abi = [
  {
    inputs: [
      {
        internalType: 'address',
        name: 'ac',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'factory',
        type: 'address',
      },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
  {
    inputs: [],
    name: 'FACTORY',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'op',
        type: 'bytes32',
      },
    ],
    name: 'cancel',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 't',
        type: 'uint256',
      },
    ],
    name: 'domainSeparator',
    outputs: [
      {
        internalType: 'bytes32',
        name: '',
        type: 'bytes32',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'lane',
        type: 'uint8',
      },
      {
        internalType: 'uint8',
        name: 'tierMask',
        type: 'uint8',
      },
    ],
    name: 'halt',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
    ],
    name: 'migrateFrom',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'publishMarks',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'lane',
        type: 'uint8',
      },
      {
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'register',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 't',
        type: 'uint8',
      },
      {
        internalType: 'address[]',
        name: 'signers',
        type: 'address[]',
      },
      {
        internalType: 'uint8',
        name: 'k',
        type: 'uint8',
      },
      {
        internalType: 'address[]',
        name: 'relayers',
        type: 'address[]',
      },
    ],
    name: 'setAuth',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'lane',
        type: 'uint8',
      },
      {
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'setBounds',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint256',
        name: 't',
        type: 'uint256',
      },
    ],
    name: 'tierVerifier',
    outputs: [
      {
        internalType: 'address',
        name: '',
        type: 'address',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'uint8',
        name: 'lane',
        type: 'uint8',
      },
      {
        internalType: 'uint8',
        name: 'tierMask',
        type: 'uint8',
      },
    ],
    name: 'unhalt',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'tier',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'address[]',
        name: 'signers',
        type: 'address[]',
      },
      {
        indexed: false,
        internalType: 'uint8',
        name: 'k',
        type: 'uint8',
      },
      {
        indexed: false,
        internalType: 'address[]',
        name: 'relayers',
        type: 'address[]',
      },
    ],
    name: 'AuthUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'lane',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'BoundsUpdated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'lane',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'tierMask',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'bool',
        name: 'halted',
        type: 'bool',
      },
    ],
    name: 'LaneHalted',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'uint256',
        name: 'lane',
        type: 'uint256',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'ttlSecs',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint16',
        name: 'maxDevBps',
        type: 'uint16',
      },
      {
        indexed: false,
        internalType: 'uint32',
        name: 'minSigmaPbps',
        type: 'uint32',
      },
    ],
    name: 'LaneRegistered',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: false,
        internalType: 'uint64',
        name: 'srcSecs',
        type: 'uint64',
      },
    ],
    name: 'MarksPublished',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'address',
        name: 'from',
        type: 'address',
      },
    ],
    name: 'Migrated',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'op',
        type: 'bytes32',
      },
    ],
    name: 'OpCancelled',
    type: 'event',
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: 'bytes32',
        name: 'op',
        type: 'bytes32',
      },
      {
        indexed: false,
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        indexed: false,
        internalType: 'uint256',
        name: 'eta',
        type: 'uint256',
      },
    ],
    name: 'OpQueued',
    type: 'event',
  },
  {
    inputs: [],
    name: 'FutureTimestamp',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidBlobHeader',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidInput',
    type: 'error',
  },
  {
    inputs: [],
    name: 'InvalidState',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotAuthorized',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotOwner',
    type: 'error',
  },
  {
    inputs: [],
    name: 'NotReady',
    type: 'error',
  },
  {
    inputs: [
      {
        internalType: 'uint32',
        name: 'age',
        type: 'uint32',
      },
      {
        internalType: 'uint32',
        name: 'maxAge',
        type: 'uint32',
      },
    ],
    name: 'StaleData',
    type: 'error',
  },
  {
    inputs: [],
    name: 'ZeroAddress',
    type: 'error',
  },
];
