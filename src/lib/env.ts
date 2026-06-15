const envAliases: Record<string, string[]> = {
  CRON_SECRET: ["CRON_SECRET"],
  META_APP_SECRET: ["Meta_app_secret", "META_APP_SECRET"],
  META_GRAPH_API_VERSION: ["Meta_graph_api_version", "META_GRAPH_API_VERSION"],
  META_WEBHOOK_VERIFY_TOKEN: ["META_WEBHOOK_VERIFY_TOKEN", "Meta_webhook_verify_token"],
  OPENAI_API_KEY: ["OPENAI_API_KEY", "OpenAI_key", "OPENAI_key"],
  OPENAI_MODEL: ["OPENAI_MODEL", "OpenAI_model"],
  NEXT_PUBLIC_APP_URL: ["NEXT_PUBLIC_APP_URL", "App_url", "APP_URL"],
  ADMIN_FALLBACK_PASSWORD: ["ADMIN_FALLBACK_PASSWORD", "Admin_fallback_password"],
  RELAY_SITE_ROOT: ["RELAY_SITE_ROOT", "Relay_site_root"],
  HOTEL_SHEET_CSV_URL: ["HOTEL_SHEET_CSV_URL", "Hotel_sheet_csv_url"],
  GOOGLE_SERVICE_ACCOUNT_JSON: ["GOOGLE_SERVICE_ACCOUNT_JSON", "Google_service_account_json"],
  GDRIVE_FAQ_FOLDER_ID: ["GDRIVE_FAQ_FOLDER_ID", "Gdrive_faq_folder_id"],
  GDRIVE_SYNC_DELETE_REMOVED: ["GDRIVE_SYNC_DELETE_REMOVED", "Gdrive_sync_delete_removed"],
  POSTMARK_API_TOKEN: ["POSTMARK_API_TOKEN", "Postmark_api_token"],
  POSTMARK_FROM_EMAIL: ["POSTMARK_FROM_EMAIL", "Postmark_from_email"],
  POSTMARK_ASSIGNMENT_TEMPLATE: ["POSTMARK_ASSIGNMENT_TEMPLATE", "Postmark_assignment_template"],
  POSTMARK_PASSWORD_RESET_TEMPLATE: ["POSTMARK_PASSWORD_RESET_TEMPLATE", "Postmark_password_reset_template"],
  POSTMARK_WELCOME_ADMIN_TEMPLATE: ["POSTMARK_WELCOME_ADMIN_TEMPLATE", "Postmark_welcome_admin_template"],
  SUPABASE_SERVICE_ROLE_KEY: ["SUPABASE_SERVICE_ROLE_KEY", "Supabase_service_role_key"],
  SUPABASE_URL: ["SUPABASE_URL", "Supabase_url", "Supabase_project_url"],
  WHATSAPP_ACCESS_TOKEN: ["WHATSAPP_ACCESS_TOKEN", "Whatsapp_access_token"],
  WHATSAPP_ALLOWED_PHONE_NUMBER_IDS: ["WHATSAPP_ALLOWED_PHONE_NUMBER_IDS", "Whatsapp_allowed_phone_number_ids"],
  WHATSAPP_DISPLAY_PHONE_NUMBER: ["WHATSAPP_DISPLAY_PHONE_NUMBER", "Whatsapp_display_phone_number"],
  WHATSAPP_PHONE_NUMBER_ID: ["WHATSAPP_PHONE_NUMBER_ID", "Whatsapp_phone_number_id"],
  WHATSAPP_BUSINESS_ACCOUNT_ID: ["WHATSAPP_BUSINESS_ACCOUNT_ID", "Whatsapp_business_account_id"],
  WHATSAPP_TEMPLATE_LANGUAGE: ["WHATSAPP_TEMPLATE_LANGUAGE", "Whatsapp_template_language"],
  // Second WhatsApp account (the higher-tier broadcast number). Its own Meta App, so its own
  // access token, app secret, and webhook verify token. Absent = single-number deployment.
  WHATSAPP_PHONE_NUMBER_ID_BROADCAST: ["WHATSAPP_PHONE_NUMBER_ID_BROADCAST", "Whatsapp_phone_number_id_broadcast"],
  WHATSAPP_ACCESS_TOKEN_BROADCAST: ["WHATSAPP_ACCESS_TOKEN_BROADCAST", "Whatsapp_access_token_broadcast"],
  WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST: ["WHATSAPP_BUSINESS_ACCOUNT_ID_BROADCAST", "Whatsapp_business_account_id_broadcast"],
  META_APP_SECRET_BROADCAST: ["META_APP_SECRET_BROADCAST", "Meta_app_secret_broadcast"],
  META_WEBHOOK_VERIFY_TOKEN_BROADCAST: ["META_WEBHOOK_VERIFY_TOKEN_BROADCAST", "Meta_webhook_verify_token_broadcast"],
  WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST: ["WHATSAPP_DISPLAY_PHONE_NUMBER_BROADCAST", "Whatsapp_display_phone_number_broadcast"],
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
