import { createCipheriv, createHash, randomBytes } from 'node:crypto';

// Mirrors WhatsappService's private decryptAccessToken format exactly:
// "<ivHex>:<authTagHex>:<cipherTextHex>", AES-256-GCM with a 12-byte IV,
// key = sha256(WHATSAPP_TOKEN_ENCRYPTION_KEY).
export function encryptAccessToken(plainToken: string, rawKey: string): string {
  const key = createHash('sha256').update(rawKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plainToken, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

async function promptForToken(): Promise<string> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Token de WhatsApp a cifrar: ');
    return answer.trim();
  } finally {
    rl.close();
  }
}

async function main() {
  const rawKey = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY;

  if (!rawKey?.trim()) {
    console.error(
      'Error: WHATSAPP_TOKEN_ENCRYPTION_KEY no está definida en el entorno.',
    );
    process.exitCode = 1;
    return;
  }

  let token = process.argv[2];
  if (!token?.trim()) {
    token = await promptForToken();
  }

  if (!token?.trim()) {
    console.error(
      'Error: debes proporcionar un token, por argumento o en el prompt.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(encryptAccessToken(token.trim(), rawKey));
}

if (require.main === module) {
  main();
}
