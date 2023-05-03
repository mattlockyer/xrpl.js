import * as assert from 'assert'
import Sha512 from './Sha512'

import * as nobleSecp256k1 from '@noble/curves/secp256k1'
import * as nobleEd25519 from '@noble/curves/ed25519'
import * as nobleUtils from '@noble/curves/abstract/utils'

import * as addressCodec from 'ripple-address-codec'
import { accountPublicFromPublicGenerator, derivePrivateKey } from './secp256k1'
import * as utils from './utils'
import { hexToBytes } from '@noble/curves/abstract/utils'
import { randomBytes } from '@noble/hashes/utils'

const { hexToNumberArray } = utils
const { bytesToHex } = utils

export type Bytes = number[] | Uint8Array
export type HexString = string

const SECP256K1_PREFIX = '00'

function hash(message: Bytes | string): Uint8Array {
  return new Sha512().add(message).first256()
}

function generateSeed(
  options: {
    entropy?: Uint8Array
    algorithm?: 'ed25519' | 'ecdsa-secp256k1'
  } = {},
): string {
  assert.ok(
    !options.entropy || options.entropy.length >= 16,
    'entropy too short',
  )
  const entropy = options.entropy
    ? options.entropy.slice(0, 16)
    : randomBytes(16)
  const type = options.algorithm === 'ed25519' ? 'ed25519' : 'secp256k1'
  return addressCodec.encodeSeed(entropy, type)
}

const secp256k1 = {
  deriveKeypair(
    entropy: Uint8Array,
    options?: object,
  ): {
    privateKey: string
    publicKey: string
  } {
    const derived = derivePrivateKey(entropy, options)
    const privateKey =
      SECP256K1_PREFIX + bytesToHex(nobleUtils.numberToBytesBE(derived, 32))

    const publicKey = bytesToHex(
      nobleSecp256k1.secp256k1.getPublicKey(derived, true),
    )
    return { privateKey, publicKey }
  },

  sign(message: Bytes, privateKey: HexString): string {
    // Some callers pass the privateKey with the prefix, others without.
    // elliptic.js implementation ignored the prefix, interpreting it as a
    // leading zero byte. @noble/curves will throw if the key is not exactly
    // 32 bytes, so we normalize it before passing to the sign method.
    // TODO: keep back compat like this, or simply always require prefix as
    // the ed25519 sign method does.
    assert.ok(
      (privateKey.length === 66 && privateKey.startsWith(SECP256K1_PREFIX)) ||
        privateKey.length === 64,
    )
    const normed = privateKey.length === 66 ? privateKey.slice(2) : privateKey
    return nobleSecp256k1.secp256k1
      .sign(hash(message), normed)
      .toDERHex(true)
      .toUpperCase()
  },

  verify(message, signature, publicKey): boolean {
    const decoded = nobleSecp256k1.secp256k1.Signature.fromDER(signature)
    return nobleSecp256k1.secp256k1.verify(decoded, hash(message), publicKey)
  },
}

const ed25519 = {
  deriveKeypair(entropy: Bytes): {
    privateKey: string
    publicKey: string
  } {
    const prefix = 'ED'
    const rawPrivateKey = hash(entropy)
    const privateKey = prefix + bytesToHex(rawPrivateKey)
    const publicKey =
      prefix + bytesToHex(nobleEd25519.ed25519.getPublicKey(rawPrivateKey))
    return { privateKey, publicKey }
  },

  sign(message: Bytes, privateKey: HexString): string {
    assert.ok(
      Array.isArray(message) || message instanceof Uint8Array,
      'message must be array of octets',
    )
    assert.ok(
      privateKey.length === 66,
      'private key must be 33 bytes including prefix',
    )
    return bytesToHex(
      nobleEd25519.ed25519.sign(new Uint8Array(message), privateKey.slice(2)),
    )
  },

  verify(
    message: Bytes,
    signature: HexString | Uint8Array,
    publicKey: string,
  ): boolean {
    return nobleEd25519.ed25519.verify(
      signature,
      new Uint8Array(message),
      publicKey.slice(2),
    )
  },
}

function select(algorithm: 'ecdsa-secp256k1' | 'ed25519') {
  const methods = { 'ecdsa-secp256k1': secp256k1, ed25519 }
  return methods[algorithm]
}

function deriveKeypair(
  seed: string,
  options?: object,
): {
  publicKey: string
  privateKey: string
} {
  const decoded = addressCodec.decodeSeed(seed)
  const algorithm = decoded.type === 'ed25519' ? 'ed25519' : 'ecdsa-secp256k1'
  const method = select(algorithm)
  const keypair = method.deriveKeypair(decoded.bytes, options)
  const messageToVerify = hash('This test message should verify.')
  const signature = method.sign(messageToVerify, keypair.privateKey)
  /* istanbul ignore if */
  if (!method.verify(messageToVerify, signature, keypair.publicKey)) {
    throw new Error('derived keypair did not generate verifiable signature')
  }
  return keypair
}

function getAlgorithmFromKey(key: HexString): 'ed25519' | 'ecdsa-secp256k1' {
  const bytes = hexToNumberArray(key)
  return bytes.length === 33 && bytes[0] === 0xed
    ? 'ed25519'
    : 'ecdsa-secp256k1'
}

function sign(messageHex: HexString, privateKey: HexString): string {
  const algorithm = getAlgorithmFromKey(privateKey)
  return select(algorithm).sign(hexToBytes(messageHex), privateKey)
}

function verify(
  messageHex: HexString,
  signature: HexString,
  publicKey: HexString,
): boolean {
  const algorithm = getAlgorithmFromKey(publicKey)
  return select(algorithm).verify(hexToBytes(messageHex), signature, publicKey)
}

function deriveAddressFromBytes(publicKeyBytes: Uint8Array): string {
  return addressCodec.encodeAccountID(
    utils.computePublicKeyHash(publicKeyBytes),
  )
}

function deriveAddress(publicKey: string): string {
  return deriveAddressFromBytes(new Uint8Array(hexToNumberArray(publicKey)))
}

function deriveNodeAddress(publicKey: string): string {
  const generatorBytes = addressCodec.decodeNodePublic(publicKey)
  const accountPublicBytes = accountPublicFromPublicGenerator(generatorBytes)
  return deriveAddressFromBytes(accountPublicBytes)
}

const { decodeSeed } = addressCodec

export {
  generateSeed,
  deriveKeypair,
  sign,
  verify,
  deriveAddress,
  deriveNodeAddress,
  decodeSeed,
}
