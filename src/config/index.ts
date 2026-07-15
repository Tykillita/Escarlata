export interface Config {
  assistantName: string;
  assistantDescription: string;
  personality: string;
  anthropicApiKey: string;
  anthropicModel: string;
}

export function loadConfig(): Config {
  // Only the Anthropic provider needs an API key; ollama/mock run without one.
  const provider = (process.env.MODEL_PROVIDER || 'mock').toLowerCase();
  const authMethod = process.env.MODEL_AUTH_METHOD || 'api_key';
  if (provider === 'anthropic' && authMethod === 'api_key' && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('Missing required environment variable: ANTHROPIC_API_KEY');
  }

  return {
    assistantName: process.env.ASSISTANT_NAME || 'Trillion',
    assistantDescription: process.env.ASSISTANT_DESCRIPTION || 'un asistente de voz que recuerda al usuario y actúa en su nombre.',
    personality: process.env.ASSISTANT_PERSONALITY || 'Cálido, directo y breve. Habla como un colega capaz que respeta el tiempo del usuario.',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  };
}
