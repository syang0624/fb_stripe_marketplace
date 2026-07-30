import { MarketplaceApp } from "@/components/MarketplaceApp";
import { auth0 } from "@/lib/auth0";

function LoginScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-mist px-6">
      <section className="w-full max-w-md rounded-xl border border-line bg-paper p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-fb text-xl font-bold text-white">
          S
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fb">
          SOLID Marketplace
        </p>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink">
          Find safer marketplace deals
        </h1>
        <p className="mt-3 text-sm leading-6 text-ink/60">
          Sign in to search, negotiate, and manage trusted meetup payments.
        </p>
        <a
          href="/auth/login?returnTo=/"
          className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-fb px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-fb/90"
        >
          Continue with Auth0
        </a>
      </section>
    </main>
  );
}

export default async function HomePage() {
  const session = await auth0.getSession();

  if (!session) {
    return <LoginScreen />;
  }

  const accountLabel = session.user.name || session.user.email || "Account";

  return <MarketplaceApp accountLabel={accountLabel} />;
}
