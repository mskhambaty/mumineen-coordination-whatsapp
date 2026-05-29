const envAliases: Record<string, string[]> = {
  META_APP_SECRET: ["Meta_app_secret", "META_APP_SECRET"],
  META_GRAPH_API_VERSION: ["Meta_graph_api_version", "META_GRAPH_API_VERSION"],
  META_WEBHOOK_VERIFY_TOKEN: ["META_WEBHOOK_VERIFY_TOKEN", "Meta_webhook_verify_token"],
  OPENAI_API_KEY: ["OPENAI_API_KEY", "OpenAI_key", "OPENAI_key"],
  OPENAI_MODEL: ["OPENAI_MODEL", "OpenAI_model"],
  SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY", "Supabase_service_role_key"],
  SUPABASE_URL: ["SUPABASE_URL", "Supabase_url", "Supabase_project_url"],
  WHATSAPP_ACCESS_TOKEN: ["WHATSAPP_ACCESS_TOKEN", "Whatsapp_access_token"],
  WHATSAPP_PHONE_NUMBER_ID: ["WHATSAPP_PHONE_NUMBER_ID", "Whatsapp_phone_number_id"],
};

export function requireEnv(name: string): string {
  const value = optionalEnv(name);

  if (!value) {
    const acceptedNames = getEnvNames(name).join(", ");
    throw new Error(`Missing required environment variable: ${name}. Accepted names: ${acceptedNames}`);
  }

  return value;
}

export function optionalEnv(name: string): string | undefined {
  for (const envName of getEnvNames(name)) {
    const value = process.env[envName];

    if (value && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function getEnvNames(name: string) {
  return envAliases[name] ?? [name];
}
