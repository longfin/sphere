import { syncScrypt } from "scrypt-js";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import * as crypto from "crypto";
import Wallet from "ethereumjs-wallet";
// code from https://github.com/ethereumjs/ethereumjs-wallet/blob/4cccc623f30839ceb53a007d5a0cce452a0dff88/src/index.ts#L662

// https://github.com/ethereum/wiki/wiki/Web3-Secret-Storage-Definition
export interface V3Keystore {
  crypto: {
    cipher: string;
    cipherparams: {
      iv: string;
    };
    ciphertext: string;
    kdf: string;
    kdfparams: KDFParamsOut;
    mac: string;
  };
  id: string;
  version: number;
  address: string;
}

interface PBKDFParamsOut {
  c: number;
  dklen: number;
  prf: string;
  salt: string;
}

interface ScryptKDFParamsOut {
  dklen: number;
  n: number;
  p: number;
  r: number;
  salt: string;
}

type KDFParamsOut = ScryptKDFParamsOut | PBKDFParamsOut;

export function decipherV3(
  input: string | V3Keystore,
  password: string,
  nonStrict = false
): Wallet {
  const json: V3Keystore =
    typeof input === "object"
      ? input
      : JSON.parse(nonStrict ? input.toLowerCase() : input);

  if (json.version !== 3) {
    throw new Error("Not a V3 wallet");
  }

  let derivedKey: Uint8Array, kdfparams: any;
  if (json.crypto.kdf === "scrypt") {
    kdfparams = json.crypto.kdfparams;

    // FIXME: support progress reporting callback
    derivedKey = syncScrypt(
      Buffer.from(password),
      Buffer.from(kdfparams.salt, "hex"),
      kdfparams.n,
      kdfparams.r,
      kdfparams.p,
      kdfparams.dklen
    );
  } else if (json.crypto.kdf === "pbkdf2") {
    kdfparams = json.crypto.kdfparams;

    if (kdfparams.prf !== "hmac-sha256") {
      throw new Error("Unsupported parameters to PBKDF2");
    }

    derivedKey = crypto.pbkdf2Sync(
      Buffer.from(password),
      Buffer.from(kdfparams.salt, "hex"),
      kdfparams.c,
      kdfparams.dklen,
      "sha256"
    );
  } else {
    throw new Error("Unsupported key derivation scheme");
  }

  const ciphertext = Buffer.from(json.crypto.ciphertext, "hex");
  const mac = keccak_256(
    Buffer.concat([Buffer.from(derivedKey.slice(16, 32)), ciphertext])
  );
  if (bytesToHex(mac) !== json.crypto.mac) {
    throw new Error("Key derivation failed - possibly wrong passphrase");
  }

  const decipher = crypto.createDecipheriv(
    json.crypto.cipher,
    derivedKey.slice(0, 16),
    Buffer.from(json.crypto.cipherparams.iv, "hex")
  );
  const seed = runCipherBuffer(decipher, ciphertext);
  return new Wallet(seed);
}

function runCipherBuffer(
  cipher: crypto.Cipher | crypto.Decipher,
  data: Buffer
): Buffer {
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

export async function rawPrivateKeyToV3(
  privateKey: string,
  passphrase: string
) {
  try {
    const wallet = new Wallet(Buffer.from(privateKey, "hex"));
    const v3 = await wallet.toV3(passphrase);
    Object.defineProperty(v3, "address", wallet.getAddressString);
    return {
      filename: wallet.getV3Filename(Date.now()),
      data: JSON.stringify(v3),
    };
  } catch (e) {
    console.error(e);
  }
}
