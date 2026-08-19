export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="card max-w-md p-8">
        <h1 className="text-lg font-semibold">Not on the roster</h1>
        <p className="mt-2 text-sm text-black/60">
          You&apos;re signed in, but this address hasn&apos;t been added to the club. Ask an admin to
          add you, then sign in again.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="btn-ghost">Sign out</button>
        </form>
      </div>
    </main>
  );
}
