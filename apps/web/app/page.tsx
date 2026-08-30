const sections = ["Dispatch", "Crew", "Patient", "Situation", "Assessment", "Treatment", "Transport", "Outcome"];

export default function Home() {
  return (
    <main>
      <header>
        <p className="eyebrow">OPEN INCIDENT</p>
        <h1>OpenTriage</h1>
        <p>NEMSIS 3.5.1 starter workspace</p>
      </header>
      <section className="status" aria-label="Connection status">
        <span className="dot" /> Ready for a new patient care report
      </section>
      <nav aria-label="Report sections">
        {sections.map((section, index) => (
          <button key={section} type="button">
            <span>{String(index + 1).padStart(2, "0")}</span>
            {section}
          </button>
        ))}
      </nav>
      <footer>Installable browser scaffold · offline workflow not yet enabled</footer>
    </main>
  );
}
