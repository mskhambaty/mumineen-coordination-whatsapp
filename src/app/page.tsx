export default function Home() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 text-foreground">
      <main className="w-full max-w-2xl">
        <p className="font-mono text-sm uppercase tracking-wide text-zinc-500">
          WhatsApp backend
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-normal">
          Anjuman e Saifee Chicago Ashara Mubarak 1447H assistant
        </h1>
        <p className="mt-5 text-lg leading-8 text-zinc-600 dark:text-zinc-300">
          The deployed app exposes the Meta webhook at{" "}
          <code className="font-mono">/api/whatsapp/webhook</code>.
        </p>
      </main>
    </div>
  );
}
