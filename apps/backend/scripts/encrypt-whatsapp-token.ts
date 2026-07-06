import { ConfigService } from '@nestjs/config';
import { WhatsAppTokenCryptoService } from '../src/modules/whatsapp-integration/whatsapp-token-crypto.service';

// Minimal ConfigService-like object backed by process.env, so this CLI
// script can reuse WhatsAppTokenCryptoService without booting Nest or
// reading .env directly.
const configService = {
  get: (key: string) => process.env[key],
} as unknown as ConfigService;

const tokenCryptoService = new WhatsAppTokenCryptoService(configService);

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

  console.log(tokenCryptoService.encrypt(token.trim()));
}

if (require.main === module) {
  main();
}
