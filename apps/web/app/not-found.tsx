import Link from "next/link";

export default function NotFound() {
  return <main className="not-found-page">
    <h1>Page not found</h1>
    <p>The requested OpenTriage page does not exist.</p>
    <Link href="/">Return to OpenTriage</Link>
  </main>;
}
